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

// Error codes for PayrollService validation/orchestration failures
export const PayrollServiceErrorCode = {
  PROOF_GENERATION_FAILED: 2001,
  INVALID_RECIPIENT: 2002,
  INVALID_AMOUNT: 2003,
  INVALID_ASSET: 2004,
} as const;

export type PayrollServiceErrorCode =
  (typeof PayrollServiceErrorCode)[keyof typeof PayrollServiceErrorCode];

import { ZkPayrollError } from "./core/errors";

/**
 * @deprecated Prefer `ZkPayrollError` with string codes. Kept for call sites using numeric codes.
 */
export class PayrollError extends ZkPayrollError {
  constructor(message: string, code: number | string) {
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
