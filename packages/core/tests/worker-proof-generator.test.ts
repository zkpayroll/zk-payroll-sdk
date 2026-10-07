import { WorkerProofGenerator, WorkerLike } from "../src/crypto/WorkerProofGenerator";
import { ProofGeneratorConfig, ProofPayload } from "../src/crypto/IProofGenerator";
import { WorkerResponse, WorkerRequest } from "../src/crypto/WorkerMessages";
import { PayrollError } from "../src/errors";
import { createPayrollProgressEvent, PayrollProgressStage } from "../src/progress";

// ── Fake Worker ───────────────────────────────────────────────────────────────

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

  // Test helpers
  reply(data: WorkerResponse): void {
    this.msgListeners.forEach((l) => l({ data }));
  }

  crash(message: string): void {
    this.errListeners.forEach((l) => l({ message }));
  }

  lastRequest(): WorkerRequest {
    return this.sent[this.sent.length - 1];
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
  const worker = new FakeWorker();
  const generator = new WorkerProofGenerator(worker, config, opts);
  return { worker, generator };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WorkerProofGenerator", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // ── generateProof ──────────────────────────────────────────────────────────

  describe("generateProof", () => {
    it("posts a GENERATE_PROOF message with the witness and config", async () => {
      const { worker, generator } = setup();
      const witness = { recipient: "GABC", amount: 5000n, asset: "native" };

      const promise = generator.generateProof(witness);
      const req = worker.lastRequest();

      expect(req.type).toBe("GENERATE_PROOF");
      if (req.type === "GENERATE_PROOF") {
        // Amount is normalized from bigint to string by the proof input sanitizer
        expect(req.witness).toEqual({ ...witness, amount: "5000" });
        expect(req.config).toEqual(config);
        expect(typeof req.id).toBe("string");
      }

      worker.reply({ type: "PROOF_RESULT", id: req.id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });

    it("resolves with the ProofPayload returned by the worker", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ recipient: "GX", amount: 1000n, asset: "native" });
      const { id } = worker.lastRequest();
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });

    it("rejects with PayrollError when worker sends PROOF_ERROR", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ recipient: "GX", amount: 100n, asset: "native" });
      const { id } = worker.lastRequest();
      worker.reply({ type: "PROOF_ERROR", id, message: "invalid witness" });
      await expect(promise).rejects.toThrow(PayrollError);
      await expect(promise).rejects.toThrow(/invalid witness/);
    });

    it("forwards PROGRESS messages to the per-call onProgress callback", async () => {
      const { worker, generator } = setup();
      const onProgress = jest.fn();

      const promise = generator.generateProof({ amount: 100n }, onProgress);
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROGRESS", id, event: progressEvent("proof_loading_wasm") });
      worker.reply({ type: "PROGRESS", id, event: progressEvent("proof_generating", 0) });
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });

      await promise;

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress.mock.calls[0][0]).toMatchObject({ stage: "proof_loading_wasm" });
      expect(onProgress.mock.calls[1][0]).toMatchObject({ stage: "proof_generating", progress: 0 });
    });

    it("falls back to global onProgress when no per-call callback is supplied", async () => {
      const globalProgress = jest.fn();
      const { worker, generator } = setup({ onProgress: globalProgress });

      const promise = generator.generateProof({ amount: 200n });
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROGRESS", id, event: progressEvent("proof_loading_zkey") });
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });

      await promise;
      expect(globalProgress.mock.calls[0][0]).toMatchObject({ stage: "proof_loading_zkey" });
    });

    it("per-call onProgress overrides the global one", async () => {
      const globalProgress = jest.fn();
      const perCallProgress = jest.fn();
      const { worker, generator } = setup({ onProgress: globalProgress });

      const promise = generator.generateProof({ amount: 300n }, perCallProgress);
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROGRESS", id, event: progressEvent("proof_generating", 50) });
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });

      await promise;
      expect(perCallProgress.mock.calls[0][0]).toMatchObject({
        stage: "proof_generating",
        progress: 50,
      });
      expect(globalProgress).not.toHaveBeenCalled();
    });

    it("rejects with a timeout error when the worker is silent", async () => {
      const { generator } = setup({ timeoutMs: 5000 });
      const promise = generator.generateProof({ recipient: "GX", amount: 100n, asset: "native" });

      jest.advanceTimersByTime(5001);

      await expect(promise).rejects.toThrow(PayrollError);
      await expect(promise).rejects.toThrow(/timed out/);
    });

    it("uses 120 000 ms as the default timeout", async () => {
      const { generator } = setup();
      const promise = generator.generateProof({ recipient: "GX", amount: 100n, asset: "native" });

      jest.advanceTimersByTime(119_999);
      // Promise should still be pending (not rejected yet)

      jest.advanceTimersByTime(2);
      await expect(promise).rejects.toThrow(/timed out/);
    });

    it("handles concurrent proof requests independently", async () => {
      const { worker, generator } = setup();

      const p1 = generator.generateProof({ recipient: "G1" });
      const p2 = generator.generateProof({ recipient: "G2" });

      expect(worker.sent).toHaveLength(2);
      const id1 = worker.sent[0].id;
      const id2 = worker.sent[1].id;
      expect(id1).not.toBe(id2);

      // Resolve in reverse order to verify independent routing
      worker.reply({ type: "PROOF_RESULT", id: id2, payload: mockPayload });
      worker.reply({ type: "PROOF_RESULT", id: id1, payload: mockPayload });

      await expect(p1).resolves.toEqual(mockPayload);
      await expect(p2).resolves.toEqual(mockPayload);
    });

    it("ignores responses with unknown ids", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ recipient: "GX", amount: 100n, asset: "native" });
      const { id } = worker.lastRequest();

      // Unknown id — should be silently ignored
      worker.reply({ type: "PROOF_RESULT", id: "9999", payload: mockPayload });

      // Real response follows
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });
      await expect(promise).resolves.toEqual(mockPayload);
    });
  });

  // ── preloadArtifacts ───────────────────────────────────────────────────────

  describe("preloadArtifacts", () => {
    it("sends PRELOAD_ARTIFACTS with the generator config", async () => {
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

    it("rejects when worker sends PROOF_ERROR during preload", async () => {
      const { worker, generator } = setup();
      const promise = generator.preloadArtifacts();
      const { id } = worker.lastRequest();

      worker.reply({ type: "PROOF_ERROR", id, message: "network error" });
      await expect(promise).rejects.toThrow(PayrollError);
    });
  });

  // ── clearCache ─────────────────────────────────────────────────────────────

  describe("clearCache", () => {
    it("sends CLEAR_CACHE and resolves to undefined", async () => {
      const { worker, generator } = setup();
      const promise = generator.clearCache();
      const req = worker.lastRequest();

      expect(req.type).toBe("CLEAR_CACHE");

      worker.reply({ type: "CACHE_CLEARED", id: req.id });
      await expect(promise).resolves.toBeUndefined();
    });
  });

  // ── terminate ──────────────────────────────────────────────────────────────

  describe("terminate", () => {
    it("terminates the underlying worker", () => {
      const { worker, generator } = setup();
      generator.terminate();
      expect(worker.terminated).toBe(true);
    });

    it("rejects all pending requests with PayrollError", async () => {
      const { generator } = setup();
      const p1 = generator.generateProof({ amount: 100n });
      const p2 = generator.generateProof({ amount: 200n });

      generator.terminate();

      await expect(p1).rejects.toThrow(PayrollError);
      await expect(p1).rejects.toThrow(/terminated/);
      await expect(p2).rejects.toThrow(PayrollError);
    });

    it("removes event listeners on terminate", () => {
      const { worker, generator } = setup();
      const removeSpy = jest.spyOn(worker, "removeEventListener");

      generator.terminate();

      expect(removeSpy).toHaveBeenCalledWith("message", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("clears all pending requests so post-terminate replies are no-ops", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ recipient: "GX", amount: 100n, asset: "native" });
      const { id } = worker.lastRequest();

      generator.terminate();
      await expect(promise).rejects.toThrow(PayrollError);

      // Late reply should not throw or cause issues
      expect(() => worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload })).not.toThrow();
    });
  });

  // ── Worker error event ─────────────────────────────────────────────────────

  describe("worker error event", () => {
    it("rejects all in-flight requests when the worker emits an error", async () => {
      const { worker, generator } = setup();
      const p1 = generator.generateProof({ amount: 100n });
      const p2 = generator.generateProof({ amount: 200n });

      worker.crash("Worker crashed unexpectedly");

      await expect(p1).rejects.toThrow(PayrollError);
      await expect(p1).rejects.toThrow(/Worker error/);
      await expect(p2).rejects.toThrow(PayrollError);
    });

    it("clears the pending map after a crash", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ recipient: "GX", amount: 100n, asset: "native" });
      worker.crash("crash");
      await promise.catch(() => {});

      // A subsequent call after the crash should still post a message
      const p2 = generator.generateProof({ amount: 200n });
      const { id } = worker.lastRequest();
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });
      await expect(p2).resolves.toEqual(mockPayload);
    });
  });

  // ── IProofGenerator interface compliance ───────────────────────────────────

  describe("IProofGenerator interface compliance", () => {
    it("satisfies IProofGenerator — generateProof returns a Promise<ProofPayload>", async () => {
      const { worker, generator } = setup();
      const promise = generator.generateProof({ amount: 500n });
      const { id } = worker.lastRequest();
      worker.reply({ type: "PROOF_RESULT", id, payload: mockPayload });

      const result: ProofPayload = await promise;
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("publicSignals");
    });
  });
});
