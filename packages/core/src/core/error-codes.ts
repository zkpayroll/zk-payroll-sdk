/**
 * Error code categories matching the SDK's operational domains.
 */
export const ErrorCategory = {
  VALIDATION: "validation",
  WALLET: "wallet",
  RPC: "rpc",
  PROOF: "proof",
  CONTRACT: "contract",
  RECONCILIATION: "reconciliation",
  NETWORK: "network",
  SERIALIZATION: "serialization",
  ARTIFACT: "artifact",
  BATCH: "batch",
  DRAFT: "draft",
  METADATA: "metadata",
  SIMULATION: "simulation",
  IDEMPOTENCY: "idempotency",
  AUDIT: "audit",
  ELIGIBILITY: "eligibility",
} as const;

export type ErrorCategoryType = (typeof ErrorCategory)[keyof typeof ErrorCategory];

/**
 * Metadata registered for each stable SDK error code.
 */
export interface ErrorCodeEntry {
  category: ErrorCategoryType;
  meaning: string;
  retryable: boolean;
  suggestedMessage: string;
}

/**
 * Central registry of all stable SDK error codes and their metadata.
 * Adding a new code here automatically propagates its category, retryability,
 * and suggested user message.
 */
export const ERROR_CODE_REGISTRY: Record<string, ErrorCodeEntry> = {
  // ── Validation ──────────────────────────────────────────────────────────
  VALIDATION_ERROR: {
    category: ErrorCategory.VALIDATION,
    meaning: "Input validation failed — one or more parameters did not pass client-side checks.",
    retryable: false,
    suggestedMessage:
      "The provided parameters failed validation. Please review your inputs and try again.",
  },
  CONFIG_VALIDATION_ERROR: {
    category: ErrorCategory.VALIDATION,
    meaning:
      "SDK configuration validation failed — one or more config values are missing or invalid.",
    retryable: false,
    suggestedMessage:
      "SDK configuration validation failed. Please check your network, RPC URL, contract IDs, and feature flags.",
  },

  // ── Wallet ──────────────────────────────────────────────────────────────
  WALLET_NOT_INSTALLED: {
    category: ErrorCategory.WALLET,
    meaning: "The wallet extension (e.g. Freighter, Albedo) is not installed in the browser.",
    retryable: false,
    suggestedMessage: "The wallet extension is not installed. Please install it and try again.",
  },
  WALLET_NOT_CONNECTED: {
    category: ErrorCategory.WALLET,
    meaning: "The wallet extension is installed but not connected to the dApp.",
    retryable: true,
    suggestedMessage: "The wallet is not connected. Please connect your wallet and try again.",
  },
  WALLET_CONNECTION_REJECTED: {
    category: ErrorCategory.WALLET,
    meaning: "The user explicitly rejected the wallet connection request.",
    retryable: true,
    suggestedMessage:
      "The wallet connection request was rejected. Please approve the connection in your wallet and try again.",
  },
  WALLET_SIGNING_REJECTED: {
    category: ErrorCategory.WALLET,
    meaning: "The user explicitly rejected the transaction signing request in their wallet.",
    retryable: true,
    suggestedMessage:
      "The transaction signing request was rejected. Please approve the signature in your wallet and try again.",
  },
  WALLET_NETWORK_MISMATCH: {
    category: ErrorCategory.WALLET,
    meaning:
      "The wallet is connected to a different network (mainnet vs testnet) than the SDK expects.",
    retryable: true,
    suggestedMessage:
      "The wallet is on the wrong network. Please switch to the correct network and try again.",
  },
  WALLET_INVALID_XDR: {
    category: ErrorCategory.WALLET,
    meaning: "The transaction envelope (XDR) provided to the wallet is malformed or invalid.",
    retryable: false,
    suggestedMessage: "The transaction data is invalid. This may indicate a software bug.",
  },
  WALLET_UNKNOWN_ERROR: {
    category: ErrorCategory.WALLET,
    meaning: "An unidentified error occurred during wallet interaction.",
    retryable: true,
    suggestedMessage: "An unexpected wallet error occurred. Please try again.",
  },

  // ── RPC / Blockchain Communication ──────────────────────────────────────
  RPC_TIMEOUT: {
    category: ErrorCategory.RPC,
    meaning:
      "An RPC request to the Soroban endpoint did not complete within the expected time window.",
    retryable: true,
    suggestedMessage:
      "The request to the RPC endpoint timed out. The network may be congested; please retry.",
  },
  INVALID_RESPONSE: {
    category: ErrorCategory.RPC,
    meaning: "The RPC node returned a malformed, unparseable, or structurally unexpected response.",
    retryable: true,
    suggestedMessage:
      "Received an invalid or malformed response from the RPC node. Please try again.",
  },

  // ── Proof Generation ────────────────────────────────────────────────────
  PROOF_GENERATION_FAILED: {
    category: ErrorCategory.PROOF,
    meaning:
      "Zero-knowledge proof generation failed due to invalid witness inputs, circuit errors, or artifact problems.",
    retryable: true,
    suggestedMessage:
      "Zero-knowledge proof generation failed. This may be due to invalid inputs or insufficient system resources.",
  },

  // ── Contract Execution ──────────────────────────────────────────────────
  SIMULATION_FAILED: {
    category: ErrorCategory.CONTRACT,
    meaning:
      "The Soroban contract simulation failed before submission — likely invalid inputs or contract bug.",
    retryable: false,
    suggestedMessage:
      "The transaction could not be simulated. Please verify your inputs and network connection and try again.",
  },
  TRANSACTION_SUBMISSION_FAILED: {
    category: ErrorCategory.CONTRACT,
    meaning: "The signed transaction was rejected by the Soroban RPC endpoint during submission.",
    retryable: true,
    suggestedMessage:
      "The transaction was rejected by the network. Please check your connection and try again.",
  },
  TRANSACTION_TIMEOUT: {
    category: ErrorCategory.CONTRACT,
    meaning: "The submitted transaction did not confirm within the expected ledger window.",
    retryable: true,
    suggestedMessage:
      "The transaction did not confirm within the expected time. The network may be congested; please retry.",
  },
  INSUFFICIENT_FEE: {
    category: ErrorCategory.CONTRACT,
    meaning: "The transaction fee was too low for the Soroban network to accept it.",
    retryable: true,
    suggestedMessage:
      "The transaction fee was too low. Try increasing the fee and submitting again.",
  },
  CONTRACT_REVERT: {
    category: ErrorCategory.CONTRACT,
    meaning:
      "The smart contract logic rejected the transaction — often due to insufficient funds or bad arguments.",
    retryable: false,
    suggestedMessage:
      "The smart contract rejected the transaction. This may indicate invalid parameters or insufficient permissions.",
  },
  UNKNOWN_RPC_ERROR: {
    category: ErrorCategory.CONTRACT,
    meaning: "Unclassified contract execution error that does not fit known failure patterns.",
    retryable: true,
    suggestedMessage:
      "An unexpected error occurred while communicating with the blockchain network. Please try again.",
  },

  // ── Network ─────────────────────────────────────────────────────────────
  NETWORK_ERROR: {
    category: ErrorCategory.NETWORK,
    meaning: "An underlying network or HTTP request failure (DNS, connection refused, TLS, etc.).",
    retryable: true,
    suggestedMessage:
      "A network error occurred. Please check your internet connection and try again.",
  },

  // ── Serialization ───────────────────────────────────────────────────────
  SERIALIZATION_FAILED: {
    category: ErrorCategory.SERIALIZATION,
    meaning: "Binary encoding or decoding of a proof, commitment, or payroll draft failed.",
    retryable: false,
    suggestedMessage: "Failed to serialize or deserialize data. The data may be corrupted.",
  },

  // ── Artifact Errors ─────────────────────────────────────────────────────
  ARTIFACT_NOT_FOUND: {
    category: ErrorCategory.ARTIFACT,
    meaning:
      "A required ZK circuit artifact (wasm, zkey) could not be found at the configured path/URL.",
    retryable: true,
    suggestedMessage:
      "A required proving artifact was not found. Please check your artifact URLs and try again.",
  },
  ARTIFACT_ACCESS_DENIED: {
    category: ErrorCategory.ARTIFACT,
    meaning: "Access to the artifact storage (S3, CDN, local file) was denied.",
    retryable: false,
    suggestedMessage:
      "Access to proving artifacts was denied. Please check your permissions and try again.",
  },
  ARTIFACT_CORRUPT: {
    category: ErrorCategory.ARTIFACT,
    meaning: "A downloaded or cached artifact has an invalid checksum or is corrupted.",
    retryable: true,
    suggestedMessage:
      "A proving artifact appears to be corrupt. The SDK will attempt to re-download it.",
  },
  ARTIFACT_FETCH_FAILED: {
    category: ErrorCategory.ARTIFACT,
    meaning: "Fetching an artifact from a remote URL failed due to a network or server error.",
    retryable: true,
    suggestedMessage:
      "Failed to download a proving artifact. Please check your network connection and try again.",
  },
  ARTIFACT_HASH_MISMATCH: {
    category: ErrorCategory.ARTIFACT,
    meaning:
      "The downloaded artifact's hash does not match the expected hash — possible tampering or corruption.",
    retryable: true,
    suggestedMessage:
      "The downloaded proving artifact does not match its expected checksum. The SDK will retry.",
  },

  // ── Batch Validation ────────────────────────────────────────────────────
  BATCH_VALIDATION_FAILED: {
    category: ErrorCategory.BATCH,
    meaning: "Batch payload validation failed — one or more entries are invalid.",
    retryable: false,
    suggestedMessage:
      "The batch payload contains invalid entries. Please review the validation errors and try again.",
  },
  EMPLOYEE_BATCH_VALIDATION_FAILED: {
    category: ErrorCategory.BATCH,
    meaning: "Employee batch validation failed — one or more employee records are invalid.",
    retryable: false,
    suggestedMessage:
      "The employee batch contains invalid records. Please review the validation errors and try again.",
  },

  // ── Draft Validation ────────────────────────────────────────────────────
  DRAFT_VALIDATION_FAILED: {
    category: ErrorCategory.DRAFT,
    meaning: "Draft validation failed — one or more draft fields are invalid or missing.",
    retryable: false,
    suggestedMessage:
      "The payroll draft contains invalid data. Please review the errors and try again.",
  },

  // ── Proof Input Sanitization ────────────────────────────────────────────
  PROOF_INPUT_INVALID_RECIPIENT: {
    category: ErrorCategory.PROOF,
    meaning: "Proof witness recipient field is not a valid string.",
    retryable: false,
    suggestedMessage: "Recipient must be a string address.",
  },
  PROOF_INPUT_INVALID_AMOUNT: {
    category: ErrorCategory.PROOF,
    meaning: "Proof witness amount field cannot be parsed as a non-negative integer.",
    retryable: false,
    suggestedMessage: "Amount must be a non-negative integer.",
  },
  PROOF_INPUT_INVALID_ASSET: {
    category: ErrorCategory.PROOF,
    meaning: "Proof witness asset field is not a valid string.",
    retryable: false,
    suggestedMessage: "Asset must be a string identifier.",
  },
  PROOF_INPUT_FORBIDDEN_FIELD: {
    category: ErrorCategory.PROOF,
    meaning: "Proof witness contains a field that is forbidden (e.g. privateKey, secret).",
    retryable: false,
    suggestedMessage: "The proof input contains a forbidden sensitive field.",
  },
  PROOF_INPUT_MISSING_REQUIRED_FIELD: {
    category: ErrorCategory.PROOF,
    meaning: "A required payroll witness field (recipient, amount, or asset) is missing.",
    retryable: false,
    suggestedMessage: "A required field is missing from the payroll proof input.",
  },
  PROOF_INPUT_INVALID: {
    category: ErrorCategory.PROOF,
    meaning: "The proof witness object is null, undefined, or not a plain object.",
    retryable: false,
    suggestedMessage: "Proof witness must be a non-null object.",
  },

  // ── Reconciliation ──────────────────────────────────────────────────────
  RECONCILIATION_DIFF_FAILED: {
    category: ErrorCategory.RECONCILIATION,
    meaning: "Reconciliation diff generation failed due to invalid or inconsistent input data.",
    retryable: false,
    suggestedMessage:
      "Failed to generate reconciliation report. The input data may be inconsistent.",
  },
  RECONCILIATION_UNEXPECTED_ACTIVITY: {
    category: ErrorCategory.RECONCILIATION,
    meaning:
      "On-chain activity was detected with no corresponding expected outcome in the payroll run.",
    retryable: false,
    suggestedMessage:
      "Unexpected on-chain activity was detected. Review the reconciliation report for details.",
  },

  // ── Audit ────────────────────────────────────────────────────────────────
  AUDIT_ACCESS_REQUEST_VALIDATION_FAILED: {
    category: ErrorCategory.AUDIT,
    meaning:
      "Audit access request validation failed — the request is missing required fields, has invalid dates, or violates business rules.",
    retryable: false,
    suggestedMessage:
      "The audit access request failed validation. Please review the requester details, scope, expiration, reason, and target payroll period.",
  },

  // ── Employee Eligibility ─────────────────────────────────────────────────
  INELIGIBLE_EMPLOYEE_RECORD: {
    category: ErrorCategory.ELIGIBILITY,
    meaning:
      "An employee record failed eligibility evaluation (identity, status, salary, asset, or compliance checks).",
    retryable: false,
    suggestedMessage:
      "One or more employees are ineligible for payroll resolution. Review the eligibility reasons and fix the affected records.",
  },
  BATCH_ELIGIBILITY_FAILED: {
    category: ErrorCategory.ELIGIBILITY,
    meaning: "A payroll batch contains one or more ineligible employee records.",
    retryable: false,
    suggestedMessage:
      "The payroll batch contains ineligible employee records. Review the batch eligibility report and correct the affected records.",
  },
};

/**
 * Returns the error category for a given error code.
 * Falls back to "unknown" for unrecognized codes.
 */
export function getErrorCategory(code: string): string {
  return ERROR_CODE_REGISTRY[code]?.category ?? "unknown";
}

/**
 * Returns whether an error with the given code is considered retryable.
 * Falls back to `false` for unrecognized codes.
 */
export function isRetryableErrorCode(code: string): boolean {
  return ERROR_CODE_REGISTRY[code]?.retryable ?? false;
}

/**
 * Returns the suggested user-facing message for a given error code.
 * Returns `undefined` for unrecognized codes.
 */
export function getSuggestedMessage(code: string): string | undefined {
  return ERROR_CODE_REGISTRY[code]?.suggestedMessage;
}

/**
 * Returns all error codes belonging to a given category.
 */
export function getErrorCodesByCategory(category: ErrorCategoryType): string[] {
  return Object.entries(ERROR_CODE_REGISTRY)
    .filter(([, entry]) => entry.category === category)
    .map(([code]) => code);
}
