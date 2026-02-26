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

// Error codes for PayrollService validation/orchestration failures
export const PayrollServiceErrorCode = {
  PROOF_GENERATION_FAILED: 2001,
  INVALID_RECIPIENT: 2002,
  INVALID_AMOUNT: 2003,
  INVALID_ASSET: 2004,
} as const;

export type PayrollServiceErrorCode =
  (typeof PayrollServiceErrorCode)[keyof typeof PayrollServiceErrorCode];

/**
 * Re-exports from core error module.
 * Import from "./core/errors" for the full error hierarchy.
 * This file maintains backward compatibility for existing consumers.
 */
export {
  ZkPayrollError,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  ValidationError,
  ContractErrorCode,
  mapRpcError,
} from "./core/errors";
export type { ErrorContext, ContractErrorCodeType } from "./core/errors";

// ── Backward-compatible alias ───────────────────────────────────────────────
import { ZkPayrollError } from "./core/errors";

/**
 * @deprecated Use `ZkPayrollError` instead. Kept for backward compatibility.
 */
export class PayrollError extends ZkPayrollError {
  constructor(message: string, code: number) {
    super(message, String(code));
    this.name = "PayrollError";
  }
}

/**
 * @deprecated Use structured error logging instead.
 */
export function handleApiError(error: unknown): void {
  // eslint-disable-next-line no-console
  console.error("API Error:", error);
}
