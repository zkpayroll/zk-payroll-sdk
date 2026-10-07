import type { ProofGeneratorConfig } from "./crypto/IProofGenerator";
let StrKeyModule: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  StrKeyModule = require("@stellar/stellar-sdk")?.StrKey;
} catch {
  // fallback for environments without stellar-sdk in node_modules
}
import { ValidationError } from "./core/errors";

export interface RetryPolicyConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

export type FeatureFlagsConfig = Record<string, boolean>;

export interface ClientConfig {
  networkUrl: string;
  rpcUrl?: string;
  network?: string;
  contractId: string;
  contractIds?: Record<string, string>;
  adminKey?: string;
  proofConfig?: ProofGeneratorConfig;
  retryPolicy?: RetryPolicyConfig;
  featureFlags?: FeatureFlagsConfig;
}

export interface ConfigValidationErrorDetail {
  field: string;
  message: string;
}

export interface ConfigValidationResult {
  isValid: boolean;
  errors: ConfigValidationErrorDetail[];
}

function isValidContractId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  try {
    if (StrKeyModule && typeof StrKeyModule.isValidContract === "function") {
      return StrKeyModule.isValidContract(id);
    }
  } catch {
    // fallback to Soroban contract ID regex pattern
  }
  return /^C[A-Z2-7]{55}$/.test(id);
}

/**
 * Validates SDK configuration values such as network, RPC URL, contract IDs,
 * artifact locations, retry policy, and feature flags.
 *
 * @param config - Partial configuration object to validate.
 * @returns ConfigValidationResult containing boolean `isValid` and error details.
 */
export function validateConfig(
  config?: Partial<ClientConfig>,
): ConfigValidationResult {
  const errors: ConfigValidationErrorDetail[] = [];

  if (!config) {
    return {
      isValid: false,
      errors: [
        { field: "config", message: "Configuration object is required." },
      ],
    };
  }

  // 1. Validate RPC URL / networkUrl
  const effectiveUrl = config.rpcUrl || config.networkUrl;
  if (!effectiveUrl || effectiveUrl.trim() === "") {
    errors.push({
      field: "networkUrl",
      message: "networkUrl (or rpcUrl) is required.",
    });
  } else {
    try {
      const parsedUrl = new URL(effectiveUrl);
      if (!["http:", "https:", "ws:", "wss:"].includes(parsedUrl.protocol)) {
        errors.push({
          field: "networkUrl",
          message: `networkUrl must use http, https, ws, or wss protocol: ${effectiveUrl}`,
        });
      }
    } catch {
      errors.push({
        field: "networkUrl",
        message: `networkUrl is malformed: ${effectiveUrl}`,
      });
    }
  }

  // 2. Validate network name/passphrase if specified
  if (
    config.network !== undefined &&
    (typeof config.network !== "string" || config.network.trim() === "")
  ) {
    errors.push({
      field: "network",
      message: "network must be a non-empty string.",
    });
  }

  // 3. Validate contract ID / contract IDs
  const hasContractId = Boolean(
    config.contractId && config.contractId.trim() !== "",
  );
  const hasContractIds = Boolean(
    config.contractIds &&
    typeof config.contractIds === "object" &&
    Object.keys(config.contractIds).length > 0,
  );

  if (!hasContractId && !hasContractIds) {
    errors.push({
      field: "contractId",
      message: "contractId (or contractIds) is required.",
    });
  } else {
    if (hasContractId) {
      if (!isValidContractId(config.contractId!)) {
        errors.push({
          field: "contractId",
          message: `contractId is malformed: ${config.contractId}`,
        });
      }
    }
    if (hasContractIds) {
      for (const [key, idVal] of Object.entries(config.contractIds!)) {
        if (!isValidContractId(idVal)) {
          errors.push({
            field: `contractIds.${key}`,
            message: `contractIds.${key} is malformed: ${idVal}`,
          });
        }
      }
    }
  }

  // 4. Validate proof artifact locations
  if (config.proofConfig) {
    if (
      !config.proofConfig.wasmUrl ||
      config.proofConfig.wasmUrl.trim() === ""
    ) {
      errors.push({
        field: "proofConfig.wasmUrl",
        message: "proofConfig.wasmUrl is required.",
      });
    }
    if (
      !config.proofConfig.zkeyUrl ||
      config.proofConfig.zkeyUrl.trim() === ""
    ) {
      errors.push({
        field: "proofConfig.zkeyUrl",
        message: "proofConfig.zkeyUrl is required.",
      });
    }
  }

  // 5. Validate retry policy
  if (config.retryPolicy) {
    const { maxAttempts, initialDelayMs, maxDelayMs, backoffFactor } =
      config.retryPolicy;

    if (
      maxAttempts !== undefined &&
      (typeof maxAttempts !== "number" || maxAttempts < 1)
    ) {
      errors.push({
        field: "retryPolicy.maxAttempts",
        message: "retryPolicy.maxAttempts must be at least 1.",
      });
    }
    if (
      initialDelayMs !== undefined &&
      (typeof initialDelayMs !== "number" || initialDelayMs < 0)
    ) {
      errors.push({
        field: "retryPolicy.initialDelayMs",
        message: "retryPolicy.initialDelayMs cannot be negative.",
      });
    }
    if (
      maxDelayMs !== undefined &&
      (typeof maxDelayMs !== "number" || maxDelayMs < 0)
    ) {
      errors.push({
        field: "retryPolicy.maxDelayMs",
        message: "retryPolicy.maxDelayMs cannot be negative.",
      });
    }
    if (
      initialDelayMs !== undefined &&
      maxDelayMs !== undefined &&
      maxDelayMs < initialDelayMs
    ) {
      errors.push({
        field: "retryPolicy.maxDelayMs",
        message:
          "retryPolicy.maxDelayMs must be greater than or equal to initialDelayMs.",
      });
    }
    if (
      backoffFactor !== undefined &&
      (typeof backoffFactor !== "number" || backoffFactor < 1)
    ) {
      errors.push({
        field: "retryPolicy.backoffFactor",
        message: "retryPolicy.backoffFactor must be at least 1.",
      });
    }
  }

  // 6. Validate feature flags
  if (config.featureFlags !== undefined) {
    if (
      typeof config.featureFlags !== "object" ||
      config.featureFlags === null
    ) {
      errors.push({
        field: "featureFlags",
        message: "featureFlags must be an object.",
      });
    } else {
      for (const [flag, val] of Object.entries(config.featureFlags)) {
        if (typeof val !== "boolean") {
          errors.push({
            field: `featureFlags.${flag}`,
            message: `featureFlags.${flag} must be a boolean value.`,
          });
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Asserts that configuration is valid, returning the validated ClientConfig.
 * Throws a structured ValidationError if validation fails.
 *
 * @param config - Partial configuration object.
 * @throws {ValidationError} If validation fails.
 */
export function assertValidConfig(
  config?: Partial<ClientConfig>,
): ClientConfig {
  const result = validateConfig(config);
  if (!result.isValid) {
    const errorMessages = result.errors.map((e) => `- ${e.message}`).join("\n");
    const firstField = result.errors[0]?.field || "config";
    throw new ValidationError(
      `Configuration validation failed:\n${errorMessages}`,
      firstField,
      "CONFIG_VALIDATION_ERROR",
      { errors: result.errors },
    );
  }

  const effectiveUrl = config!.rpcUrl || config!.networkUrl!;
  return {
    networkUrl: effectiveUrl,
    rpcUrl: config!.rpcUrl || effectiveUrl,
    network: config!.network,
    contractId:
      config!.contractId ||
      (config!.contractIds ? Object.values(config!.contractIds)[0] : ""),
    contractIds: config!.contractIds,
    adminKey: config!.adminKey,
    proofConfig: config!.proofConfig,
    retryPolicy: config!.retryPolicy,
    featureFlags: config!.featureFlags,
  };
}

export class ConfigBuilder {
  private _networkUrl?: string;
  private _rpcUrl?: string;
  private _network?: string;
  private _contractId?: string;
  private _contractIds?: Record<string, string>;
  private _adminKey?: string;
  private _proofConfig?: ProofGeneratorConfig;
  private _retryPolicy?: RetryPolicyConfig;
  private _featureFlags?: FeatureFlagsConfig;

  constructor(preset?: Partial<ClientConfig>) {
    if (preset) {
      this._networkUrl = preset.networkUrl;
      this._rpcUrl = preset.rpcUrl;
      this._network = preset.network;
      this._contractId = preset.contractId;
      this._contractIds = preset.contractIds;
      this._adminKey = preset.adminKey;
      this._proofConfig = preset.proofConfig;
      this._retryPolicy = preset.retryPolicy;
      this._featureFlags = preset.featureFlags;
    }
  }

  public withNetworkUrl(url: string): this {
    this._networkUrl = url;
    return this;
  }

  public withRpcUrl(url: string): this {
    this._rpcUrl = url;
    return this;
  }

  public withNetwork(network: string): this {
    this._network = network;
    return this;
  }

  public withContractId(id: string): this {
    this._contractId = id;
    return this;
  }

  public withContractIds(ids: Record<string, string>): this {
    this._contractIds = ids;
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

  public withFeatureFlags(flags: FeatureFlagsConfig): this {
    this._featureFlags = flags;
    return this;
  }

  public validate(): ConfigValidationResult {
    return validateConfig(this.toConfigObject());
  }

  public build(): ClientConfig {
    return assertValidConfig(this.toConfigObject());
  }

  private toConfigObject(): Partial<ClientConfig> {
    return {
      networkUrl: this._networkUrl,
      rpcUrl: this._rpcUrl,
      network: this._network,
      contractId: this._contractId,
      contractIds: this._contractIds,
      adminKey: this._adminKey,
      proofConfig: this._proofConfig,
      retryPolicy: this._retryPolicy,
      featureFlags: this._featureFlags,
    };
  }
}

export const ConfigPresets = {
  local(): ConfigBuilder {
    return new ConfigBuilder({
      networkUrl: "http://localhost:8000",
      rpcUrl: "http://localhost:8000",
      network: "localnet",
    });
  },
  testnet(): ConfigBuilder {
    return new ConfigBuilder({
      networkUrl: "https://soroban-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
    });
  },
  production(): ConfigBuilder {
    return new ConfigBuilder({
      networkUrl: "https://soroban-rpc.mainnet.stellar.org",
      rpcUrl: "https://soroban-rpc.mainnet.stellar.org",
      network: "mainnet",
    });
  },
};

// Keep DEFAULT_CONFIG for backward compatibility, although users should migrate to presets
export const DEFAULT_CONFIG: ClientConfig = {
  networkUrl: "https://soroban-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  network: "testnet",
  contractId: "",
};
