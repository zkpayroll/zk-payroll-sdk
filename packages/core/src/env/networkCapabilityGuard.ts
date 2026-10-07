import { detectEnvironment } from "./detector";
import { EnvironmentCapabilities } from "./types";
import { PayrollError } from "../errors";

/**
 * Network action capability types for SDK action guarding.
 */
export enum NetworkCapability {
  SIGNING = "signing",
  FETCHING = "fetching",
  POLLING = "polling",
  PROOF_GENERATION = "proof_generation",
}

export interface NetworkCapabilitiesOptions {
  /** Override environment detection results if specified. */
  environment?: EnvironmentCapabilities;
  /** Explicitly disable specific capabilities. */
  disabledCapabilities?: NetworkCapability[];
}

export interface CapabilityCheckResult {
  supported: boolean;
  capability: NetworkCapability;
  reason?: string;
}

/**
 * NetworkCapabilityGuard verifies runtime environment support before executing
 * SDK actions such as signing transactions, fetching data, polling status, or generating proofs.
 */
export class NetworkCapabilityGuard {
  private env: EnvironmentCapabilities;
  private disabled: Set<NetworkCapability>;

  constructor(options?: NetworkCapabilitiesOptions) {
    this.env = options?.environment ?? detectEnvironment();
    this.disabled = new Set(options?.disabledCapabilities ?? []);
  }

  /**
   * Check if signing operations are supported in the current runtime environment.
   */
  public canSign(): CapabilityCheckResult {
    if (this.disabled.has(NetworkCapability.SIGNING)) {
      return {
        supported: false,
        capability: NetworkCapability.SIGNING,
        reason: "Signing is explicitly disabled",
      };
    }
    const supported =
      this.env.hasWalletSupport || this.env.environment === "node";
    return {
      supported,
      capability: NetworkCapability.SIGNING,
      reason: supported
        ? undefined
        : "Signing requires browser wallet support or Node.js environment",
    };
  }

  /**
   * Check if network fetching operations are supported.
   */
  public canFetch(): CapabilityCheckResult {
    if (this.disabled.has(NetworkCapability.FETCHING)) {
      return {
        supported: false,
        capability: NetworkCapability.FETCHING,
        reason: "Fetching is explicitly disabled",
      };
    }
    const supported =
      this.env.capabilities.has("fetch") || this.env.environment === "node";
    return {
      supported,
      capability: NetworkCapability.FETCHING,
      reason: supported
        ? undefined
        : "Fetching is not supported in this runtime environment",
    };
  }

  /**
   * Check if RPC/Transaction polling is supported.
   */
  public canPoll(): CapabilityCheckResult {
    if (this.disabled.has(NetworkCapability.POLLING)) {
      return {
        supported: false,
        capability: NetworkCapability.POLLING,
        reason: "Polling is explicitly disabled",
      };
    }
    const supported = this.env.capabilities.has("rpc_call");
    return {
      supported,
      capability: NetworkCapability.POLLING,
      reason: supported
        ? undefined
        : "Polling requires rpc_call capability in the current environment",
    };
  }

  /**
   * Check if ZK proof generation is supported.
   */
  public canGenerateProof(): CapabilityCheckResult {
    if (this.disabled.has(NetworkCapability.PROOF_GENERATION)) {
      return {
        supported: false,
        capability: NetworkCapability.PROOF_GENERATION,
        reason: "Proof generation is explicitly disabled",
      };
    }
    const supported = this.env.capabilities.has("proof_generation");
    return {
      supported,
      capability: NetworkCapability.PROOF_GENERATION,
      reason: supported
        ? undefined
        : "Proof generation requires WebAssembly and Crypto API capabilities",
    };
  }

  /**
   * Assert that a specified network capability is available, throwing PayrollError if unavailable.
   */
  public assertCapability(capability: NetworkCapability): void {
    let result: CapabilityCheckResult;
    switch (capability) {
      case NetworkCapability.SIGNING:
        result = this.canSign();
        break;
      case NetworkCapability.FETCHING:
        result = this.canFetch();
        break;
      case NetworkCapability.POLLING:
        result = this.canPoll();
        break;
      case NetworkCapability.PROOF_GENERATION:
        result = this.canGenerateProof();
        break;
      default:
        throw new PayrollError(
          `Unknown network capability: ${capability}`,
          "INVALID_CAPABILITY" as any,
        );
    }

    if (!result.supported) {
      throw new PayrollError(
        `Network capability '${capability}' is not supported in this environment: ${result.reason}`,
        "UNSUPPORTED_ENVIRONMENT" as any,
      );
    }
  }
}
