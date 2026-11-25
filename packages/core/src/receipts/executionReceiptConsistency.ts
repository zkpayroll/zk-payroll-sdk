import type { PayrollExecutionSummary } from "../summary/types";
import type { PayrollReceipt } from "./types";

export type ExecutionReceiptConsistencyErrorCode =
  | "RECEIPT_REQUIRED"
  | "PAYROLL_ID_MISMATCH"
  | "EXECUTION_STATUS_MISMATCH"
  | "EXECUTION_COUNT_MISMATCH"
  | "EXECUTION_INCOMPLETE"
  | "TRANSACTION_REFERENCE_MISMATCH";

export interface ExecutionReceiptConsistencyIssue {
  code: ExecutionReceiptConsistencyErrorCode;
  message: string;
  field: string;
}

export type ExecutionReceiptConsistencyResult =
  | { ok: true; consistent: true; issues: [] }
  | { ok: false; consistent: false; issues: ExecutionReceiptConsistencyIssue[] };

export interface ExecutionReceiptConsistencyOptions {
  expectedPayrollId?: string;
  requireTransactionReferenceConsistency?: boolean;
}

export function checkPayrollExecutionReceiptConsistency(
  summary: PayrollExecutionSummary | null | undefined,
  receipt: PayrollReceipt | null | undefined,
  options: ExecutionReceiptConsistencyOptions = {}
): ExecutionReceiptConsistencyResult {
  if (!summary) {
    return {
      ok: false,
      consistent: false,
      issues: [
        {
          code: "EXECUTION_COUNT_MISMATCH",
          field: "summary",
          message: "Execution summary is required.",
        },
      ],
    };
  }
  if (!Array.isArray(summary.results)) {
    return {
      ok: false,
      consistent: false,
      issues: [
        {
          code: "EXECUTION_COUNT_MISMATCH",
          field: "results",
          message: "Execution results are required to confirm batch completion.",
        },
      ],
    };
  }
  if (!receipt) {
    return {
      ok: false,
      consistent: false,
      issues: [
        {
          code: "RECEIPT_REQUIRED",
          field: "receipt",
          message: "Payroll execution receipt is required.",
        },
      ],
    };
  }

  const issues: ExecutionReceiptConsistencyIssue[] = [];
  if (
    !Number.isSafeInteger(summary.totalCount) ||
    summary.totalCount < 0 ||
    summary.results.length !== summary.totalCount
  ) {
    issues.push({
      code: "EXECUTION_COUNT_MISMATCH",
      field: "totalCount",
      message: "Execution results do not include every expected recipient.",
    });
  }
  const hasPendingRecipient = summary.results.some((result) => result.status === "pending");
  if (hasPendingRecipient || summary.pendingCount > 0) {
    issues.push({
      code: "EXECUTION_INCOMPLETE",
      field: "pendingCount",
      message: "Batch completion cannot be reported until every recipient has a terminal result.",
    });
  }
  if (
    summary.status === "success" &&
    (summary.successCount !== summary.totalCount || summary.failureCount !== 0)
  ) {
    issues.push({
      code: "EXECUTION_INCOMPLETE",
      field: "status",
      message: "A successful batch must contain a successful result for every recipient.",
    });
  }
  if (options.expectedPayrollId && receipt.payrollId !== options.expectedPayrollId) {
    issues.push({
      code: "PAYROLL_ID_MISMATCH",
      field: "payrollId",
      message: "Receipt payroll identifier is inconsistent.",
    });
  }
  if (summary.totalCount !== (receipt.recipientCount ?? summary.totalCount)) {
    issues.push({
      code: "EXECUTION_COUNT_MISMATCH",
      field: "recipientCount",
      message: "Receipt recipient count is inconsistent with the execution summary.",
    });
  }

  const settled =
    receipt.settlementStatus === "settled" || receipt.settlementStatus === "confirmed";
  const summarySettled = summary.status === "success";
  if (
    summary.status === "failure" ||
    summary.status === "partial" ||
    summary.status === "pending"
  ) {
    if (settled) {
      issues.push({
        code: "EXECUTION_STATUS_MISMATCH",
        field: "settlementStatus",
        message: "Settled receipt conflicts with a non-successful execution summary.",
      });
    }
  } else if (settled !== summarySettled) {
    issues.push({
      code: "EXECUTION_STATUS_MISMATCH",
      field: "settlementStatus",
      message: "Receipt settlement status conflicts with execution status.",
    });
  }

  if (options.requireTransactionReferenceConsistency !== false) {
    const txHashes = summary.results
      .map((result) => result.txHash)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (txHashes.length > 0) {
      const receiptTx =
        typeof receipt.transactionReference === "string"
          ? receipt.transactionReference
          : receipt.transactionReference.txHash;
      if (!txHashes.includes(receiptTx.trim())) {
        issues.push({
          code: "TRANSACTION_REFERENCE_MISMATCH",
          field: "transactionReference",
          message: "Receipt transaction reference does not match an execution result.",
        });
      }
    }
  }

  return issues.length === 0
    ? { ok: true, consistent: true, issues: [] }
    : { ok: false, consistent: false, issues };
}

export const validatePayrollExecutionReceiptConsistency = checkPayrollExecutionReceiptConsistency;
