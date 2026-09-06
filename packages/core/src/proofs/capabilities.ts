/**
 * Proof mode capability map module (#285).
 *
 * Provides a dynamic evaluation map of supported zero-knowledge proof modes
 * by environment, target network, artifact availability, and runtime capabilities.
 */

/**
 * Known proof generation protocols/modes supported by the SDK.
 */
export type ProofMode = "groth16" | "mock" | "plonk" | "bulletproofs";

/**
 * Execution runtime environment types.
 */
export type ExecutionEnvironment =
  | "node"
  | "browser"
  | "web-worker"
  | "serverless"
  | "unknown";

/**
 * Stellar networks supported by ZkPayroll contracts.
 */
export type StellarNetwork = "mainnet" | "testnet" | "futurenet" | "standalone" | "local";

/**
 * Performance profile for proof generation.
 */
export type ProofPerformanceTier = "instant" | "fast" | "moderate" | "heavy";

/**
 * Context parameters used to evaluate proof mode readiness.
 */
export interface ProofCapabilityContext {
  /** Target execution environment (auto-detected if omitted) */
  environment?: ExecutionEnvironment;
  /** Stellar network target (defaults to testnet) */
  network?: StellarNetwork | string;
  /** Whether circuit proving artifacts (.wasm, .zkey) are present and accessible */
  hasArtifacts?: boolean;
  /** Custom flag indicating whether WebAssembly is available */
  hasWasm?: boolean;
  /** Custom flag indicating whether BigInt is supported */
  hasBigInt?: boolean;
  /** Custom flag indicating whether WebCrypto/Node crypto is available */
  hasCrypto?: boolean;
}

/**
 * Prerequisites checklist for a proof mode.
 */
export interface ProofModePrerequisites {
  wasmSupported: boolean;
  bigIntSupported: boolean;
  cryptoSupported: boolean;
  artifactsAvailable: boolean;
  networkPermitted: boolean;
  environmentPermitted: boolean;
}

/**
 * Evaluated capability status for a specific proof mode.
 */
export interface ProofModeCapability {
  /** The proof mode identifier */
  mode: ProofMode;
  /** Display label for documentation and UI */
  label: string;
  /** Whether the SDK contains architectural support for this mode */
  supported: boolean;
  /** Whether all environmental and network prerequisites are satisfied for execution */
  available: boolean;
  /** Estimated proving performance tier */
  performanceTier: ProofPerformanceTier;
  /** Clear explanation of why this mode is available or unavailable */
  reason: string;
  /** Actionable next steps if currently unavailable */
  remediation?: string;
  /** Granular prerequisite evaluation results */
  prerequisites: ProofModePrerequisites;
  /** Target networks that allow this proof mode */
  permittedNetworks: readonly string[];
}

/**
 * Full mapping of all proof modes to their capability records.
 */
export type ProofModeCapabilityMap = Record<ProofMode, ProofModeCapability>;

/**
 * Detects the current runtime environment safely across platforms.
 */
export function detectEnvironment(): ExecutionEnvironment {
  // Safe global scope inspection without requiring DOM/WebWorker type declarations
  const globalScope = typeof globalThis !== "undefined" ? (globalThis as Record<string, unknown>) : {};

  // Web Worker detection
  if (
    typeof globalScope.WorkerGlobalScope !== "undefined" &&
    typeof (globalScope as { self?: unknown }).self !== "undefined"
  ) {
    return "web-worker";
  }

  // Node.js detection
  if (
    typeof process !== "undefined" &&
    process.versions != null &&
    process.versions.node != null
  ) {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) {
      return "serverless";
    }
    return "node";
  }

  // Browser detection
  if (typeof globalScope.window !== "undefined" && typeof (globalScope.window as Record<string, unknown>).document !== "undefined") {
    return "browser";
  }

  return "unknown";
}

/**
 * Detects whether WebAssembly runtime support is present.
 */
export function isWasmSupported(): boolean {
  try {
    if (typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function") {
      const module = new WebAssembly.Module(
        Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
      );
      return module instanceof WebAssembly.Module;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Detects whether BigInt is supported in the current engine.
 */
export function isBigIntSupported(): boolean {
  return typeof BigInt !== "undefined";
}

/**
 * Detects whether WebCrypto or Node crypto is available.
 */
export function isCryptoSupported(): boolean {
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    return true;
  }
  return false;
}

/**
 * Generates the full ProofModeCapabilityMap based on current or provided context.
 *
 * @param context - Optional environment, network, and artifact availability overrides.
 * @returns Map of proof modes to capability descriptors.
 */
export function getProofModeCapabilities(
  context: ProofCapabilityContext = {}
): ProofModeCapabilityMap {
  const env = context.environment ?? detectEnvironment();
  const network = (context.network ?? "testnet").toLowerCase();
  const hasWasm = context.hasWasm ?? isWasmSupported();
  const hasBigInt = context.hasBigInt ?? isBigIntSupported();
  const hasCrypto = context.hasCrypto ?? isCryptoSupported();
  const hasArtifacts = context.hasArtifacts ?? true;

  const isMainnet = network === "mainnet";

  // 1. Groth16 (Primary production proving mode)
  const groth16Prereqs: ProofModePrerequisites = {
    wasmSupported: hasWasm,
    bigIntSupported: hasBigInt,
    cryptoSupported: hasCrypto,
    artifactsAvailable: hasArtifacts,
    networkPermitted: true,
    environmentPermitted: env !== "unknown",
  };

  const groth16Available =
    groth16Prereqs.wasmSupported &&
    groth16Prereqs.bigIntSupported &&
    groth16Prereqs.cryptoSupported &&
    groth16Prereqs.artifactsAvailable &&
    groth16Prereqs.environmentPermitted;

  let groth16Reason = "Groth16 proving is fully operational and ready for payroll transactions.";
  let groth16Remediation: string | undefined;

  if (!groth16Available) {
    if (!groth16Prereqs.artifactsAvailable) {
      groth16Reason = "Proving artifacts (.wasm, .zkey) are missing or not loaded.";
      groth16Remediation = "Download proving artifacts via the artifact downloader before generating proofs.";
    } else if (!groth16Prereqs.wasmSupported) {
      groth16Reason = "WebAssembly is not supported or enabled in the current runtime.";
      groth16Remediation = "Enable WASM in your JavaScript runtime or browser environment.";
    } else if (!groth16Prereqs.cryptoSupported) {
      groth16Reason = "Cryptographic primitives (crypto/subtle) are unavailable in this environment.";
      groth16Remediation = "Ensure globalThis.crypto or Node crypto is available.";
    }
  }

  const groth16Capability: ProofModeCapability = {
    mode: "groth16",
    label: "Groth16 (SNARK)",
    supported: true,
    available: groth16Available,
    performanceTier: env === "browser" ? "moderate" : "fast",
    reason: groth16Reason,
    remediation: groth16Remediation,
    prerequisites: groth16Prereqs,
    permittedNetworks: ["mainnet", "testnet", "futurenet", "standalone", "local"],
  };

  // 2. Mock Mode (Fast simulated proving for tests and non-production environments)
  const mockPrereqs: ProofModePrerequisites = {
    wasmSupported: true, // Mock does not require wasm
    bigIntSupported: hasBigInt,
    cryptoSupported: true,
    artifactsAvailable: true, // Mock synthesizes dummy proofs
    networkPermitted: !isMainnet, // Strictly forbidden on Mainnet
    environmentPermitted: true,
  };

  const mockAvailable = mockPrereqs.networkPermitted && mockPrereqs.bigIntSupported;
  let mockReason = "Mock proving is available for offline testing and testnet simulations.";
  let mockRemediation: string | undefined;

  if (isMainnet) {
    mockReason = "Mock proof mode is strictly disabled on Stellar Mainnet to preserve security invariants.";
    mockRemediation = "Switch to 'groth16' proof mode for Mainnet submissions.";
  }

  const mockCapability: ProofModeCapability = {
    mode: "mock",
    label: "Mock (Offline Simulation)",
    supported: true,
    available: mockAvailable,
    performanceTier: "instant",
    reason: mockReason,
    remediation: mockRemediation,
    prerequisites: mockPrereqs,
    permittedNetworks: ["testnet", "futurenet", "standalone", "local"],
  };

  // 3. Plonk (Experimental universal setup mode)
  const plonkPrereqs: ProofModePrerequisites = {
    wasmSupported: hasWasm,
    bigIntSupported: hasBigInt,
    cryptoSupported: hasCrypto,
    artifactsAvailable: false, // Core bundle does not package PLONK circuits by default
    networkPermitted: !isMainnet,
    environmentPermitted: env !== "unknown",
  };

  const plonkCapability: ProofModeCapability = {
    mode: "plonk",
    label: "PLONK (Universal SNARK)",
    supported: false,
    available: false,
    performanceTier: "heavy",
    reason: "PLONK proving circuits are not bundled in standard SDK distributions.",
    remediation: "Use 'groth16' for production contracts, or install the optional @zk-payroll/plonk-adapter package.",
    prerequisites: plonkPrereqs,
    permittedNetworks: ["testnet", "futurenet"],
  };

  // 4. Bulletproofs (Reserved future mode)
  const bulletproofsPrereqs: ProofModePrerequisites = {
    wasmSupported: hasWasm,
    bigIntSupported: hasBigInt,
    cryptoSupported: hasCrypto,
    artifactsAvailable: false,
    networkPermitted: false,
    environmentPermitted: false,
  };

  const bulletproofsCapability: ProofModeCapability = {
    mode: "bulletproofs",
    label: "Bulletproofs (Transparent Proofs)",
    supported: false,
    available: false,
    performanceTier: "heavy",
    reason: "Bulletproofs are not currently supported by Soroban contract verifiers.",
    remediation: "Use 'groth16' which has native Soroban smart contract verifiers.",
    prerequisites: bulletproofsPrereqs,
    permittedNetworks: [],
  };

  return {
    groth16: groth16Capability,
    mock: mockCapability,
    plonk: plonkCapability,
    bulletproofs: bulletproofsCapability,
  };
}

/**
 * Returns capability details for a specific proof mode.
 */
export function getProofModeCapability(
  mode: string,
  context?: ProofCapabilityContext
): ProofModeCapability | undefined {
  const capabilities = getProofModeCapabilities(context);
  return capabilities[mode as ProofMode];
}

/**
 * Checks whether a specific proof mode is supported and available in the given context.
 */
export function isProofModeAvailable(
  mode: string,
  context?: ProofCapabilityContext
): boolean {
  const cap = getProofModeCapability(mode, context);
  return cap ? cap.available : false;
}

/**
 * Returns a list of all currently available proof modes.
 */
export function getAvailableProofModes(
  context?: ProofCapabilityContext
): ProofMode[] {
  const capabilities = getProofModeCapabilities(context);
  return (Object.keys(capabilities) as ProofMode[]).filter(
    (m) => capabilities[m].available
  );
}

/**
 * Formats capability status into a readable diagnostic string.
 */
export function formatProofModeCapabilities(
  capabilities: ProofModeCapabilityMap
): string {
  const lines: string[] = ["=== ZkPayroll Proof Mode Capabilities ==="];
  for (const [mode, cap] of Object.entries(capabilities)) {
    const status = cap.available ? "✅ AVAILABLE" : cap.supported ? "⚠️ UNAVAILABLE" : "❌ UNSUPPORTED";
    lines.push(`- [${mode.toUpperCase()}] ${cap.label}: ${status}`);
    lines.push(`  Reason: ${cap.reason}`);
    if (cap.remediation) {
      lines.push(`  Remediation: ${cap.remediation}`);
    }
  }
  return lines.join("\n");
}
