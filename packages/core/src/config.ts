import { ProofGeneratorConfig } from "./crypto/IProofGenerator";
import { StrKey } from "@stellar/stellar-sdk";

export interface RetryPolicyConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

export interface ClientConfig {
  networkUrl: string;
  contractId: string;
  adminKey?: string;
  proofConfig?: ProofGeneratorConfig;
  retryPolicy?: RetryPolicyConfig;
}

export class ConfigBuilder {
  private _networkUrl?: string;
  private _contractId?: string;
  private _adminKey?: string;
  private _proofConfig?: ProofGeneratorConfig;
  private _retryPolicy?: RetryPolicyConfig;

  constructor(preset?: Partial<ClientConfig>) {
    if (preset) {
      this._networkUrl = preset.networkUrl;
      this._contractId = preset.contractId;
      this._adminKey = preset.adminKey;
      this._proofConfig = preset.proofConfig;
      this._retryPolicy = preset.retryPolicy;
    }
  }

  public withNetworkUrl(url: string): this {
    this._networkUrl = url;
    return this;
  }

  public withContractId(id: string): this {
    this._contractId = id;
    return this;
  }

  public withAdminKey(key: string): this {
    this._adminKey = key;
    return this;
  }

  public withProofConfig(config: ProofGeneratorConfig): this {
    this._proofConfig = config;
    return this;
  }

  public withRetryPolicy(policy: RetryPolicyConfig): this {
    this._retryPolicy = policy;
    return this;
  }

  public build(): ClientConfig {
    const errors: string[] = [];

    if (!this._networkUrl) {
      errors.push("networkUrl is required.");
    } else {
      try {
        new URL(this._networkUrl);
      } catch {
        errors.push(`networkUrl is malformed: ${this._networkUrl}`);
      }
    }

    if (!this._contractId) {
      errors.push("contractId is required.");
    } else if (!StrKey.isValidContract(this._contractId)) {
      errors.push(`contractId is malformed: ${this._contractId}`);
    }

    if (this._proofConfig) {
      if (!this._proofConfig.wasmUrl) errors.push("proofConfig.wasmUrl is required.");
      if (!this._proofConfig.zkeyUrl) errors.push("proofConfig.zkeyUrl is required.");
    }

    if (this._retryPolicy) {
      if (this._retryPolicy.maxAttempts !== undefined && this._retryPolicy.maxAttempts < 1) {
        errors.push("retryPolicy.maxAttempts must be at least 1.");
      }
      if (this._retryPolicy.initialDelayMs !== undefined && this._retryPolicy.initialDelayMs < 0) {
        errors.push("retryPolicy.initialDelayMs cannot be negative.");
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n- ${errors.join("\n- ")}`);
    }

    return {
      networkUrl: this._networkUrl!,
      contractId: this._contractId!,
      adminKey: this._adminKey,
      proofConfig: this._proofConfig,
      retryPolicy: this._retryPolicy,
    };
  }
}

export const ConfigPresets = {
  local(): ConfigBuilder {
    return new ConfigBuilder({
      networkUrl: "http://localhost:8000",
    });
  },
  testnet(): ConfigBuilder {
    return new ConfigBuilder({
      networkUrl: "https://soroban-testnet.stellar.org",
    });
  },
  production(): ConfigBuilder {
    return new ConfigBuilder({
      networkUrl: "https://soroban-rpc.mainnet.stellar.org",
    });
  },
};

// Keep DEFAULT_CONFIG for backward compatibility, although users should migrate to presets
export const DEFAULT_CONFIG: ClientConfig = {
  networkUrl: "https://soroban-testnet.stellar.org",
  contractId: "",
};
