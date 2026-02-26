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
  constructor(
    message: string,
    public readonly code: string,
    public readonly context: ErrorContext = {}
  ) {
    super(message);
    this.name = this.constructor.name;
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
    public readonly statusCode?: number
  ) {
    super(message, code, context);
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
    context: ErrorContext = {}
  ) {
    super(message, code, context);
  }
}

// ── Contract Execution Errors ───────────────────────────────────────────────

/** Error codes for Soroban RPC / contract failures */
export const ContractErrorCode = {
  SIMULATION_FAILED: "SIMULATION_FAILED",
  TRANSACTION_SUBMISSION_FAILED: "TRANSACTION_SUBMISSION_FAILED",
  TRANSACTION_TIMEOUT: "TRANSACTION_TIMEOUT",
  INSUFFICIENT_FEE: "INSUFFICIENT_FEE",
  CONTRACT_REVERT: "CONTRACT_REVERT",
  UNKNOWN_RPC_ERROR: "UNKNOWN_RPC_ERROR",
} as const;

export type ContractErrorCodeType =
  (typeof ContractErrorCode)[keyof typeof ContractErrorCode];

/**
 * Thrown when a Soroban contract call fails (simulation, submission,
 * timeout, or on-chain revert).
 */
export class ContractExecutionError extends ZkPayrollError {
  constructor(
    message: string,
    code: ContractErrorCodeType = ContractErrorCode.UNKNOWN_RPC_ERROR,
    context: ErrorContext = {}
  ) {
    super(message, code, context);
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
    context: ErrorContext = {}
  ) {
    super(message, code, context);
  }
}

// ── Error Mapping Utility ───────────────────────────────────────────────────

/**
 * Map a raw Soroban RPC error to a typed ContractExecutionError.
 */
export function mapRpcError(
  error: unknown,
  context: ErrorContext = {}
): ContractExecutionError {
  if (error instanceof ContractExecutionError) return error;

  const msg = error instanceof Error ? error.message : String(error);

  if (/simulate/i.test(msg)) {
    return new ContractExecutionError(
      `Simulation failed: ${msg}`,
      ContractErrorCode.SIMULATION_FAILED,
      context
    );
  }

  if (/fee|insufficient/i.test(msg)) {
    return new ContractExecutionError(
      `Insufficient fee: ${msg}`,
      ContractErrorCode.INSUFFICIENT_FEE,
      context
    );
  }

  if (/timeout|expired/i.test(msg)) {
    return new ContractExecutionError(
      `Transaction timed out: ${msg}`,
      ContractErrorCode.TRANSACTION_TIMEOUT,
      context
    );
  }

  if (/revert|trap|wasm/i.test(msg)) {
    return new ContractExecutionError(
      `Contract reverted: ${msg}`,
      ContractErrorCode.CONTRACT_REVERT,
      context
    );
  }

  if (/submit|send/i.test(msg)) {
    return new ContractExecutionError(
      `Transaction submission failed: ${msg}`,
      ContractErrorCode.TRANSACTION_SUBMISSION_FAILED,
      context
    );
  }

  return new ContractExecutionError(
    `Unknown RPC error: ${msg}`,
    ContractErrorCode.UNKNOWN_RPC_ERROR,
    context
  );
}
