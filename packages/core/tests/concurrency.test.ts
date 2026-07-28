/**
 * Tests for the concurrency-guard machinery added for Issue #65
 * (Add concurrency guards for parallel proof generation requests).
 *
 * Coverage:
 *   - `Semaphore` FIFO semantics, runExclusive, error release
 *   - `witnessKey` is stable across bigints and runs
 *   - `SnarkjsProofGenerator.generateProof`:
 *        same-witness dedup, distinct-witness parallelism, cap, dedup
 *        rejects all waiters on failure, artifact-fetch racing coalesces
 *   - `WorkerProofGenerator.generateProof`:
 *        same-witness dedup posts a single message; distinct witnesses
 *        are not deduped; per-call progress callbacks still work for
 *        non-deduped requests.
 */

import { SnarkjsProofGenerator } from "../src/crypto/SnarkjsProofGenerator";
import { WorkerProofGenerator, WorkerLike } from "../src/crypto/WorkerProofGenerator";
import { ProofGeneratorConfig, ProofPayload, witnessKey } from "../src/crypto/IProofGenerator";
import { WorkerRequest, WorkerResponse } from "../src/crypto/WorkerMessages";
import { Semaphore } from "../src/core/concurrency";
import { IdempotencyRegistry } from "../src/core/idempotency";
import { MemoryCacheProvider } from "../src/cache/MemoryCacheProvider";
import { PayrollError } from "../src/errors";
import axios from "axios";

// ── Mock snarkjs + axios (shared with existing tests) ─────────────────────────

jest.mock("snarkjs", () => ({
  groth16: {
    fullProve: jest.fn(),
  },
}));

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { groth16 } = require("snarkjs") as { groth16: { fullProve: jest.Mock } };

const baseConfig: ProofGeneratorConfig = {
  wasmUrl: "https://example.com/circuit.wasm",
  zkeyUrl: "https://example.com/circuit.zkey",
  artifactCacheTTL: 3600,
};

const mockWasm = new ArrayBuffer(100);
const mockZkey = new Uint8Array(200);

const mockProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "1"],
  ],
  pi_c: ["7", "8", "1"],
  protocol: "groth16",
  curve: "bn128",
};

const mockPublicSignals = ["123456789", "987654321"];

const mockPayload: ProofPayload = {
  proof: {
    pi_a: [mockProof.pi_a[0], mockProof.pi_a[1]],
    pi_b: [
      [mockProof.pi_b[0][1], mockProof.pi_b[0][0]],
      [mockProof.pi_b[1][1], mockProof.pi_b[1][0]],
    ],
    pi_c: [mockProof.pi_c[0], mockProof.pi_c[1]],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: mockPublicSignals,
};

beforeEach(() => {
  jest.clearAllMocks();

  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes(".wasm")) {
      return Promise.resolve({ data: mockWasm });
    }
    if (url.includes(".zkey")) {
      return Promise.resolve({ data: mockZkey.buffer });
    }
    return Promise.reject(new Error("Unknown URL"));
  });

  groth16.fullProve.mockResolvedValue({
    proof: mockProof,
    publicSignals: mockPublicSignals,
  });
});

// ── Fake Worker (local copy for WorkerProofGenerator tests) ───────────────────

class FakeWorker implements WorkerLike {
  readonly sent: WorkerRequest[] = [];
  terminated = false;

  private msgListeners: Array<(e: { data: WorkerResponse }) => void> = [];
  private errListeners: Array<(e: { message: string }) => void> = [];

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
  }

  addEventListener(type: "message", listener: (e: { data: WorkerResponse }) => void): void;
  addEventListener(type: "error", listener: (e: { message: string }) => void): void;
  addEventListener(
    type: "message" | "error",
    listener: ((e: { data: WorkerResponse }) => void) | ((e: { message: string }) => void)
  ): void {
    if (type === "message") {
      this.msgListeners.push(listener as (e: { data: WorkerResponse }) => void);
    } else {
      this.errListeners.push(listener as (e: { message: string }) => void);
    }
  }

  removeEventListener(type: "message", listener: (e: { data: WorkerResponse }) => void): void;
  removeEventListener(type: "error", listener: (e: { message: string }) => void): void;
  removeEventListener(
    type: "message" | "error",
    listener: ((e: { data: WorkerResponse }) => void) | ((e: { message: string }) => void)
  ): void {
    if (type === "message") {
      this.msgListeners = this.msgListeners.filter((l) => l !== listener);
    } else {
      this.errListeners = this.errListeners.filter((l) => l !== listener);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: WorkerResponse): void {
    this.msgListeners.forEach((l) => l({ data }));
  }

  lastRequest(): WorkerRequest {
    return this.sent[this.sent.length - 1];
  }
}

// =============================================================================
// Semaphore
// =============================================================================

describe("Semaphore (Issue #65)", () => {
  it("throws when permits < 1", () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
    expect(() => new Semaphore(-1)).toThrow(/positive integer/);
  });

  it("throws when permits is not an integer", () => {
    expect(() => new Semaphore(1.5)).toThrow();
  });

  it("runs up to N concurrent holders", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 5 }, () =>
      sem.runExclusive(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active -= 1;
      })
    );
    await Promise.all(tasks);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(sem.activeCount).toBe(0);
    expect(sem.waitingCount).toBe(0);
  });

  it("is FIFO when oversubscribed", async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];
    const label = (n: string, op: string) => {
      order.push(`${op}:${n}`);
    };

    const t1 = sem.runExclusive(async () => {
      label("A", "start");
      await new Promise((r) => setTimeout(r, 15));
      label("A", "end");
    });
    const t2 = sem.runExclusive(async () => {
      label("B", "start");
      await new Promise((r) => setTimeout(r, 5));
      label("B", "end");
    });
    const t3 = sem.runExclusive(async () => {
      label("C", "start");
      await new Promise((r) => setTimeout(r, 1));
      label("C", "end");
    });

    await Promise.all([t1, t2, t3]);

    expect(order).toEqual(["start:A", "end:A", "start:B", "end:B", "start:C", "end:C"]);
  });

  it("runExclusive releases the permit even when fn throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.runExclusive(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(sem.activeCount).toBe(0);

    // Should be available again after the throw
    const release = await sem.acquire();
    expect(sem.activeCount).toBe(1);
    release();
  });

  it("explicit acquire/release symmetric with runExclusive", async () => {
    const sem = new Semaphore(2);
    const release1 = await sem.acquire();
    const release2 = await sem.acquire();
    expect(sem.activeCount).toBe(2);

    release1();
    release2();
    expect(sem.activeCount).toBe(0);
  });
});

// =============================================================================
// witnessKey
// =============================================================================

describe("witnessKey (Issue #65)", () => {
  it("returns the same key for identical witnesses", () => {
    expect(witnessKey({ recipient: "G1", amount: 1000n })).toBe(
      witnessKey({ recipient: "G1", amount: 1000n })
    );
  });

  it("stringifies bigints stably", () => {
    expect(witnessKey({ amount: 123456789012345678n })).toBe(
      'proof:{"amount":"123456789012345678"}'
    );
  });

  it("differentiates distinct witnesses", () => {
    expect(witnessKey({ recipient: "A" })).not.toBe(witnessKey({ recipient: "B" }));
  });

  it("starts every key with the 'proof:' prefix", () => {
    expect(witnessKey({})).toMatch(/^proof:/);
  });
});

// =============================================================================
// SnarkjsProofGenerator — concurrency guards
// =============================================================================

describe("SnarkjsProofGenerator — concurrency guards (Issue #65)", () => {
  describe("per-witness deduplication", () => {
    it("runs groth16.fullProve only ONCE for concurrent same-witness calls", async () => {
      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 4 },
        new MemoryCacheProvider<string>()
      );
      const w = { recipient: "GDEDUP", amount: 1000n };

      const results = await Promise.all([
        gen.generateProof(w),
        gen.generateProof(w),
        gen.generateProof(w),
        gen.generateProof(w),
      ]);

      expect(groth16.fullProve).toHaveBeenCalledTimes(1);
      for (const r of results) {
        expect(r).toEqual(mockPayload);
      }
    });

    it("all dedup'd callers resolve to the same payload object", async () => {
      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 4 },
        new MemoryCacheProvider<string>()
      );
      const w = { recipient: "GSAME", amount: 999n };

      const p1 = gen.generateProof(w);
      const p2 = gen.generateProof(w);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(r2); // literal same Promise resolution
    });

    it("does NOT deduplicate calls with different witnesses", async () => {
      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 4 },
        new MemoryCacheProvider<string>()
      );

      await Promise.all([
        gen.generateProof({ recipient: "A", amount: 100n }),
        gen.generateProof({ recipient: "B", amount: 200n }),
        gen.generateProof({ recipient: "C", amount: 300n }),
      ]);

      expect(groth16.fullProve).toHaveBeenCalledTimes(3);
    });

    it("creates a fresh execution slot after previous same-witness call settles", async () => {
      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 4 },
        new MemoryCacheProvider<string>()
      );
      const w = { recipient: "GSEQUENTIAL", amount: 1n };

      await gen.generateProof(w);
      // The first call has now cleared the dedup registry (ttlMs=0).
      await gen.generateProof(w);
      // Cache hit, so fullProve is still only called once across the two calls.

      expect(groth16.fullProve).toHaveBeenCalledTimes(1);

      // And the next call after a fresh, distinct witness IS a separate run.
      await gen.generateProof({ recipient: "GDIFFERENT", amount: 1n });
      expect(groth16.fullProve).toHaveBeenCalledTimes(2);
    });
  });

  describe("maxConcurrency cap", () => {
    it("limits distinct-witness concurrent proof generation to maxConcurrency", async () => {
      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 2 },
        new MemoryCacheProvider<string>()
      );

      let active = 0;
      let maxActive = 0;
      groth16.fullProve.mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 25));
        active -= 1;
        return { proof: mockProof, publicSignals: mockPublicSignals };
      });

      await Promise.all([
        gen.generateProof({ recipient: "A", amount: 100n }),
        gen.generateProof({ recipient: "B", amount: 200n }),
        gen.generateProof({ recipient: "C", amount: 300n }),
        gen.generateProof({ recipient: "D", amount: 400n }),
      ]);

      expect(maxActive).toBeLessThanOrEqual(2);
      // All four should have completed.
      expect(groth16.fullProve).toHaveBeenCalledTimes(4);
    });

    it("defaults maxConcurrency to 1", async () => {
      const gen = new SnarkjsProofGenerator(baseConfig, new MemoryCacheProvider<string>());

      let active = 0;
      let maxActive = 0;
      groth16.fullProve.mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
        return { proof: mockProof, publicSignals: mockPublicSignals };
      });

      await Promise.all([
        gen.generateProof({ recipient: "X1", amount: 1n }),
        gen.generateProof({ recipient: "X2", amount: 2n }),
        gen.generateProof({ recipient: "X3", amount: 3n }),
      ]);

      expect(maxActive).toBe(1);
    });
  });

  describe("error propagation", () => {
    it("rejects every dedup'd caller when the underlying proof fails", async () => {
      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 4 },
        new MemoryCacheProvider<string>()
      );

      groth16.fullProve.mockRejectedValueOnce(new Error("circuit failure"));

      const w = { recipient: "GFAIL", amount: 10n };
      const results = await Promise.allSettled([gen.generateProof(w), gen.generateProof(w)]);

      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("rejected");
      if (results[0].status === "rejected") {
        expect(results[0].reason.message).toMatch(/circuit failure/);
      }
      if (results[1].status === "rejected") {
        expect(results[1].reason.message).toMatch(/circuit failure/);
      }
    });

    it("clears the dedup entry after rejection so a retry runs fresh", async () => {
      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 4 },
        new MemoryCacheProvider<string>()
      );

      groth16.fullProve
        .mockRejectedValueOnce(new Error("first attempt fails"))
        .mockResolvedValueOnce({ proof: mockProof, publicSignals: mockPublicSignals });

      const w = { recipient: "GRETRY", amount: 1n };

      await expect(gen.generateProof(w)).rejects.toThrow("first attempt fails");

      const retried = await gen.generateProof(w);
      expect(retried).toEqual(mockPayload);
      expect(groth16.fullProve).toHaveBeenCalledTimes(2);
    });
  });

  describe("artifact-fetch memoization", () => {
    /**
     * Forces all pending microtasks to drain so axios.get calls fired
     * inside `generateProof` are visible on `mockedAxios.get.mock.calls`.
     */
    async function flushMicrotasks(): Promise<void> {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    it("coalesces concurrent .wasm downloads into a single axios.get", async () => {
      // Manually create a pending wasm response we control.
      let resolveWasm!: (v: { data: ArrayBuffer }) => void;
      const pendingWasm = new Promise<{ data: ArrayBuffer }>((resolve) => {
        resolveWasm = resolve;
      });
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes(".wasm")) return pendingWasm;
        if (url.includes(".zkey")) {
          return Promise.resolve({ data: mockZkey.buffer });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 4 },
        new MemoryCacheProvider<string>()
      );

      // Kick off three concurrent loads for distinct witnesses.
      const p1 = gen.generateProof({ recipient: "WX1", amount: 1n });
      const p2 = gen.generateProof({ recipient: "WX2", amount: 2n });
      const p3 = gen.generateProof({ recipient: "WX3", amount: 3n });

      // Drain microtasks so fetchWasm reaches axios.get inside its body.
      await flushMicrotasks();

      const wasmCalls = mockedAxios.get.mock.calls.filter(([url]) => String(url).includes(".wasm"));
      expect(wasmCalls).toHaveLength(1);

      // Resolve the pending wasm call so the test completes cleanly.
      resolveWasm({ data: mockWasm });

      await Promise.all([p1, p2, p3]);
    });

    it("coalesces concurrent .zkey downloads into a single axios.get", async () => {
      let resolveZkey!: (v: { data: ArrayBuffer }) => void;
      const pendingZkey = new Promise<{ data: ArrayBuffer }>((resolve) => {
        resolveZkey = resolve;
      });
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes(".zkey")) return pendingZkey;
        if (url.includes(".wasm")) {
          return Promise.resolve({ data: mockWasm });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 4 },
        new MemoryCacheProvider<string>()
      );

      const p1 = gen.generateProof({ recipient: "ZX1", amount: 1n });
      const p2 = gen.generateProof({ recipient: "ZX2", amount: 2n });

      await flushMicrotasks();

      const zkeyCalls = mockedAxios.get.mock.calls.filter(([url]) => String(url).includes(".zkey"));
      expect(zkeyCalls).toHaveLength(1);

      resolveZkey({ data: mockZkey.buffer });

      await Promise.all([p1, p2]);
    });
  });

  describe("clearArtifactCache", () => {
    it("forces re-fetch and dedup-flush for distinct witnesses", async () => {
      const gen = new SnarkjsProofGenerator(
        { ...baseConfig, maxConcurrency: 2 },
        new MemoryCacheProvider<string>()
      );

      await gen.generateProof({ recipient: "GCA", amount: 1n });
      expect(groth16.fullProve).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2); // wasm + zkey for GCA

      gen.clearArtifactCache();

      // GCB is a fresh witness (cache miss) AND dedup is empty.
      await gen.generateProof({ recipient: "GCB", amount: 1n });
      expect(groth16.fullProve).toHaveBeenCalledTimes(2);
      expect(mockedAxios.get).toHaveBeenCalledTimes(4); // wasm + zkey for GCB
    });
  });
});

// =============================================================================
// WorkerProofGenerator — concurrency guards
// =============================================================================

describe("WorkerProofGenerator — concurrency guards (Issue #65)", () => {
  const config: ProofGeneratorConfig = {
    wasmUrl: "https://example.com/payroll.wasm",
    zkeyUrl: "https://example.com/payroll.zkey",
  };

  function setup(options?: ConstructorParameters<typeof WorkerProofGenerator>[2]) {
    const worker = new FakeWorker();
    const generator = new WorkerProofGenerator(worker, config, options);
    return { worker, generator };
  }

  describe("per-witness deduplication", () => {
    it("posts exactly one GENERATE_PROOF message for concurrent same-witness calls", async () => {
      const { worker, generator } = setup();
      const w = { recipient: "GDEDUPW", amount: 1000n };

      const p1 = generator.generateProof(w);
      const p2 = generator.generateProof(w);
      const p3 = generator.generateProof(w);

      expect(worker.sent).toHaveLength(1);
      expect(worker.sent[0].type).toBe("GENERATE_PROOF");

      const id = (worker.sent[0] as { id: string }).id;
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).toEqual(mockPayload);
      expect(r2).toEqual(mockPayload);
      expect(r3).toEqual(mockPayload);
    });

    it("posts separate messages for distinct witnesses", async () => {
      const { worker, generator } = setup();
      const p1 = generator.generateProof({ recipient: "DA" });
      const p2 = generator.generateProof({ recipient: "DB" });

      expect(worker.sent).toHaveLength(2);
      const id1 = (worker.sent[0] as { id: string }).id;
      const id2 = (worker.sent[1] as { id: string }).id;
      expect(id1).not.toBe(id2);

      worker.reply({ type: "PROOF_RESULT", id: id2, payload: mockPayload });
      worker.reply({ type: "PROOF_RESULT", id: id1, payload: mockPayload });
      await Promise.all([p1, p2]);
    });

    it("can be disabled via dedupSameWitness: false", async () => {
      const { worker, generator } = setup({ dedupSameWitness: false });
      const w = { recipient: "GNDED", amount: 1n };

      const p1 = generator.generateProof(w);
      const p2 = generator.generateProof(w);

      expect(worker.sent).toHaveLength(2);

      const id1 = (worker.sent[0] as { id: string }).id;
      const id2 = (worker.sent[1] as { id: string }).id;
      worker.reply({ type: "PROOF_RESULT", id: id2, payload: mockPayload });
      worker.reply({ type: "PROOF_RESULT", id: id1, payload: mockPayload });
      await Promise.all([p1, p2]);
    });

    it("rejects all dedup'd callers when the worker reports PROOF_ERROR", async () => {
      const { worker, generator } = setup();
      const w = { recipient: "GERRW", amount: 1n };

      const p1 = generator.generateProof(w);
      const p2 = generator.generateProof(w);

      expect(worker.sent).toHaveLength(1);
      const id = (worker.sent[0] as { id: string }).id;

      worker.reply({ type: "PROOF_ERROR", id, message: "worker crashed" });

      const results = await Promise.allSettled([p1, p2]);
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      if (results[0].status === "rejected") {
        expect(results[0].reason).toBeInstanceOf(PayrollError);
      }
    });

    it("clears the dedup registry after a rejection so retries run fresh", async () => {
      const { worker, generator } = setup();
      const w = { recipient: "GRETRY", amount: 1n };

      const first = generator.generateProof(w);
      const id1 = (worker.sent[0] as { id: string }).id;
      worker.reply({ type: "PROOF_ERROR", id: id1, message: "fail" });
      await expect(first).rejects.toThrow(PayrollError);

      // After settle, dedup entry is gone — fresh attempt posts a new message.
      const second = generator.generateProof(w);
      expect(worker.sent).toHaveLength(2);
      const id2 = (worker.sent[1] as { id: string }).id;
      expect(id2).not.toBe(id1);
      worker.reply({ type: "PROOF_RESULT", id: id2, payload: mockPayload });
      await expect(second).resolves.toEqual(mockPayload);
    });
  });

  describe("progress callbacks", () => {
    it("per-call onProgress still wins for non-deduped (different-witness) requests", async () => {
      const globalProgress = jest.fn();
      const perCallProgress = jest.fn();

      const { worker, generator } = setup({ onProgress: globalProgress });

      const p1 = generator.generateProof({ recipient: "PROG1" }, perCallProgress);
      const id1 = (worker.sent[0] as { id: string }).id;
      worker.reply({ type: "PROGRESS", id: id1, stage: "generating", progress: 50 });
      worker.reply({ type: "PROOF_RESULT", id: id1, payload: mockPayload });
      await p1;

      expect(perCallProgress).toHaveBeenCalledWith(expect.objectContaining({ progress: 50 }));
      expect(globalProgress).not.toHaveBeenCalled();
    });

    it("global onProgress fires when no per-call callback is supplied", async () => {
      const globalProgress = jest.fn();
      const { worker, generator } = setup({ onProgress: globalProgress });

      const p = generator.generateProof({ recipient: "PROGG" });
      const id = (worker.sent[0] as { id: string }).id;
      worker.reply({ type: "PROGRESS", id, stage: "loading_zkey" });
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });
      await p;

      expect(globalProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: expect.stringMatching(/zkey/) })
      );
    });
  });

  describe("termination", () => {
    it("rejects all in-flight callers, including dedup'd ones", async () => {
      const { worker, generator } = setup();
      const w = { recipient: "GTERM", amount: 1n };

      // Two concurrent calls for the same witness share one worker request.
      const p1 = generator.generateProof(w);
      const p2 = generator.generateProof(w);
      expect(worker.sent).toHaveLength(1);

      generator.terminate();

      await expect(p1).rejects.toThrow(/terminated/);
      await expect(p2).rejects.toThrow(/terminated/);
    });
  });
});

// =============================================================================
// Integration: existing helpers still compose
// =============================================================================

describe("Concurrency integration (Issue #65)", () => {
  it("IdempotencyRegistry with ttlMs=0 matches Semaphore-style dedup semantics", async () => {
    const registry = new IdempotencyRegistry<string>(0);
    let runs = 0;
    const task = () => {
      runs += 1;
      return new Promise<string>((resolve) => setTimeout(() => resolve("done"), 10));
    };

    const results = await Promise.all([
      registry.execute("k", task),
      registry.execute("k", task),
      registry.execute("k", task),
    ]);

    expect(runs).toBe(1);
    expect(results).toEqual(["done", "done", "done"]);
  });

  it("Semaphore + IdempotencyRegistry cooperate for the proof pipeline", async () => {
    const sem = new Semaphore(2);
    const dedup = new IdempotencyRegistry<string>(0);

    // Two concurrent "different" keys should be able to run in parallel (max 2),
    // and same-key calls should share work.
    const make = (key: string, ms: number) =>
      dedup.execute(key, () =>
        sem.runExclusive(() => new Promise<string>((r) => setTimeout(() => r(key), ms)))
      );

    const start = Date.now();
    const results = await Promise.all([
      make("x", 30),
      make("y", 30),
      make("x", 30), // dedup'd
      make("y", 30), // dedup'd
    ]);
    const elapsed = Date.now() - start;

    // Two parallel 30ms jobs ⇒ ~30ms (not 60ms).
    expect(elapsed).toBeLessThan(200);
    expect(results).toEqual(["x", "y", "x", "y"]);
  });
});
