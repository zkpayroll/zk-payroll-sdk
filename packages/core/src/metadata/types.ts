export interface ContractMetadata {
  networkUrl: string;
  networkPassphrase: string;
  payrollRegistryId?: string;
  salaryCommitmentId?: string;
  proofVerifierId?: string;
  paymentExecutorId?: string;
  adminPublicKey?: string;
}

export interface KnownEnvironment {
  name: string;
  label: string;
  metadata: ContractMetadata;
}

export interface MetadataValidationResult {
  valid: boolean;
  errors: MetadataValidationError[];
}

export interface MetadataValidationError {
  field: string;
  message: string;
  code: string;
}

export const MetadataErrorCode = {
  UNKNOWN_ENVIRONMENT: "UNKNOWN_ENVIRONMENT",
  INVALID_NETWORK_URL: "INVALID_NETWORK_URL",
  INVALID_NETWORK_PASSPHRASE: "INVALID_NETWORK_PASSPHRASE",
  INVALID_CONTRACT_ID: "INVALID_CONTRACT_ID",
  INVALID_ADMIN_KEY: "INVALID_ADMIN_KEY",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
} as const;

export type MetadataErrorCodeType = (typeof MetadataErrorCode)[keyof typeof MetadataErrorCode];
