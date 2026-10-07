/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { TextEncoder, TextDecoder } from "util";
import { webcrypto } from "crypto";
import { setImmediate, clearImmediate } from "timers";
import { Buffer as NodeBuffer } from "buffer";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

const globalAny = global as any;

// jsdom does not expose WebCrypto; polyfill from Node so sha256Digest and
// other crypto.subtle-based helpers work in the browser test environment.
// Use defineProperty because jsdom defines `crypto` with a getter that
// silently rejects plain assignment.
if (!globalAny.crypto?.subtle) {
  Object.defineProperty(global, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

// jsdom has no setImmediate/clearImmediate; some async test helpers rely on
// them to flush microtasks between event loop ticks.
if (typeof globalAny.setImmediate === "undefined") {
  globalAny.setImmediate = setImmediate;
  globalAny.clearImmediate = clearImmediate;
}

// Some vendored browser bundles (e.g. the minified stellar-sdk bundle) expect
// a real Buffer for XDR encoding. Jest's jsdom environment installs a shimmed
// Buffer that the bundle's instanceof/Uint8Array checks reject, so replace it
// with Node's canonical Buffer unconditionally.
globalAny.Buffer = NodeBuffer;

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
