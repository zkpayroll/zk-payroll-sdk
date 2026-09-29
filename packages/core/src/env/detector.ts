import {
  EnvironmentCapabilities,
  RuntimeEnvironment,
  Capability,
  SdkOperationCapability,
} from "./types";

/**
 * Detects the current runtime environment and available capabilities.
 *
 * This function inspects global objects to determine whether the code is
 * running in a browser, web worker, Node.js backend, or an unknown
 * environment. It returns a structured result with all detected capabilities.
 *
 * @example
 * ```typescript
 * const env = detectEnvironment();
 * if (env.environment === "browser") {
 *   // Safe to use wallet adapters
 * }
 * ```
 */
export function detectEnvironment(): EnvironmentCapabilities {
  const runtime = detectRuntime();
  const capabilities = new Set<Capability>();

  if (runtime === "browser" || runtime === "worker") {
    if (typeof fetch !== "undefined") capabilities.add("fetch");
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      capabilities.add("crypto.getRandomValues");
    }
    if (typeof WebAssembly !== "undefined") capabilities.add("wasm");
    if (typeof localStorage !== "undefined") capabilities.add("localStorage");
    if (typeof indexedDB !== "undefined") capabilities.add("indexedDB");
    if (runtime === "worker" || typeof Worker !== "undefined") capabilities.add("web_worker");

    // RPC calls via fetch are available in browser environments
    capabilities.add("rpc_call");

    // Wallet connections only work in browser context (not workers)
    if (runtime === "browser") {
      capabilities.add("wallet_connection");
    }
  }

  if (runtime === "node") {
    capabilities.add("rpc_call");
    capabilities.add("file_system");
    if (typeof WebAssembly !== "undefined") capabilities.add("wasm");
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      capabilities.add("crypto.getRandomValues");
    }
  }

  // Proof generation requires wasm + crypto
  if (capabilities.has("wasm") && capabilities.has("crypto.getRandomValues")) {
    capabilities.add("proof_generation");
  }

  return {
    environment: runtime,
    capabilities,
    hasWalletSupport: capabilities.has("wallet_connection"),
    hasWasm: capabilities.has("wasm"),
    hasCrypto: capabilities.has("crypto.getRandomValues"),
  };
}

function detectRuntime(): RuntimeEnvironment {
  // Web Worker (self only, no window)
  if (
    typeof self !== "undefined" &&
    typeof (self as unknown as { document: unknown }).document === "undefined" &&
    typeof (self as unknown as { importScripts: unknown }).importScripts === "function"
  ) {
    return "worker";
  }

  // Browser (window exists)
  if (typeof window !== "undefined" && typeof window.document !== "undefined") {
    return "browser";
  }

  // Node.js
  if (
    typeof process !== "undefined" &&
    process.versions !== null &&
    typeof process.versions.node === "string"
  ) {
    return "node";
  }

  return "unknown";
}

// ── SDK Operation Registry ─────────────────────────────────────────────────

const SDK_OPERATIONS: SdkOperationCapability[] = [
  {
    operation: "connectWallet",
    requiredCapabilities: ["wallet_connection"],
    requiresBackend: false,
  },
  {
    operation: "signTransaction",
    requiredCapabilities: ["wallet_connection"],
    requiresBackend: false,
  },
  {
    operation: "submitPayment",
    requiredCapabilities: ["rpc_call"],
    requiresBackend: true,
  },
  {
    operation: "generateProof",
    requiredCapabilities: ["proof_generation"],
    requiresBackend: false,
  },
  {
    operation: "generateProofWorker",
    requiredCapabilities: ["web_worker", "proof_generation"],
    requiresBackend: false,
  },
  {
    operation: "simulatePayroll",
    requiredCapabilities: ["rpc_call"],
    requiresBackend: true,
  },
  {
    operation: "pollTransaction",
    requiredCapabilities: ["rpc_call"],
    requiresBackend: false,
  },
  {
    operation: "validateEnvironment",
    requiredCapabilities: ["rpc_call"],
    requiresBackend: true,
  },
  {
    operation: "estimateFee",
    requiredCapabilities: ["rpc_call"],
    requiresBackend: false,
  },
  {
    operation: "summarizeTransaction",
    requiredCapabilities: [],
    requiresBackend: false,
  },
  {
    operation: "detectDuplicatePayment",
    requiredCapabilities: [],
    requiresBackend: false,
  },
];

/**
 * Checks whether a specific SDK operation is safe to run in the current environment.
 *
 * @param operationName - Name of the SDK operation to check
 * @param environment - Optional pre-detected environment (calls detectEnvironment() if omitted)
 * @returns Whether the operation is supported and if not, which capabilities are missing
 */
export function canRunOperation(
  operationName: string,
  environment?: EnvironmentCapabilities
): { supported: boolean; missing: Capability[]; requiresBackend: boolean } {
  const env = environment ?? detectEnvironment();
  const op = SDK_OPERATIONS.find((o) => o.operation === operationName);

  if (!op) {
    return { supported: false, missing: [], requiresBackend: false };
  }

  const missing = op.requiredCapabilities.filter((cap) => !env.capabilities.has(cap));

  return {
    supported: missing.length === 0,
    missing,
    requiresBackend: op.requiresBackend,
  };
}

/**
 * Returns all SDK operations and their capability requirements.
 * Useful for documentation or UI that shows environment compatibility.
 */
export function listOperations(): SdkOperationCapability[] {
  return [...SDK_OPERATIONS];
}
