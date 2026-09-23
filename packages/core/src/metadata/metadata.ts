import {
  NetworkProfile,
  MetadataValidationError,
  MetadataValidationResult,
  MetadataErrorCode,
} from "./types";
import { ENVIRONMENT_MAP } from "./environments";

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const STELLAR_SECRET_RE = /^S[A-Z2-7]{55}$/;
const URL_RE = /^https?:\/\/.+/;

const REQUIRED_FIELDS: (keyof NetworkProfile)[] = ["networkUrl", "networkPassphrase"];

export function getContractMetadata(
  environment: string,
  overrides?: Partial<NetworkProfile>
): NetworkProfile {
  const env = ENVIRONMENT_MAP[environment];
  if (!env) {
    throw new Error(
      `Unknown environment "${environment}". Known environments: ${Object.keys(ENVIRONMENT_MAP).join(", ")}`
    );
  }

  return {
    ...env.metadata,
    ...overrides,
  };
}

export function isKnownEnvironment(environment: string): boolean {
  return environment in ENVIRONMENT_MAP;
}

export function listKnownEnvironments(): { name: string; label: string }[] {
  return Object.values(ENVIRONMENT_MAP).map(({ name, label }) => ({
    name,
    label,
  }));
}

export interface ValidateContractMetadataOptions {
  /**
   * When true (the default), `networkPassphrase` must match one of the
   * known environments' passphrases. Set to false when validating a
   * genuinely custom network profile — a private/custom Stellar network
   * legitimately has its own passphrase that will never appear in
   * `KNOWN_ENVIRONMENTS`, so enforcing the whitelist there would reject
   * every valid custom profile.
   */
  requireKnownPassphrase?: boolean;
}

export function validateContractMetadata(
  metadata: NetworkProfile,
  options: ValidateContractMetadataOptions = {}
): MetadataValidationResult {
  const { requireKnownPassphrase = true } = options;
  const errors: MetadataValidationError[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = metadata[field];
    if (!value || (typeof value === "string" && value.trim().length === 0)) {
      errors.push({
        field,
        message: `${field} is required`,
        code: MetadataErrorCode.MISSING_REQUIRED_FIELD,
      });
    }
  }

  if (metadata.networkUrl && !URL_RE.test(metadata.networkUrl)) {
    errors.push({
      field: "networkUrl",
      message: `Invalid network URL: "${metadata.networkUrl}"`,
      code: MetadataErrorCode.INVALID_NETWORK_URL,
    });
  }

  if (metadata.networkPassphrase && requireKnownPassphrase) {
    const knownPassphrases = Object.values(ENVIRONMENT_MAP).map(
      (e) => e.metadata.networkPassphrase
    );
    if (!knownPassphrases.includes(metadata.networkPassphrase)) {
      errors.push({
        field: "networkPassphrase",
        message: `Unrecognized network passphrase: "${metadata.networkPassphrase}"`,
        code: MetadataErrorCode.INVALID_NETWORK_PASSPHRASE,
      });
    }
  }

  const contractFields: (keyof NetworkProfile)[] = [
    "payrollRegistryId",
    "salaryCommitmentId",
    "proofVerifierId",
    "paymentExecutorId",
  ];

  for (const field of contractFields) {
    const value = metadata[field];
    if (value !== undefined && value !== "" && !CONTRACT_ID_RE.test(value)) {
      errors.push({
        field,
        message: `Invalid contract ID for "${field}": "${value}"`,
        code: MetadataErrorCode.INVALID_CONTRACT_ID,
      });
    }
  }

  if (metadata.adminPublicKey && !STELLAR_SECRET_RE.test(metadata.adminPublicKey)) {
    errors.push({
      field: "adminPublicKey",
      message: "Invalid Stellar secret key format",
      code: MetadataErrorCode.INVALID_ADMIN_KEY,
    });
  }

  if (metadata.explorerUrl && !URL_RE.test(metadata.explorerUrl)) {
    errors.push({
      field: "explorerUrl",
      message: `Invalid explorer URL: "${metadata.explorerUrl}"`,
      code: MetadataErrorCode.INVALID_EXPLORER_URL,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export type NetworkProfileInput = string | NetworkProfile;

/**
 * Resolves a network environment profile for SDK consumers (e.g. dashboard
 * environment switchers).
 *
 * - Pass a known environment name ("testnet" | "futurenet" | "mainnet" |
 *   "standalone" | "localnet") to get its well-known profile back.
 * - Pass a full `NetworkProfile` object to resolve a custom profile. It is
 *   validated (required fields present, well-formed URLs/IDs) without
 *   requiring the passphrase to match a known network, since a custom
 *   profile's whole point is to describe a network the SDK doesn't already
 *   know about. On validation failure, throws an `Error` whose message
 *   explains every missing or invalid field.
 *
 * @throws {Error} if a string input doesn't match a known environment, or a
 *   custom profile object fails validation.
 */
export function resolveNetworkProfile(input: NetworkProfileInput): NetworkProfile {
  if (typeof input === "string") {
    return getContractMetadata(input);
  }

  const result = validateContractMetadata(input, { requireKnownPassphrase: false });
  if (!result.valid) {
    const details = result.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    throw new Error(`Invalid custom network profile — ${details}`);
  }

  return input;
}

export function buildClientConfig(metadata: NetworkProfile): {
  networkUrl: string;
  contractIds: Record<string, string>;
} {
  const contractIds: Record<string, string> = {};

  if (metadata.payrollRegistryId) {
    contractIds.payrollRegistryId = metadata.payrollRegistryId;
  }
  if (metadata.salaryCommitmentId) {
    contractIds.salaryCommitmentId = metadata.salaryCommitmentId;
  }
  if (metadata.proofVerifierId) {
    contractIds.proofVerifierId = metadata.proofVerifierId;
  }
  if (metadata.paymentExecutorId) {
    contractIds.paymentExecutorId = metadata.paymentExecutorId;
  }

  return {
    networkUrl: metadata.networkUrl,
    contractIds,
  };
}
