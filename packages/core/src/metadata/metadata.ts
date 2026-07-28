import {
  ContractMetadata,
  MetadataValidationError,
  MetadataValidationResult,
  MetadataErrorCode,
} from "./types";
import { ENVIRONMENT_MAP } from "./environments";

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const STELLAR_SECRET_RE = /^S[A-Z2-7]{55}$/;
const URL_RE = /^https?:\/\/.+/;

const REQUIRED_FIELDS: (keyof ContractMetadata)[] = ["networkUrl", "networkPassphrase"];

export function getContractMetadata(
  environment: string,
  overrides?: Partial<ContractMetadata>
): ContractMetadata {
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

export function validateContractMetadata(metadata: ContractMetadata): MetadataValidationResult {
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

  if (metadata.networkPassphrase) {
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

  const contractFields: (keyof ContractMetadata)[] = [
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

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildClientConfig(metadata: ContractMetadata): {
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
