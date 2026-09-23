export interface NetworkProfile {
  networkUrl: string;
  networkPassphrase: string;
  payrollRegistryId?: string;
  salaryCommitmentId?: string;
  proofVerifierId?: string;
  paymentExecutorId?: string;
  adminPublicKey?: string;
  /**
   * Optional block-explorer URL for the network (e.g. Stellar Expert).
   * Not applicable to purely local networks (standalone/localnet), which
   * have no public explorer.
   */
  explorerUrl?: string;
}

export interface KnownEnvironment {
  name: string;
  label: string;
  metadata: NetworkProfile;
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
  INVALID_EXPLORER_URL: "INVALID_EXPLORER_URL",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_CUSTOM_PROFILE: "INVALID_CUSTOM_PROFILE",
} as const;

export type MetadataErrorCodeType = (typeof MetadataErrorCode)[keyof typeof MetadataErrorCode];
