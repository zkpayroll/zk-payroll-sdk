import { ContractErrorCode, mapRpcError, WalletErrorCode } from "../errors";
import { getSuggestedMessage, isRetryableErrorCode } from "../core/error-codes";

/** Action an application can take after a payroll operation fails. */
export type PayrollErrorRecoveryCategory = "retryable" | "user-correctable" | "terminal";

/** Privacy-safe recovery guidance for a payroll error. */
export interface RecoverablePayrollErrorClassification {
  /** The next action an application should offer to the caller. */
  category: PayrollErrorRecoveryCategory;
  /** Stable SDK error code used for machine-readable handling. */
  code: string;
  /** Whether retrying the operation without changing inputs may succeed. */
  retryable: boolean;
  /** Whether the caller can normally resolve the failure by changing local state or input. */
  userCorrectable: boolean;
  /** Generic guidance from the SDK registry. It never includes raw error values. */
  suggestedMessage: string;
}

const USER_CORRECTABLE_CODES = new Set<string>([
  "VALIDATION_ERROR",
  "CONFIG_VALIDATION_ERROR",
  WalletErrorCode.NOT_INSTALLED,
  WalletErrorCode.NOT_CONNECTED,
  WalletErrorCode.CONNECTION_REJECTED,
  WalletErrorCode.SIGNING_REJECTED,
  WalletErrorCode.NETWORK_MISMATCH,
  WalletErrorCode.INVALID_XDR,
  ContractErrorCode.SIMULATION_FAILED,
  ContractErrorCode.INSUFFICIENT_FEE,
  ContractErrorCode.CONTRACT_REVERT,
  "BATCH_VALIDATION_FAILED",
  "EMPLOYEE_BATCH_VALIDATION_FAILED",
  "DRAFT_VALIDATION_FAILED",
  "PROOF_INPUT_INVALID_RECIPIENT",
  "PROOF_INPUT_INVALID_AMOUNT",
  "PROOF_INPUT_INVALID_ASSET",
  "PROOF_INPUT_FORBIDDEN_FIELD",
  "PROOF_INPUT_MISSING_REQUIRED_FIELD",
  "PROOF_INPUT_INVALID",
  "COMPLIANCE_HOLD_VALIDATION_FAILED",
  "COMPLIANCE_HOLD_RELEASE_UNAUTHORIZED",
]);

/**
 * Classifies a thrown payroll error without exposing its message or context.
 *
 * Use the result to choose between an automatic retry, an input or wallet
 * correction flow, and a terminal error state. Unknown errors are terminal
 * until the application can establish a safe recovery strategy.
 */
export function classifyRecoverablePayrollError(
  error: unknown
): RecoverablePayrollErrorClassification {
  const code = extractErrorCode(error);
  const userCorrectable = USER_CORRECTABLE_CODES.has(code);
  const retryable = !userCorrectable && isRetryableErrorCode(code);
  const category: PayrollErrorRecoveryCategory = userCorrectable
    ? "user-correctable"
    : retryable
      ? "retryable"
      : "terminal";

  return {
    category,
    code,
    retryable,
    userCorrectable,
    suggestedMessage:
      getSuggestedMessage(code) ??
      "The payroll operation could not be completed. Review the error and contact support if it persists.",
  };
}

function extractErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim() !== "") {
      return code;
    }
  }

  if (error instanceof Error) {
    return mapRpcError(error).code;
  }

  return "UNKNOWN_RPC_ERROR";
}
