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
