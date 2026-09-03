/**
 * Context metadata attached to SDK errors for debugging.
 */
export interface ErrorContext {
  /** Transaction hash related to the error */
  transactionId?: string;
  /** Contract ID involved */
  contractId?: string;
  /** Network (testnet/mainnet) */
  network?: string;
  /** Arbitrary additional context */
  [key: string]: unknown;
}

import { ERROR_CODE_REGISTRY } from "./error-codes";

// ── Base Error ──────────────────────────────────────────────────────────────

/**
 * Base error class for the ZK Payroll SDK.
 * All SDK errors extend this class, allowing consumers to catch
 * any SDK error with a single `instanceof ZkPayrollError` check.
 */
export class ZkPayrollError extends Error {
  public readonly cause?: unknown;

  constructor(
    message: string,
    public readonly code: string,
    public readonly context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

// ── Network Errors ──────────────────────────────────────────────────────────

/**
 * Thrown when a network request fails (RPC calls, artifact downloads, etc.).
 */
export class NetworkError extends ZkPayrollError {
  constructor(
    message: string,
    code: string = "NETWORK_ERROR",
    context: ErrorContext = {},
    public readonly statusCode?: number,
    cause?: unknown
  ) {
    super(message, code, context, cause);
  }
}

// ── Proof Generation Errors ─────────────────────────────────────────────────

/**
 * Thrown when ZK proof generation fails (circuit errors, artifact issues, etc.).
 */
export class ProofGenerationError extends ZkPayrollError {
  constructor(
    message: string,
    code: string = "PROOF_GENERATION_FAILED",
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
  }
}

// ── Wallet Errors ────────────────────────────────────────────────────────────

/** Error codes for wallet interaction failures */
export const WalletErrorCode = {
  NOT_INSTALLED: "WALLET_NOT_INSTALLED",
  NOT_CONNECTED: "WALLET_NOT_CONNECTED",
  CONNECTION_REJECTED: "WALLET_CONNECTION_REJECTED",
  SIGNING_REJECTED: "WALLET_SIGNING_REJECTED",
  NETWORK_MISMATCH: "WALLET_NETWORK_MISMATCH",
  INVALID_XDR: "WALLET_INVALID_XDR",
  UNKNOWN_ERROR: "WALLET_UNKNOWN_ERROR",
} as const;

export type WalletErrorCodeType = (typeof WalletErrorCode)[keyof typeof WalletErrorCode];

/**
 * Base class for wallet interaction errors.
 */
export class WalletError extends ZkPayrollError {
  constructor(
    message: string,
    code: string = WalletErrorCode.UNKNOWN_ERROR,
    public walletId?: string,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, code, { ...context, ...(walletId ? { walletId } : {}) }, cause);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when a user explicitly declines or rejects a wallet connection or transaction signature.
 */
export class WalletRejectionError extends WalletError {
  constructor(
    message: string = "User rejected the request in their wallet",
    walletId?: string,
    code: string = WalletErrorCode.SIGNING_REJECTED,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, code, walletId, context, cause);
    this.name = "WalletRejectionError";
  }
}

// ── Contract Execution Errors ───────────────────────────────────────────────

/** Error codes for Soroban RPC / contract failures */
export const ContractErrorCode = {
  SIMULATION_FAILED: "SIMULATION_FAILED",
  TRANSACTION_SUBMISSION_FAILED: "TRANSACTION_SUBMISSION_FAILED",
  TRANSACTION_TIMEOUT: "TRANSACTION_TIMEOUT",
  RPC_TIMEOUT: "RPC_TIMEOUT",
  INSUFFICIENT_FEE: "INSUFFICIENT_FEE",
  CONTRACT_REVERT: "CONTRACT_REVERT",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  UNKNOWN_RPC_ERROR: "UNKNOWN_RPC_ERROR",
} as const;

export type ContractErrorCodeType = (typeof ContractErrorCode)[keyof typeof ContractErrorCode];

export const TimeoutFailureState = {
  RETRYABLE: "RETRYABLE",
  EXPIRED: "EXPIRED",
  UNKNOWN: "UNKNOWN",
  TERMINAL: "TERMINAL",
} as const;

export type TimeoutFailureStateType =
  (typeof TimeoutFailureState)[keyof typeof TimeoutFailureState];

export function classifyContractErrorCode(code: ContractErrorCodeType): TimeoutFailureStateType {
  switch (code) {
    case ContractErrorCode.TRANSACTION_TIMEOUT:
      return TimeoutFailureState.EXPIRED;
    case ContractErrorCode.SIMULATION_FAILED:
    case ContractErrorCode.CONTRACT_REVERT:
      return TimeoutFailureState.TERMINAL;
    case ContractErrorCode.INSUFFICIENT_FEE:
    case ContractErrorCode.TRANSACTION_SUBMISSION_FAILED:
      return TimeoutFailureState.RETRYABLE;
    case ContractErrorCode.RPC_TIMEOUT:
      return TimeoutFailureState.RETRYABLE;
    case ContractErrorCode.INVALID_RESPONSE:
      return TimeoutFailureState.RETRYABLE;
    case ContractErrorCode.UNKNOWN_RPC_ERROR:
    default:
      return TimeoutFailureState.UNKNOWN;
  }
}

export function classifyTimeoutFailure(error: unknown): TimeoutFailureStateType {
  if (error instanceof ContractExecutionError) {
    return error.failureState;
  }

  const msg = error instanceof Error ? error.message : String(error);

  if (
    /econnrefused|econnreset|enetunreach|etimedout|eai_again|network.*error|fetch.*failed|request.*failed|socket/i.test(
      msg
    )
  ) {
    return TimeoutFailureState.RETRYABLE;
  }

  if (/txn.*timeout|tx.*expired|ledger.*seq|too.*old|stale/i.test(msg)) {
    return TimeoutFailureState.EXPIRED;
  }

  if (/revert|trap|wasm|simulation.*fail|unauthorized/i.test(msg)) {
    return TimeoutFailureState.TERMINAL;
  }

  return TimeoutFailureState.UNKNOWN;
}

/**
 * Thrown when a Soroban contract call fails (simulation, submission,
 * timeout, or on-chain revert).
 */
export class ContractExecutionError extends ZkPayrollError {
  public readonly failureState: TimeoutFailureStateType;

  constructor(
    message: string,
    code: ContractErrorCodeType = ContractErrorCode.UNKNOWN_RPC_ERROR,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
    this.failureState = classifyContractErrorCode(code);
  }
}

/**
 * Thrown when an RPC request or polling operation times out before resolving.
 */
export class RpcTimeoutError extends ContractExecutionError {
  constructor(
    message: string = "RPC request timed out",
    context: ErrorContext = {},
    cause?: unknown,
    code: ContractErrorCodeType = ContractErrorCode.RPC_TIMEOUT
  ) {
    super(message, code, context, cause);
    this.name = "RpcTimeoutError";
  }
}

/**
 * Thrown when the RPC node returns malformed, unparseable, or unexpected response data.
 */
export class InvalidResponseError extends ContractExecutionError {
  constructor(
    message: string = "RPC returned malformed or unexpected data",
    context: ErrorContext = {},
    cause?: unknown,
    code: ContractErrorCodeType = ContractErrorCode.INVALID_RESPONSE
  ) {
    super(message, code, context, cause);
    this.name = "InvalidResponseError";
  }
}

// ── Reconciliation Error Codes ───────────────────────────────────────────────

/** Error codes for reconciliation diff failures */
export const ReconciliationErrorCode = {
  DIFF_GENERATION_FAILED: "RECONCILIATION_DIFF_FAILED",
  UNEXPECTED_ACTIVITY: "RECONCILIATION_UNEXPECTED_ACTIVITY",
} as const;

export type ReconciliationErrorCodeType =
  (typeof ReconciliationErrorCode)[keyof typeof ReconciliationErrorCode];

// ── Validation Errors ───────────────────────────────────────────────────────

/**
 * Thrown when input validation fails (invalid addresses, amounts, etc.).
 */
export class ValidationError extends ZkPayrollError {
  constructor(
    message: string,
    public readonly field: string,
    code: string = "VALIDATION_ERROR",
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
  }
}

/**
 * Default user-friendly messages mapped by error code.
 * Keys correspond to the `code` property on SDK error classes.
 */
export const DEFAULT_ERROR_MESSAGES: Record<string, string> = {
  [ContractErrorCode.SIMULATION_FAILED]:
    "The transaction could not be simulated. Please verify your inputs and network connection and try again.",
  [ContractErrorCode.TRANSACTION_SUBMISSION_FAILED]:
    "The transaction was rejected by the network. Please check your connection and try again.",
  [ContractErrorCode.TRANSACTION_TIMEOUT]:
    "The transaction did not confirm within the expected time. The network may be congested; please retry.",
  [ContractErrorCode.RPC_TIMEOUT]:
    "The request to the RPC endpoint timed out. The network may be congested; please retry.",
  [ContractErrorCode.INVALID_RESPONSE]:
    "Received an invalid or malformed response from the RPC node. Please try again.",
  [ContractErrorCode.INSUFFICIENT_FEE]:
    "The transaction fee was too low. Try increasing the fee and submitting again.",
  [ContractErrorCode.CONTRACT_REVERT]:
    "The smart contract rejected the transaction. This may indicate invalid parameters or insufficient permissions.",
  [ContractErrorCode.UNKNOWN_RPC_ERROR]:
    "An unexpected error occurred while communicating with the blockchain network. Please try again.",
  NETWORK_ERROR: "A network error occurred. Please check your internet connection and try again.",
  PROOF_GENERATION_FAILED:
    "Zero-knowledge proof generation failed. This may be due to invalid inputs or insufficient system resources.",
  VALIDATION_ERROR:
    "The provided parameters failed validation. Please review your inputs and try again.",
  [WalletErrorCode.NOT_INSTALLED]:
    "The wallet extension is not installed. Please install it and try again.",
  [WalletErrorCode.NOT_CONNECTED]:
    "The wallet is not connected. Please connect your wallet and try again.",
  [WalletErrorCode.CONNECTION_REJECTED]:
    "The wallet connection request was rejected. Please approve the connection in your wallet and try again.",
  [WalletErrorCode.SIGNING_REJECTED]:
    "The transaction signing request was rejected. Please approve the signature in your wallet and try again.",
  [WalletErrorCode.NETWORK_MISMATCH]:
    "The wallet is on the wrong network. Please switch to the correct network and try again.",
  [WalletErrorCode.INVALID_XDR]:
    "The transaction data is invalid. This may indicate a software bug.",
  [WalletErrorCode.UNKNOWN_ERROR]: "An unexpected wallet error occurred. Please try again.",
  [ReconciliationErrorCode.DIFF_GENERATION_FAILED]:
    "Failed to generate reconciliation report. The input data may be inconsistent.",
  [ReconciliationErrorCode.UNEXPECTED_ACTIVITY]:
    "Unexpected on-chain activity was detected. Review the reconciliation report for details.",
  SERIALIZATION_FAILED: "Failed to serialize or deserialize data. The data may be corrupted.",
  ARTIFACT_NOT_FOUND:
    "A required proving artifact was not found. Please check your artifact URLs and try again.",
  ARTIFACT_ACCESS_DENIED:
    "Access to proving artifacts was denied. Please check your permissions and try again.",
  ARTIFACT_CORRUPT:
    "A proving artifact appears to be corrupt. The SDK will attempt to re-download it.",
  ARTIFACT_FETCH_FAILED:
    "Failed to download a proving artifact. Please check your network connection and try again.",
  ARTIFACT_HASH_MISMATCH:
    "The downloaded proving artifact does not match its expected checksum. The SDK will retry.",
  BATCH_VALIDATION_FAILED:
    "The batch payload contains invalid entries. Please review the validation errors and try again.",
  EMPLOYEE_BATCH_VALIDATION_FAILED:
    "The employee batch contains invalid records. Please review the validation errors and try again.",
  DRAFT_VALIDATION_FAILED:
    "The payroll draft contains invalid data. Please review the errors and try again.",
  PROOF_INPUT_INVALID_RECIPIENT: "Recipient must be a string address.",
  PROOF_INPUT_INVALID_AMOUNT: "Amount must be a non-negative integer.",
  PROOF_INPUT_INVALID_ASSET: "Asset must be a string identifier.",
  PROOF_INPUT_FORBIDDEN_FIELD: "The proof input contains a forbidden sensitive field.",
  PROOF_INPUT_MISSING_REQUIRED_FIELD: "A required field is missing from the payroll proof input.",
  PROOF_INPUT_INVALID: "Proof witness must be a non-null object.",
  AUDIT_ACCESS_REQUEST_VALIDATION_FAILED:
    "The audit access request failed validation. Please review the requester details, scope, expiration, reason, and target payroll period.",
};

/** Custom message overrides keyed by error code. */
export type ErrorMessageOverrides = Record<string, string>;

/**
 * Result of {@link toUserFriendlyError}.
 *
 * Contains both a human-readable message and the original diagnostic context
 * so callers can log the full technical details while displaying the friendly
 * version to end users.
 */
export interface UserFriendlyError {
  /** Human-readable description of the failure. */
  friendlyMessage: string;
  /** Error code from the original error (e.g. `"SIMULATION_FAILED"`). */
  code: string;
  /** Structured metadata from the original error. */
  context: ErrorContext;
  /** The original error object, preserved for lower-level diagnostics. */
  originalError: unknown;
}

function extractCodeAndContext(error: unknown): { code: string; context: ErrorContext } {
  if (typeof error === "object" && error !== null && "code" in error) {
    const err = error as { code: unknown; context?: unknown; walletId?: unknown };
    const context: ErrorContext = {
      ...(typeof err.context === "object" && err.context !== null ? err.context : {}),
      ...(err.walletId ? { walletId: String(err.walletId) } : {}),
    };
    return {
      code: String(err.code ?? ContractErrorCode.UNKNOWN_RPC_ERROR),
      context,
    };
  }

  return { code: ContractErrorCode.UNKNOWN_RPC_ERROR, context: {} };
}

/**
 * Translates a raw chain, contract, or SDK error into a user-friendly message
 * while preserving the original diagnostic context.
 *
 * @param error  - The error to map (typed SDK error, `WalletError`, `Error`, or raw value).
 * @param overrides - Optional map of error codes to custom messages.
 *
 * @returns A {@link UserFriendlyError} with both a human-readable message and
 *          the original technical details.
 */
export function toUserFriendlyError(
  error: unknown,
  overrides?: ErrorMessageOverrides
): UserFriendlyError {
  const { code, context } = extractCodeAndContext(error);
  const messages = { ...DEFAULT_ERROR_MESSAGES, ...overrides };
  const friendlyMessage =
    messages[code] ??
    messages[ContractErrorCode.UNKNOWN_RPC_ERROR] ??
    "An unexpected error occurred. Please try again.";

  return { friendlyMessage, code, context, originalError: error };
}

// ── Redacted Error Formatter ────────────────────────────────────────────────

/** Patterns that match sensitive field values inside error messages. */
const SENSITIVE_PATTERNS: RegExp[] = [
  /recipient\s*[:=]\s*\S+/gi,
  /amount\s*[:=]\s*\S+/gi,
  /witness\s*[:=]\s*\S+/gi,
  /privateKey\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /password\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /mnemonic\s*[:=]\s*\S+/gi,
  /seed\s*[:=]\s*\S+/gi,
  /authorization\s*[:=]\s*\S+/gi,
  /apiKey\s*[:=]\s*\S+/gi,
  /api_key\s*[:=]\s*\S+/gi,
  /accessToken\s*[:=]\s*\S+/gi,
  /access_token\s*[:=]\s*\S+/gi,
  /refreshToken\s*[:=]\s*\S+/gi,
  /refresh_token\s*[:=]\s*\S+/gi,
  /signingKey\s*[:=]\s*\S+/gi,
];

/**
 * A formatted error ready for logging or display in dashboards.
 *
 * Contains a sanitized message safe for external consumption alongside
 * the original error code and context for internal diagnostics.
 */
export interface FormattedError {
  /** Sanitized error message safe for logs and dashboards. */
  message: string;
  /** Error code from the original error. */
  code: string;
  /** Sanitized context metadata (sensitive fields removed). */
  context: Record<string, unknown>;
  /** Human-readable category of the error. */
  category: string;
  /** Whether the error is likely retryable. */
  retryable: boolean;
}

const CATEGORY_MAP: Record<string, string> = {
  SIMULATION_FAILED: "Simulation",
  TRANSACTION_SUBMISSION_FAILED: "Submission",
  TRANSACTION_TIMEOUT: "Timeout",
  RPC_TIMEOUT: "Network",
  INSUFFICIENT_FEE: "Fee",
  CONTRACT_REVERT: "Contract",
  INVALID_RESPONSE: "Network",
  UNKNOWN_RPC_ERROR: "Unknown",
  NETWORK_ERROR: "Network",
  PROOF_GENERATION_FAILED: "Proof Generation",
  VALIDATION_ERROR: "Validation",
  WALLET_NOT_INSTALLED: "Wallet",
  WALLET_NOT_CONNECTED: "Wallet",
  WALLET_CONNECTION_REJECTED: "Wallet",
  WALLET_SIGNING_REJECTED: "Wallet",
  WALLET_NETWORK_MISMATCH: "Wallet",
  WALLET_INVALID_XDR: "Wallet",
  WALLET_UNKNOWN_ERROR: "Wallet",
  SERIALIZATION_FAILED: "Serialization",
  ARTIFACT_NOT_FOUND: "Artifact",
  ARTIFACT_ACCESS_DENIED: "Artifact",
  ARTIFACT_CORRUPT: "Artifact",
  ARTIFACT_FETCH_FAILED: "Artifact",
  ARTIFACT_HASH_MISMATCH: "Artifact",
  BATCH_VALIDATION_FAILED: "Batch",
  EMPLOYEE_BATCH_VALIDATION_FAILED: "Batch",
  DRAFT_VALIDATION_FAILED: "Draft",
  PROOF_INPUT_INVALID_RECIPIENT: "Proof Generation",
  PROOF_INPUT_INVALID_AMOUNT: "Proof Generation",
  PROOF_INPUT_INVALID_ASSET: "Proof Generation",
  PROOF_INPUT_FORBIDDEN_FIELD: "Proof Generation",
  PROOF_INPUT_MISSING_REQUIRED_FIELD: "Proof Generation",
  PROOF_INPUT_INVALID: "Proof Generation",
  RECONCILIATION_DIFF_FAILED: "Reconciliation",
  RECONCILIATION_UNEXPECTED_ACTIVITY: "Reconciliation",
  AUDIT_ACCESS_REQUEST_VALIDATION_FAILED: "Audit",
};

const RETRYABLE_CODES = new Set<string>(
  Object.entries(ERROR_CODE_REGISTRY)
    .filter(([, entry]) => entry.retryable)
    .map(([code]) => code)
);

/**
 * Strips sensitive field values from an error message, replacing them
 * with `[redacted]` to make the message safe for logging and dashboards.
 *
 * @example
 * ```typescript
 * const err = new Error("recipient=GABC123... amount=5000");
 * const formatted = formatRedactedError(err);
 * // formatted.message === "recipient=[redacted] amount=[redacted]"
 * ```
 */
export function formatRedactedError(error: unknown, placeholder = "[redacted]"): FormattedError {
  let message = "An unknown error occurred.";
  let code: string = ContractErrorCode.UNKNOWN_RPC_ERROR;
  let context: Record<string, unknown> = {};

  if (error instanceof ZkPayrollError) {
    message = error.message;
    code = error.code;
    context = { ...error.context };
  } else if (error instanceof Error) {
    message = error.message;
    if ("code" in error) {
      const errObj = error as { code: unknown };
      code = String(errObj.code);
    }
    if ("context" in error && typeof (error as { context: unknown }).context === "object") {
      context = { ...(error as { context: Record<string, unknown> }).context };
    }
  } else if (typeof error === "string") {
    message = error;
  }

  // Sanitize message
  let sanitizedMessage = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    sanitizedMessage = sanitizedMessage.replace(pattern, (match) => {
      const eqIdx = match.search(/[:=]/);
      if (eqIdx === -1) return placeholder;
      return match.slice(0, eqIdx + 1) + placeholder;
    });
  }

  // Sanitize context
  const sensitiveKeys = new Set([
    "recipient",
    "amount",
    "witness",
    "privateKey",
    "adminKey",
    "secret",
    "password",
    "token",
    "mnemonic",
    "seed",
    "authorization",
    "apiKey",
    "api_key",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "signingKey",
  ]);
  const sanitizedContext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (sensitiveKeys.has(key)) {
      sanitizedContext[key] = placeholder;
    } else {
      sanitizedContext[key] = value;
    }
  }

  const category = CATEGORY_MAP[code] ?? "Unknown";
  const retryable = RETRYABLE_CODES.has(code as ContractErrorCodeType);

  return {
    message: sanitizedMessage,
    code,
    context: sanitizedContext,
    category,
    retryable,
  };
}

// ── Error Mapping Utility ───────────────────────────────────────────────────

/**
 * Map a raw Soroban RPC error to a typed ContractExecutionError.
 */
export function mapRpcError(error: unknown, context: ErrorContext = {}): ContractExecutionError {
  if (error instanceof ContractExecutionError) return error;

  const msg = error instanceof Error ? error.message : String(error);
  const cause = error;

  if (/transaction.*timeout|timeout.*transaction/i.test(msg)) {
    return new ContractExecutionError(
      `Transaction timed out: ${msg}`,
      ContractErrorCode.TRANSACTION_TIMEOUT,
      context,
      cause
    );
  }

  if (/timeout|expired|econnaborted|etimedout/i.test(msg)) {
    return new RpcTimeoutError(
      `RPC request timed out: ${msg}`,
      context,
      cause,
      ContractErrorCode.RPC_TIMEOUT
    );
  }

  if (/invalid|malformed|unexpected response|parse error|bad response/i.test(msg)) {
    return new InvalidResponseError(
      `Invalid RPC response: ${msg}`,
      context,
      cause,
      ContractErrorCode.INVALID_RESPONSE
    );
  }

  if (/simulate/i.test(msg)) {
    return new ContractExecutionError(
      `Simulation failed: ${msg}`,
      ContractErrorCode.SIMULATION_FAILED,
      context,
      cause
    );
  }

  if (/fee|insufficient/i.test(msg)) {
    return new ContractExecutionError(
      `Insufficient fee: ${msg}`,
      ContractErrorCode.INSUFFICIENT_FEE,
      context,
      cause
    );
  }

  if (/revert|trap|wasm/i.test(msg)) {
    return new ContractExecutionError(
      `Contract reverted: ${msg}`,
      ContractErrorCode.CONTRACT_REVERT,
      context,
      cause
    );
  }

  if (/submit|send/i.test(msg)) {
    return new ContractExecutionError(
      `Transaction submission failed: ${msg}`,
      ContractErrorCode.TRANSACTION_SUBMISSION_FAILED,
      context,
      cause
    );
  }

  return new ContractExecutionError(
    `Unknown RPC error: ${msg}`,
    ContractErrorCode.UNKNOWN_RPC_ERROR,
    context,
    cause
  );
}
