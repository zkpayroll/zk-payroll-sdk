export {
  ZkPayrollError,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  RpcTimeoutError,
  InvalidResponseError,
  ValidationError,
  ContractErrorCode,
  WalletError,
  WalletRejectionError,
  WalletErrorCode,
  ReconciliationErrorCode,
  toUserFriendlyError,
  formatRedactedError,
  DEFAULT_ERROR_MESSAGES,
  mapRpcError,
  TimeoutFailureState,
  classifyContractErrorCode,
  classifyTimeoutFailure,
} from "./core/errors";
export type {
  ErrorContext,
  ContractErrorCodeType,
  WalletErrorCodeType,
  ReconciliationErrorCodeType,
  UserFriendlyError,
  FormattedError,
  ErrorMessageOverrides,
  TimeoutFailureStateType,
} from "./core/errors";

export {
  ErrorCategory,
  ERROR_CODE_REGISTRY,
  getErrorCategory,
  isRetryableErrorCode,
  getSuggestedMessage,
  getErrorCodesByCategory,
} from "./core/error-codes";
export type { ErrorCategoryType, ErrorCodeEntry } from "./core/error-codes";

export { IneligibleEmployeeError, BatchEligibilityError } from "./eligibility/errors";

export {
  ProofReferenceParsingError,
  ProofVerificationError,
  ProofVerificationErrorCode,
} from "./proofs/errors";
export type { ProofVerificationErrorCodeType } from "./proofs/errors";

// ── Backward-compatible aliases ─────────────────────────────────────────────
import { ZkPayrollError } from "./core/errors";

/**
 * @deprecated Use `ZkPayrollError` instead.
 */
export class PayrollError extends ZkPayrollError {
  constructor(
    message: string,
    code: unknown,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    let sanitizedCode = code;
    if (typeof code === "number" && code >= 1000) {
      sanitizedCode = String(code);
    }
    super(message, String(sanitizedCode), context, cause);
    this.name = "PayrollError";
    (this as unknown as { code: unknown }).code = sanitizedCode;
  }
}

export class SerializationError extends ZkPayrollError {
  constructor(
    message: string,
    code: string = "SERIALIZATION_FAILED",
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
    this.name = "SerializationError";
  }
}

/** Error codes for PayrollService validation/orchestration failures */
export const PayrollServiceErrorCode = {
  PROOF_GENERATION_FAILED: "2001",
  INVALID_RECIPIENT: "2002",
  INVALID_AMOUNT: "2003",
  INVALID_ASSET: "2004",
} as const;

export type PayrollServiceErrorCode =
  (typeof PayrollServiceErrorCode)[keyof typeof PayrollServiceErrorCode];

/** @deprecated Use structured error logging instead. */
export function handleApiError(error: unknown): void {
  console.error("API Error:", error);
}
