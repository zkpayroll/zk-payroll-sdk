# ZK Proof Generation Pipeline Architecture

## Problem

ZK proof generation with snarkjs (Groth16) is CPU-intensive, typically taking 1–10 seconds depending on circuit complexity. Running this on the main thread blocks the UI in browsers and the event loop in Node.js, degrading user experience and server throughput.

This document describes the selected architecture for offloading proof generation and the tradeoffs considered.

## IProofGenerator Interface

All proof generation strategies implement the `IProofGenerator` interface (`src/crypto/IProofGenerator.ts`):

```typescript
interface IProofGenerator {
  generateProof(witness: Record<string, unknown>): Promise<ProofPayload>;
}
```

This async interface is environment-agnostic — callers do not know whether the proof is generated on the main thread, in a Web Worker, or in a Node.js Worker Thread. New strategies are added by implementing this interface.

### Current Implementations

| Class | Environment | Threading |
|-------|-------------|-----------|
| `SnarkjsProofGenerator` | Browser / Node.js | Main thread (blocking) |
| `WorkerProofGenerator` | Browser | Web Worker (non-blocking) |
| `ThreadProofGenerator` | Node.js | Worker Thread (non-blocking) |

## Approach Options Evaluated

### Option A: Main Thread (current `SnarkjsProofGenerator`)

**How it works:** `groth16.fullProve()` runs directly in the calling thread.

| Pros | Cons |
|------|------|
| Simplest implementation | Blocks UI in browsers (freezes for 1–10s) |
| No serialization overhead | Blocks event loop in Node.js |
| Works in all environments | Cannot show progress feedback |
| Easy to debug | Poor UX for complex circuits |

**Verdict:** Acceptable only for server-side batch jobs or very small circuits (<1s).

### Option B: Web Worker (browser) — Selected for Browser

**How it works:** A dedicated Web Worker runs `groth16.fullProve()`. The main thread sends the witness via `postMessage()` and receives the proof back asynchronously.

| Pros | Cons |
|------|------|
| Non-blocking UI | Requires bundler support (worker URL) |
| Can report progress via messages | Serialization overhead for large witnesses |
| Works with snarkjs (snarkjs is Worker-compatible) | Cannot share memory with main thread easily |
| Natural fit for browser environment | Artifact fetching happens inside Worker |

**snarkjs Web Worker compatibility:**
- snarkjs `groth16.fullProve()` is fully synchronous once artifacts are loaded — it does not depend on DOM APIs.
- The `.wasm` circuit file is executed via WebAssembly, which works inside Web Workers.
- The `.zkey` file is read as `Uint8Array`, which is transferable via `postMessage()`.
- Artifacts can be fetched inside the Worker (using `fetch()`) or transferred from the main thread.

**Message protocol:**

```
Main Thread                          Web Worker
    |                                     |
    |-- { type: "generate",  ------------>|
    |     witness, wasmUrl, zkeyUrl }     |
    |                                     |-- fetch artifacts
    |                                     |-- groth16.fullProve()
    |<-- { type: "result",  --------------|
    |     proof, publicSignals }          |
    |                                     |
    |<-- { type: "error", message } ------|  (on failure)
```

### Option C: Node.js Worker Thread — Selected for Node.js

**How it works:** A `worker_threads.Worker` runs the proof generation. Communication uses `parentPort.postMessage()`.

| Pros | Cons |
|------|------|
| Non-blocking event loop | Slightly more complex setup |
| Can use `SharedArrayBuffer` for artifacts | Serialization cost for proof results |
| Good for server-side concurrent proofs | Extra memory per thread |
| `worker_threads` is stable Node.js API | |

**snarkjs Worker Thread compatibility:**
- snarkjs works in Worker Threads — it uses only standard Node.js APIs.
- Circuit `.wasm` is loaded via WebAssembly, which is available in Worker Threads.
- Artifacts can be shared via `SharedArrayBuffer` to avoid copying large `.zkey` files.

### Option D: WASM Threading (SharedArrayBuffer + pthreads)

**How it works:** Compile the circuit with multi-threaded WASM support using `--thread` flag in circom, leveraging `SharedArrayBuffer` and Web Workers internally.

| Pros | Cons |
|------|------|
| Fastest possible proving time | Requires `Cross-Origin-Isolation` headers |
| Parallel constraint evaluation | Not all browsers support it |
| Built into WASM runtime | Complex deployment requirements |
| | Circuit must be compiled with thread support |

**Verdict:** Future optimization. Too many deployment constraints for initial release.

## Selected Approach

**Hybrid strategy based on runtime environment:**

1. **Browser:** `WorkerProofGenerator` using Web Workers
2. **Node.js:** `ThreadProofGenerator` using `worker_threads`
3. **Fallback:** `SnarkjsProofGenerator` on main thread (when Workers unavailable)

The `IProofGenerator` interface ensures all three are interchangeable. Consumers choose the implementation at construction time, or use a factory that auto-detects the environment:

```typescript
import { createProofGenerator } from "@zk-payroll/sdk";

// Auto-detects: Web Worker in browser, Worker Thread in Node.js, main-thread fallback
const generator = createProofGenerator(config);
const proof = await generator.generateProof(witness);
```

## Implementation Plan

### Phase 1 (Current)
- [x] `IProofGenerator` interface defined
- [x] `SnarkjsProofGenerator` — main-thread implementation
- [x] Proof caching via `CacheProvider`

### Phase 2 (Next)
- [ ] `WorkerProofGenerator` — Web Worker wrapper around snarkjs
- [ ] `ThreadProofGenerator` — Node.js Worker Thread wrapper
- [ ] `createProofGenerator()` factory with environment detection
- [ ] Progress callback support via `onProgress` option

### Phase 3 (Future)
- [ ] WASM multi-threading support (SharedArrayBuffer)
- [ ] Proof generation queue for batching multiple proofs
- [ ] Server-side proving service as alternative to client-side

## Worker Implementation Guidelines

### Web Worker (`WorkerProofGenerator`)

```typescript
// worker-proof.ts (runs in Web Worker)
import { groth16 } from "snarkjs";

self.onmessage = async (event) => {
  const { witness, wasmUrl, zkeyUrl } = event.data;
  try {
    const [wasmResp, zkeyResp] = await Promise.all([
      fetch(wasmUrl).then(r => r.arrayBuffer()),
      fetch(zkeyUrl).then(r => r.arrayBuffer()),
    ]);
    const { proof, publicSignals } = await groth16.fullProve(
      witness, new Uint8Array(wasmResp), new Uint8Array(zkeyResp)
    );
    self.postMessage({ type: "result", proof, publicSignals });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
```

```typescript
// WorkerProofGenerator.ts (main thread)
class WorkerProofGenerator implements IProofGenerator {
  async generateProof(witness: Record<string, unknown>): Promise<ProofPayload> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./worker-proof", import.meta.url));
      worker.postMessage({ witness, wasmUrl: this.config.wasmUrl, zkeyUrl: this.config.zkeyUrl });
      worker.onmessage = (event) => {
        if (event.data.type === "result") {
          resolve(this.formatPayload(event.data));
        } else {
          reject(new PayrollError(event.data.message, 500));
        }
        worker.terminate();
      };
    });
  }
}
```

### Node.js Worker Thread (`ThreadProofGenerator`)

```typescript
// thread-proof.ts (runs in Worker Thread)
import { parentPort, workerData } from "worker_threads";
import { groth16 } from "snarkjs";
import fs from "fs/promises";

const { witness, wasmPath, zkeyPath } = workerData;
const [wasm, zkey] = await Promise.all([
  fs.readFile(wasmPath),
  fs.readFile(zkeyPath),
]);
const { proof, publicSignals } = await groth16.fullProve(witness, wasm, zkey);
parentPort.postMessage({ type: "result", proof, publicSignals });
```

## Performance Expectations

| Strategy | Blocking? | Overhead | Best For |
|----------|-----------|----------|----------|
| Main thread | Yes | None | Simple scripts, tests |
| Web Worker | No | ~50ms setup + message serialization | Browser apps |
| Worker Thread | No | ~20ms setup + message serialization | Node.js servers |
| WASM pthreads | No | Minimal (shared memory) | High-throughput (future) |

## Security Notes

- Worker scripts must be same-origin or bundled inline (no CDN worker scripts)
- Witness data crosses thread boundaries via structured clone — no shared memory exposure
- Artifacts fetched inside Workers inherit the Worker's origin/CSP policy
- `SharedArrayBuffer` (Phase 3) requires `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers

## References

- [snarkjs GitHub](https://github.com/iden3/snarkjs)
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [Node.js worker_threads](https://nodejs.org/api/worker_threads.html)
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
