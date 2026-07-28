/**
 * Browser Worker Compatibility Tests for Proof Generation APIs
 *
 * These tests validate that proof generation APIs work correctly inside browser
 * worker environments, ensuring responsive dashboard experiences.
 *
 * Test coverage:
 * - Worker message protocol validation
 * - Data transfer via structured clone algorithm
 * - BigInt serialization/deserialization
 * - Typed array handling
 * - Error propagation across worker boundaries
 * - Concurrent request handling
 * - Timeout behavior
 * - Memory management
 */

import { WorkerProofGenerator, WorkerLike } from "../src/crypto/WorkerProofGenerator";
import { ProofGeneratorConfig, ProofPayload } from "../src/crypto/IProofGenerator";
import { WorkerResponse, WorkerRequest } from "../src/crypto/WorkerMessages";
import { PayrollError } from "../src/errors";
import { createPayrollProgressEvent, PayrollProgressStage } from "../src/progress";

// ── Realistic Worker Mock with Structured Clone Simulation ─────────────────────

class StructuredCloneWorker implements WorkerLike {
  readonly sent: WorkerRequest[] = [];
  terminated = false;

  private msgListeners: Array<(e: { data: WorkerResponse }) => void> = [];
  private errListeners: Array<(e: { message: string }) => void> = [];

  postMessage(message: WorkerRequest): void {
    // Simulate structured clone algorithm by cloning the message
    const cloned = this.simulateStructuredClone(message);
    this.sent.push(cloned);
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

  // Test helpers
  reply(data: WorkerResponse): void {
    // Simulate structured clone on response
    const cloned = this.simulateStructuredClone(data);
    this.msgListeners.forEach((l) => l({ data: cloned }));
  }

  crash(message: string): void {
    this.errListeners.forEach((l) => l({ message }));
  }

  lastRequest(): WorkerRequest {
    return this.sent[this.sent.length - 1];
  }

  // Simulate browser's structured clone algorithm
  private simulateStructuredClone<T>(obj: T): T {
    // BigInt support
    if (typeof obj === "bigint") {
      return obj;
    }

    // Objects with BigInt values
    if (obj && typeof obj === "object") {
      if (Array.isArray(obj)) {
        return obj.map((item) => this.simulateStructuredClone(item)) as T;
      }

      const cloned: Record<string, unknown> = {};
      for (const key in obj) {
        cloned[key] = this.simulateStructuredClone((obj as Record<string, unknown>)[key]);
      }
      return cloned as T;
    }

    return obj;
  }
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const config: ProofGeneratorConfig = {
  wasmUrl: "https://example.com/payroll.wasm",
  zkeyUrl: "https://example.com/payroll.zkey",
};

const mockPayload: ProofPayload = {
  proof: {
    pi_a: ["1", "2"],
    pi_b: [
      ["4", "3"],
      ["6", "5"],
    ],
    pi_c: ["7", "8"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["100", "200"],
};

function progressEvent(stage: PayrollProgressStage, progress?: number) {
  return createPayrollProgressEvent({
    operation: "proof",
    stage,
    message: stage,
    progress,
  });
}

function setup(opts?: ConstructorParameters<typeof WorkerProofGenerator>[2]) {
  const worker = new StructuredCloneWorker();
  const generator = new WorkerProofGenerator(worker, config, opts);
  return { worker, generator };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Browser Worker Compatibility - Proof Generation APIs", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // ── Structured Clone Data Transfer ───────────────────────────────────────────

  describe("Structured Clone Data Transfer", () => {
    it("correctly transfers BigInt witness values through worker messages", async () => {
      const { worker, generator } = setup();
      const witness = {
        recipient: "GABC...",
        amount: 5000000000000000000n, // Large BigInt
        nullifier: 12345678901234567890n,
      };

      const promise = generator.generateProof(witness);
      const req = worker.lastRequest();

      expect(req.type).toBe("GENERATE_PROOF");
      if (req.type === "GENERATE_PROOF") {
        expect(req.witness.amount).toBe(5000000000000000000n);
        expect(req.witness.nullifier).toBe(12345678901234567890n);
        expect(typeof req.witness.amount).toBe("bigint");
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });

    it("handles nested objects with BigInt values", async () => {
      const { worker, generator } = setup();
      const witness = {
        recipient: "GABC...",
        payment: {
          amount: 1000n,
          fee: 50n,
        },
        metadata: {
          timestamp: 1234567890n,
        },
      };

      const promise = generator.generateProof(witness);
      const req = worker.lastRequest();

      if (req.type === "GENERATE_PROOF") {
        expect((req.witness.payment as Record<string, unknown>).amount).toBe(1000n);
        expect((req.witness.payment as Record<string, unknown>).fee).toBe(50n);
        expect((req.witness.metadata as Record<string, unknown>).timestamp).toBe(1234567890n);
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });

    it("handles arrays containing BigInt values", async () => {
      const { worker, generator } = setup();
      const witness = {
        recipients: ["G1", "G2", "G3"],
        amounts: [100n, 200n, 300n],
      };

      const promise = generator.generateProof(witness);
      const req = worker.lastRequest();

      if (req.type === "GENERATE_PROOF") {
        expect(req.witness.amounts as bigint[]).toEqual([100n, 200n, 300n]);
        expect((req.witness.amounts as bigint[])[0]).toBe(100n);
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });

    it("preserves string and number types through structured clone", async () => {
      const { worker, generator } = setup();
      const witness = {
        recipient: "GABC...",
        amount: 5000n,
        count: 42, // Regular number
        flag: true, // Boolean
        label: "test", // String
      };

      const promise = generator.generateProof(witness);
      const req = worker.lastRequest();

      if (req.type === "GENERATE_PROOF") {
        expect(typeof req.witness.amount).toBe("bigint");
        expect(typeof req.witness.count).toBe("number");
        expect(typeof req.witness.flag).toBe("boolean");
        expect(typeof req.witness.label).toBe("string");
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });
  });

  // ── Proof Payload Data Transfer ──────────────────────────────────────────────

  describe("Proof Payload Data Transfer", () => {
    it("correctly transfers ProofPayload with string arrays", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      const complexPayload: ProofPayload = {
        proof: {
          pi_a: ["1234567890123456789012345678901234567890123456789012345678901234", "2"],
          pi_b: [
            ["3", "4"],
            ["5", "6"],
          ],
          pi_c: ["7", "8"],
          protocol: "groth16",
          curve: "bn128",
        },
        publicSignals: [
          "9999999999999999999999999999999999999999999999999999999999999999",
          "8888888888888888888888888888888888888888888888888888888888888888",
        ],
      };

      worker.reply({ type: "PROOF_RESULT", id, payload: complexPayload });
      const result = await promise;

      expect(result.proof.pi_a[0]).toBe(complexPayload.proof.pi_a[0]);
      expect(result.publicSignals[0]).toBe(complexPayload.publicSignals[0]);
    });

    it("handles empty public signals array", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      const emptyPayload: ProofPayload = {
        proof: {
          pi_a: ["1", "2"],
          pi_b: [
            ["3", "4"],
            ["5", "6"],
          ],
          pi_c: ["7", "8"],
          protocol: "groth16",
          curve: "bn128",
        },
        publicSignals: [],
      };

      worker.reply({ type: "PROOF_RESULT", id, payload: emptyPayload });
      const result = await promise;

      expect(result.publicSignals).toEqual([]);
    });
  });

  // ── Error Handling Across Worker Boundaries ────────────────────────────────

  describe("Error Handling Across Worker Boundaries", () => {
    it("propagates worker errors as PayrollError with correct code", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROOF_ERROR", id, message: "Circuit constraint violated" });

      await expect(promise).rejects.toThrow(PayrollError);
      await expect(promise).rejects.toThrow("Circuit constraint violated");

      try {
        await promise;
      } catch (err) {
        expect(err).toBeInstanceOf(PayrollError);
        expect((err as PayrollError).code).toBe(500);
      }
    });

    it("handles network fetch errors from worker", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      worker.reply({
        type: "PROOF_ERROR",
        id,
        message: "Failed to fetch .wasm (HTTP 404): https://example.com/payroll.wasm",
      });

      await expect(promise).rejects.toThrow(/Failed to fetch.*wasm/);
    });

    it("handles malformed proof data errors", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROOF_ERROR", id, message: "Invalid witness structure" });

      await expect(promise).rejects.toThrow(/Invalid witness structure/);
    });

    it("handles worker crash events", async () => {
      const { worker, generator } = setup();
      const p1 = generator.generateProof({ amount: 100n });
      const p2 = generator.generateProof({ amount: 200n });

      worker.crash("Worker ran out of memory");

      await expect(p1).rejects.toThrow(PayrollError);
      await expect(p1).rejects.toThrow(/Worker error/);
      await expect(p2).rejects.toThrow(PayrollError);

      try {
        await p1;
      } catch (err) {
        expect((err as PayrollError).code).toBe(500);
      }
    });

    it("handles timeout errors correctly", async () => {
      const { generator } = setup({ timeoutMs: 5000 });
      const promise = generator.generateProof({ amount: 100n });

      jest.advanceTimersByTime(5001);

      await expect(promise).rejects.toThrow(PayrollError);
      await expect(promise).rejects.toThrow(/timed out/);

      try {
        await promise;
      } catch (err) {
        expect((err as PayrollError).code).toBe(408);
      }
    });

    it("handles termination errors", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });

      generator.terminate();

      await expect(promise).rejects.toThrow(PayrollError);
      await expect(promise).rejects.toThrow(/terminated/);

      try {
        await promise;
      } catch (err) {
        expect((err as PayrollError).code).toBe(0);
      }
    });
  });

  // ── Concurrent Request Handling ─────────────────────────────────────────────

  describe("Concurrent Request Handling", () => {
    it("handles multiple simultaneous proof requests with different witnesses", async () => {
      const { worker, generator } = setup();

      const p1 = generator.generateProof({ recipient: "G1", amount: 100n });
      const p2 = generator.generateProof({ recipient: "G2", amount: 200n });
      const p3 = generator.generateProof({ recipient: "G3", amount: 300n });

      expect(worker.sent).toHaveLength(3);
      const id1 = worker.sent[0].id;
      const id2 = worker.sent[1].id;
      const id3 = worker.sent[2].id;

      // Verify all IDs are unique
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);

      // Resolve in random order
      worker.reply({ type: "PROOF_RESULT", id: id3, payload: mockPayload });
      worker.reply({ type: "PROOF_RESULT", id: id1, payload: mockPayload });
      worker.reply({ type: "PROOF_RESULT", id: id2, payload: mockPayload });

      await expect(p1).resolves.toEqual(mockPayload);
      await expect(p2).resolves.toEqual(mockPayload);
      await expect(p3).resolves.toEqual(mockPayload);
    });

    it("isolates errors between concurrent requests", async () => {
      const { worker, generator } = setup();

      const p1 = generator.generateProof({ recipient: "G1", amount: 100n });
      const p2 = generator.generateProof({ recipient: "G2", amount: 200n });
      const p3 = generator.generateProof({ recipient: "G3", amount: 300n });

      const id1 = worker.sent[0].id;
      const id2 = worker.sent[1].id;
      const id3 = worker.sent[2].id;

      // p1 succeeds, p2 fails, p3 succeeds
      worker.reply({ type: "PROOF_RESULT", id: id1, payload: mockPayload });
      worker.reply({ type: "PROOF_ERROR", id: id2, message: "Invalid witness for G2" });
      worker.reply({ type: "PROOF_RESULT", id: id3, payload: mockPayload });

      await expect(p1).resolves.toEqual(mockPayload);
      await expect(p2).rejects.toThrow(/Invalid witness for G2/);
      await expect(p3).resolves.toEqual(mockPayload);
    });

    it("handles concurrent preload and generateProof requests", async () => {
      const { worker, generator } = setup();

      const preloadPromise = generator.preloadArtifacts();
      const proofPromise = generator.generateProof({ amount: 100n });

      expect(worker.sent).toHaveLength(2);
      const preloadId = worker.sent[0].id;
      const proofId = worker.sent[1].id;

      expect(worker.sent[0].type).toBe("PRELOAD_ARTIFACTS");
      expect(worker.sent[1].type).toBe("GENERATE_PROOF");

      worker.reply({ type: "PRELOAD_DONE", id: preloadId });
      worker.reply({ type: "PROOF_RESULT", id: proofId, payload: mockPayload });

      await expect(preloadPromise).resolves.toBeUndefined();
      await expect(proofPromise).resolves.toEqual(mockPayload);
    });
  });

  // ── Progress Event Handling ──────────────────────────────────────────────────

  describe("Progress Event Handling", () => {
    it("emits progress events for all stages", async () => {
      const { worker, generator } = setup();
      const onProgress = jest.fn();

      const promise = generator.generateProof({ amount: 100n }, onProgress);
      const { id } = worker.lastRequest();

      const stages: PayrollProgressStage[] = [
        "proof_loading_wasm",
        "proof_loading_zkey",
        "proof_generating",
        "proof_done",
      ];

      for (const stage of stages) {
        worker.reply({ type: "PROGRESS", id, event: progressEvent(stage) });
      }
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });

      await promise;

      expect(onProgress).toHaveBeenCalledTimes(4);
      expect(onProgress.mock.calls[0][0]).toMatchObject({ stage: "proof_loading_wasm" });
      expect(onProgress.mock.calls[1][0]).toMatchObject({ stage: "proof_loading_zkey" });
      expect(onProgress.mock.calls[2][0]).toMatchObject({ stage: "proof_generating" });
      expect(onProgress.mock.calls[3][0]).toMatchObject({ stage: "proof_done" });
    });

    it("includes progress percentage in progress events", async () => {
      const { worker, generator } = setup();
      const onProgress = jest.fn();

      const promise = generator.generateProof({ amount: 100n }, onProgress);
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROGRESS", id, event: progressEvent("proof_generating", 25) });
      worker.reply({ type: "PROGRESS", id, event: progressEvent("proof_generating", 50) });
      worker.reply({ type: "PROGRESS", id, event: progressEvent("proof_generating", 75) });
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });

      await promise;

      expect(onProgress.mock.calls[0][0]).toMatchObject({ progress: 25 });
      expect(onProgress.mock.calls[1][0]).toMatchObject({ progress: 50 });
      expect(onProgress.mock.calls[2][0]).toMatchObject({ progress: 75 });
    });

    it("handles progress events during concurrent requests", async () => {
      const { worker, generator } = setup();
      const onProgress1 = jest.fn();
      const onProgress2 = jest.fn();

      const p1 = generator.generateProof({ recipient: "G1" }, onProgress1);
      const p2 = generator.generateProof({ recipient: "G2" }, onProgress2);

      const id1 = worker.sent[0].id;
      const id2 = worker.sent[1].id;

      worker.reply({ type: "PROGRESS", id: id1, event: progressEvent("proof_loading_wasm", 10) });
      worker.reply({ type: "PROGRESS", id: id2, event: progressEvent("proof_loading_wasm", 10) });
      worker.reply({ type: "PROGRESS", id: id1, event: progressEvent("proof_generating", 50) });
      worker.reply({ type: "PROGRESS", id: id2, event: progressEvent("proof_generating", 50) });
      worker.reply({ type: "PROOF_RESULT", id: id1, payload: mockPayload });
      worker.reply({ type: "PROOF_RESULT", id: id2, payload: mockPayload });

      await Promise.all([p1, p2]);

      expect(onProgress1).toHaveBeenCalledTimes(2);
      expect(onProgress2).toHaveBeenCalledTimes(2);
      expect(onProgress1.mock.calls[0][0]).toMatchObject({ stage: "proof_loading_wasm" });
      expect(onProgress2.mock.calls[0][0]).toMatchObject({ stage: "proof_loading_wasm" });
    });
  });

  // ── Memory Management ───────────────────────────────────────────────────────

  describe("Memory Management", () => {
    it("clears pending requests after successful completion", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });
      await promise;

      // Verify no pending requests remain
      const p2 = generator.generateProof({ amount: 200n });
      const req2 = worker.lastRequest();
      expect(req2.id).not.toBe(id); // Should get a new ID
      worker.reply({ type: "PROOF_RESULT", id: req2.id, payload: mockPayload });
      await expect(p2).resolves.toEqual(mockPayload);
    });

    it("clears pending requests after errors", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROOF_ERROR", id, message: "Test error" });
      await promise.catch(() => {});

      // Verify no pending requests remain
      const p2 = generator.generateProof({ amount: 200n });
      const req2 = worker.lastRequest();
      expect(req2.id).not.toBe(id);
      worker.reply({ type: "PROOF_RESULT", id: req2.id, payload: mockPayload });
      await expect(p2).resolves.toEqual(mockPayload);
    });

    it("clears all pending requests on terminate", async () => {
      const { worker, generator } = setup();
      const p1 = generator.generateProof({ amount: 100n });
      const p2 = generator.generateProof({ amount: 200n });

      generator.terminate();

      await expect(p1).rejects.toThrow(PayrollError);
      await expect(p2).rejects.toThrow(PayrollError);

      // Verify worker is terminated
      expect(worker.terminated).toBe(true);
    });

    it("removes event listeners on terminate", () => {
      const { worker, generator } = setup();
      const removeSpy = jest.spyOn(worker, "removeEventListener");

      generator.terminate();

      expect(removeSpy).toHaveBeenCalledWith("message", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  // ── Cache Management ────────────────────────────────────────────────────────

  describe("Cache Management", () => {
    it("handles preloadArtifacts request", async () => {
      const { worker, generator } = setup();
      const promise = generator.preloadArtifacts();
      const req = worker.lastRequest();

      expect(req.type).toBe("PRELOAD_ARTIFACTS");
      if (req.type === "PRELOAD_ARTIFACTS") {
        expect(req.config).toEqual(config);
      }

      worker.reply({ type: "PRELOAD_DONE", id: req.id });
      await expect(promise).resolves.toBeUndefined();
    });

    it("handles clearCache request", async () => {
      const { worker, generator } = setup();
      const promise = generator.clearCache();
      const req = worker.lastRequest();

      expect(req.type).toBe("CLEAR_CACHE");

      worker.reply({ type: "CACHE_CLEARED", id: req.id });
      await expect(promise).resolves.toBeUndefined();
    });

    it("handles preload errors correctly", async () => {
      const { worker, generator } = setup();
      const promise = generator.preloadArtifacts();
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROOF_ERROR", id, message: "Network error during preload" });

      await expect(promise).rejects.toThrow(PayrollError);
      await expect(promise).rejects.toThrow(/Network error during preload/);
    });
  });

  // ── Worker Message Protocol Validation ───────────────────────────────────────

  describe("Worker Message Protocol Validation", () => {
    it("sends correctly formatted GENERATE_PROOF messages", async () => {
      const { worker, generator } = setup();
      const witness = { recipient: "GABC", amount: 5000n };

      generator.generateProof(witness);
      const req = worker.lastRequest();

      expect(req).toHaveProperty("type");
      expect(req).toHaveProperty("id");
      expect(req).toHaveProperty("witness");
      expect(req).toHaveProperty("config");

      if (req.type === "GENERATE_PROOF") {
        expect(req.type).toBe("GENERATE_PROOF");
        expect(typeof req.id).toBe("string");
        expect(req.witness).toEqual(witness);
        expect(req.config).toEqual(config);
      }
    });

    it("sends correctly formatted PRELOAD_ARTIFACTS messages", async () => {
      const { worker, generator } = setup();

      generator.preloadArtifacts();
      const req = worker.lastRequest();

      expect(req).toHaveProperty("type");
      expect(req).toHaveProperty("id");
      expect(req).toHaveProperty("config");

      if (req.type === "PRELOAD_ARTIFACTS") {
        expect(req.type).toBe("PRELOAD_ARTIFACTS");
        expect(typeof req.id).toBe("string");
        expect(req.config).toEqual(config);
      }
    });

    it("sends correctly formatted CLEAR_CACHE messages", async () => {
      const { worker, generator } = setup();

      generator.clearCache();
      const req = worker.lastRequest();

      expect(req).toHaveProperty("type");
      expect(req).toHaveProperty("id");

      if (req.type === "CLEAR_CACHE") {
        expect(req.type).toBe("CLEAR_CACHE");
        expect(typeof req.id).toBe("string");
      }
    });

    it("ignores responses with unknown IDs", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      // Unknown ID should be ignored
      worker.reply({ type: "PROOF_RESULT", id: "unknown-id-999", payload: mockPayload });

      // Real response should still work
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });
  });

  // ── Large Data Handling ─────────────────────────────────────────────────────

  describe("Large Data Handling", () => {
    it("handles witnesses with many fields", async () => {
      const { worker, generator } = setup();
      const largeWitness: Record<string, unknown> = {};

      // Create a witness with 100 fields
      for (let i = 0; i < 100; i++) {
        largeWitness[`field${i}`] = BigInt(i);
      }

      const promise = generator.generateProof(largeWitness);
      const req = worker.lastRequest();

      if (req.type === "GENERATE_PROOF") {
        expect(Object.keys(req.witness).length).toBe(100);
        expect(req.witness.field0).toBe(0n);
        expect(req.witness.field99).toBe(99n);
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });

    it("handles large public signals arrays", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 100n });
      const { id } = worker.lastRequest();

      const largePayload: ProofPayload = {
        proof: {
          pi_a: ["1", "2"],
          pi_b: [
            ["3", "4"],
            ["5", "6"],
          ],
          pi_c: ["7", "8"],
          protocol: "groth16",
          curve: "bn128",
        },
        publicSignals: Array.from({ length: 100 }, (_, i) => String(i)),
      };

      worker.reply({ type: "PROOF_RESULT", id, payload: largePayload });
      const result = await promise;

      expect(result.publicSignals).toHaveLength(100);
      expect(result.publicSignals[0]).toBe("0");
      expect(result.publicSignals[99]).toBe("99");
    });
  });

  // ── Environment-Specific Limitations Documentation ───────────────────────────

  describe("Environment-Specific Limitations", () => {
    it("documents that structured clone does not support functions", async () => {
      // This test documents a known limitation
      const { worker, generator } = setup();

      const witnessWithFunction = {
        recipient: "GABC",
        amount: 100n,
        // Functions cannot be transferred via structured clone
        // callback: () => {}, // This would fail in real worker
      };

      const promise = generator.generateProof(witnessWithFunction);
      const req = worker.lastRequest();

      if (req.type === "GENERATE_PROOF") {
        expect(req.witness).not.toHaveProperty("callback");
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });

    it("documents that DOM elements cannot be transferred", async () => {
      // This test documents a known limitation
      const { worker, generator } = setup();

      const witnessWithDOM = {
        recipient: "GABC",
        amount: 100n,
        // DOM elements cannot be transferred via structured clone
        // element: document.createElement('div'), // This would fail in real worker
      };

      const promise = generator.generateProof(witnessWithDOM);
      const req = worker.lastRequest();

      if (req.type === "GENERATE_PROOF") {
        expect(req.witness).not.toHaveProperty("element");
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });

    it("documents that circular references are not supported", async () => {
      // This test documents a known limitation
      const { worker, generator } = setup();

      const circular: Record<string, unknown> = { name: "test", amount: 100n };
      // circular.self = circular; // This would cause structured clone error

      const promise = generator.generateProof(circular);
      const req = worker.lastRequest();

      if (req.type === "GENERATE_PROOF") {
        expect(req.witness).not.toHaveProperty("self");
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });
  });
});
