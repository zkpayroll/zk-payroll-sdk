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
  UserFriendlyError,
  FormattedError,
  ErrorMessageOverrides,
  TimeoutFailureStateType,
} from "./core/errors";

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
    code: unknown = "SERIALIZATION_FAILED",
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, String(code), context, cause);
    this.name = "SerializationError";
  }
}

/** Error codes for PayrollService validation/orchestration failures */
export const PayrollServiceErrorCode = {
  PROOF_GENERATION_FAILED: 2001,
  INVALID_RECIPIENT: 2002,
  INVALID_AMOUNT: 2003,
  INVALID_ASSET: 2004,
} as const;

export type PayrollServiceErrorCode =
  (typeof PayrollServiceErrorCode)[keyof typeof PayrollServiceErrorCode];

/** @deprecated Use structured error logging instead. */
export function handleApiError(error: unknown): void {
  console.error("API Error:", error);
}
