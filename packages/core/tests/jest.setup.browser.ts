/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { TextEncoder, TextDecoder } from "util";
import { webcrypto } from "crypto";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// jsdom exposes a `crypto` global without `crypto.subtle`, which breaks
// Web-Crypto-based features (sha256Digest etc.) under the browser config.
// Restore the full Web Crypto implementation so those tests behave like a
// real browser.
const g = globalThis as any;
if (typeof g.crypto?.subtle === "undefined" && typeof webcrypto?.subtle !== "undefined") {
  try {
    Object.defineProperty(g, "crypto", { value: webcrypto, writable: true, configurable: true });
  } catch {
    g.crypto.subtle = webcrypto.subtle;
  }
}

// jsdom does not provide setImmediate/clearImmediate; polyfill them on the
// event loop so tests can drain the microtask/macrotask queue.
if (typeof g.setImmediate === "undefined") {
  g.setImmediate = (fn: (...args: any[]) => void, ...args: any[]) =>
    setTimeout(() => fn(...args), 0);
  g.clearImmediate = (id: unknown) => clearTimeout(id as any);
}

// Polyfill Worker for web-worker / ffjavascript multi-threading initialization
if (typeof global.Worker === "undefined") {
  global.Worker = class MockWorker {
    public onmessage: ((this: Worker, ev: MessageEvent) => any) | null = null;
    public onerror: ((this: Worker, ev: ErrorEvent) => any) | null = null;

    constructor(stringUrl: string | URL, options?: WorkerOptions) {
      // Instance initialized inside JSDOM container
    }

    postMessage(message: any, transfer?: any[]): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return true;
    }
  } as any;
}
