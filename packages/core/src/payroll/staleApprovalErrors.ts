import { ZkPayrollError } from "../core/errors";

/**
 * Stable error codes for stale payroll approval conditions.
 *
 * These codes are the single source of truth for error discrimination across
 * SDK consumers, dashboards, and contract integration layers. Codes are never
 * interpolated with employee IDs, salary amounts, or other sensitive values.
 */
export const StaleApprovalErrorCode = {
  /** The approval timestamp has passed its validity window. */
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  /** The referenced approval record could not be found. */
  APPROVAL_NOT_FOUND: "APPROVAL_NOT_FOUND",
  /** The approval is still within its window — not stale. */
  APPROVAL_NOT_STALE: "APPROVAL_NOT_STALE",
  /** The approval has already been executed; no action is possible. */
  APPROVAL_ALREADY_EXECUTED: "APPROVAL_ALREADY_EXECUTED",
  /** The approval was superseded by a later approval for the same run. */
  APPROVAL_SUPERSEDED: "APPROVAL_SUPERSEDED",
  /** The approval record is missing required timestamp metadata. */
  APPROVAL_MISSING_TIMESTAMP: "APPROVAL_MISSING_TIMESTAMP",
} as const;

export type StaleApprovalErrorCode =
  (typeof StaleApprovalErrorCode)[keyof typeof StaleApprovalErrorCode];

/**
 * Thrown when a stale payroll approval condition is detected in the SDK layer.
 *
 * Extends {@link ZkPayrollError} so callers can catch it with a single
 * `instanceof ZkPayrollError` check, or discriminate it more precisely with
 * `instanceof StaleApprovalError` or `isStaleApprovalError()`.
 *
 * Privacy: the constructor never accepts employee names, salary amounts,
 * or raw approval identifiers as interpolatable message parts.
 */
export class StaleApprovalError extends ZkPayrollError {
  constructor(
    message: string,
    code: StaleApprovalErrorCode = StaleApprovalErrorCode.APPROVAL_EXPIRED,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
    this.name = "StaleApprovalError";
  }
}

/**
 * User-facing messages keyed by error code.
 * None of these strings reference payroll-sensitive values.
 */
export const STALE_APPROVAL_ERROR_MESSAGES: Record<StaleApprovalErrorCode, string> = {
  [StaleApprovalErrorCode.APPROVAL_EXPIRED]:
    "The payroll approval has expired. Re-submit the approval to proceed.",
  [StaleApprovalErrorCode.APPROVAL_NOT_FOUND]:
    "The payroll approval record could not be found. Verify the approval ID and try again.",
  [StaleApprovalErrorCode.APPROVAL_NOT_STALE]:
    "The payroll approval is still within its validity window and does not need renewal.",
  [StaleApprovalErrorCode.APPROVAL_ALREADY_EXECUTED]:
    "The payroll approval has already been executed. No further action is available.",
  [StaleApprovalErrorCode.APPROVAL_SUPERSEDED]:
    "The payroll approval was superseded by a later approval for the same run.",
  [StaleApprovalErrorCode.APPROVAL_MISSING_TIMESTAMP]:
    "The payroll approval is missing a required expiration timestamp. Fetch the latest approval record.",
};

/**
 * Returns true when the error is a stale-approval condition, by instance check
 * or error code.
 */
export function isStaleApprovalError(error: unknown): boolean {
  if (error instanceof StaleApprovalError) return true;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as string;
    return Object.values(StaleApprovalErrorCode).includes(code as StaleApprovalErrorCode);
  }
  return false;
}

/**
 * Returns a user-facing message for a stale-approval error.
 * Falls back to a safe generic message for unrecognised error shapes.
 * Never includes payroll-sensitive values.
 */
export function getStaleApprovalErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as StaleApprovalErrorCode;
    if (code in STALE_APPROVAL_ERROR_MESSAGES) {
      return STALE_APPROVAL_ERROR_MESSAGES[code];
    }
  }
  return "A payroll approval error occurred. Check the approval status and try again.";
}

/**
 * Maps an unknown error to a typed {@link StaleApprovalError}, preserving the
 * original as `cause`. Useful for normalizing RPC or storage errors before
 * surfacing them through SDK consumers.
 */
export function mapToStaleApprovalError(
  error: unknown,
  code: StaleApprovalErrorCode = StaleApprovalErrorCode.APPROVAL_EXPIRED,
  context: Record<string, unknown> = {}
): StaleApprovalError {
  if (error instanceof StaleApprovalError) return error;
  const message = getStaleApprovalErrorMessage({ code });
  return new StaleApprovalError(message, code, context, error);
}
