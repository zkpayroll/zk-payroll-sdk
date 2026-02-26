export class PayrollError extends Error {
  constructor(
    message: string,
    public code: number
  ) {
    super(message);
    this.name = "PayrollError";
  }
}

// Error codes for Soroban RPC failures
export const ContractErrorCode = {
  SIMULATION_FAILED: 1001,
  TRANSACTION_SUBMISSION_FAILED: 1002,
  TRANSACTION_TIMEOUT: 1003,
  INSUFFICIENT_FEE: 1004,
  CONTRACT_REVERT: 1005,
  UNKNOWN_RPC_ERROR: 1099,
} as const;

export type ContractErrorCode = (typeof ContractErrorCode)[keyof typeof ContractErrorCode];

/**
 * Wraps Soroban RPC errors with a structured code so callers can
 * branch on error type without string-matching raw RPC messages.
 */
export class ContractExecutionError extends PayrollError {
  constructor(
    message: string,
    code: ContractErrorCode,
    public readonly cause?: unknown
  ) {
    super(message, code);
    this.name = "ContractExecutionError";
  }
}

/**
 * Map a raw Soroban RPC error to a typed ContractExecutionError.
 * Inspect the error message/shape coming back from the RPC layer and
 * assign the closest ContractErrorCode.
 */
export function mapRpcError(error: unknown): ContractExecutionError {
  if (error instanceof ContractExecutionError) return error;

  const msg = error instanceof Error ? error.message : String(error);

  if (/simulate/i.test(msg)) {
    return new ContractExecutionError(
      `Simulation failed: ${msg}`,
      ContractErrorCode.SIMULATION_FAILED,
      error
    );
  }

  if (/fee|insufficient/i.test(msg)) {
    return new ContractExecutionError(
      `Insufficient fee: ${msg}`,
      ContractErrorCode.INSUFFICIENT_FEE,
      error
    );
  }

  if (/timeout|expired/i.test(msg)) {
    return new ContractExecutionError(
      `Transaction timed out: ${msg}`,
      ContractErrorCode.TRANSACTION_TIMEOUT,
      error
    );
  }

  if (/revert|trap|wasm/i.test(msg)) {
    return new ContractExecutionError(
      `Contract reverted: ${msg}`,
      ContractErrorCode.CONTRACT_REVERT,
      error
    );
  }

  if (/submit|send/i.test(msg)) {
    return new ContractExecutionError(
      `Transaction submission failed: ${msg}`,
      ContractErrorCode.TRANSACTION_SUBMISSION_FAILED,
      error
    );
  }

  return new ContractExecutionError(
    `Unknown RPC error: ${msg}`,
    ContractErrorCode.UNKNOWN_RPC_ERROR,
    error
  );
}

export function handleApiError(error: unknown): void {
  // eslint-disable-next-line no-console
  console.error("API Error:", error);
}
