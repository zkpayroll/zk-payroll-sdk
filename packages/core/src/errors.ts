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

import { ZkPayrollError } from "./core/errors";

/**
 * Legacy-compatible error for PayrollService orchestration failures.
 * Extends ZkPayrollError so `instanceof ZkPayrollError` checks pass.
 * The numeric constructor argument is stored as a string code.
 */
export class PayrollError extends ZkPayrollError {
  constructor(message: string, numericCode: number) {
    super(message, String(numericCode));
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
