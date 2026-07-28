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
