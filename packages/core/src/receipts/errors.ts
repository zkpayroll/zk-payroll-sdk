import { ZkPayrollError, ErrorContext } from "../errors";
import type { ReceiptVerificationResult, ReceiptVerificationCode } from "./types";

/**
 * Thrown when payroll receipt verification fails.
 *
 * Encapsulates the complete `ReceiptVerificationResult` and ensures that
 * all error messages and attached contexts remain sanitized and free of
 * sensitive payroll values (salaries, recipient addresses, secret keys, etc.).
 */
export class PayrollReceiptVerificationError extends ZkPayrollError {
  public readonly result: ReceiptVerificationResult;

  constructor(
    result: ReceiptVerificationResult,
    code: ReceiptVerificationCode | string = "RECEIPT_VERIFICATION_FAILED",
    context: ErrorContext = {},
    cause?: unknown
  ) {
    const errorList =
      result.errors.length > 0 ? result.errors.join("; ") : "Receipt verification failed";
    const message = `Payroll receipt verification failed for receipt '${result.receiptId}' (payroll: '${result.payrollId}'): ${errorList}`;

    const safeContext: ErrorContext = {
      ...context,
      receiptId: result.receiptId,
      payrollId: result.payrollId,
      settlementStatus: result.settlementStatus,
      issueCount: result.issues.length,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
    };

    super(message, String(code), safeContext, cause);
    this.name = "PayrollReceiptVerificationError";
    this.result = result;
  }
}

/**
 * Stable error code emitted by {@link ReceiptReplayError}.
 */
export const RECEIPT_REPLAY_ERROR_CODE = "RECEIPT_REPLAY" as const;

/**
 * Thrown when a payroll receipt is detected as replayed.
 *
 * A replay occurs when a receipt that has already been observed (e.g. already
 * settled or previously processed) is presented again. This error intentionally
 * carries only the receipt identifier and a redacted, human-readable reason.
 * It must never include salary amounts, employee identifiers, recipient
 * addresses, proofs, or any other sensitive payroll payloads.
 */
export class ReceiptReplayError extends ZkPayrollError {
  /** Identifier of the replayed receipt. */
  public readonly receiptId: string;
  /** Redacted, non-sensitive explanation of why the receipt was flagged. */
  public readonly reason: string;

  constructor(receiptId: string, reason = "Receipt has already been processed", context: ErrorContext = {}, cause?: unknown) {
    const safeReceiptId = typeof receiptId === "string" ? receiptId : "";
    const safeReason = typeof reason === "string" && reason.length > 0 ? reason : "Receipt has already been processed";
    const message = `Receipt replay detected for receipt '${safeReceiptId}': ${safeReason}`;

    const safeContext: ErrorContext = {
      ...context,
      receiptId: safeReceiptId,
      reason: safeReason,
    };

    super(message, RECEIPT_REPLAY_ERROR_CODE, safeContext, cause);
    this.name = "ReceiptReplayError";
    this.receiptId = safeReceiptId;
    this.reason = safeReason;
  }
}