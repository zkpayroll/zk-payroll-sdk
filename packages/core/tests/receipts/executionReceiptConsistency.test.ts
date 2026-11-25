import { createExecutionSummary, successOutcome } from "../../src/summary/PayrollExecutionSummary";
import { checkPayrollExecutionReceiptConsistency } from "../../src/receipts/executionReceiptConsistency";

describe("payroll execution receipt completion boundary", () => {
  const receipt = {
    receiptId: "rcpt-complete",
    payrollId: "run-complete",
    settlementStatus: "settled" as const,
    transactionReference: "tx-1",
    metadataDigest: "a".repeat(64),
    issuedAt: 1_700_000_000_000,
    recipientCount: 2,
  };

  it("accepts a completion receipt after the final recipient succeeds", () => {
    const summary = createExecutionSummary(
      [
        successOutcome("recipient-a", 100n, "native", "tx-1"),
        successOutcome("recipient-b", 200n, "native", "tx-1"),
      ],
      10
    );
    expect(checkPayrollExecutionReceiptConsistency(summary, receipt).ok).toBe(true);
  });

  it("rejects a completion receipt before the final recipient has a result", () => {
    const complete = createExecutionSummary(
      [
        successOutcome("recipient-a", 100n, "native", "tx-1"),
        successOutcome("recipient-b", 200n, "native", "tx-1"),
      ],
      10
    );
    const incomplete = checkPayrollExecutionReceiptConsistency(
      { ...complete, results: complete.results.slice(0, 1) },
      receipt
    );
    expect(incomplete.ok).toBe(false);
    expect(incomplete.issues.some((issue) => issue.code === "EXECUTION_COUNT_MISMATCH")).toBe(true);
    expect(incomplete.issues.map((issue) => issue.message).join(" ")).not.toContain("recipient-a");
  });

  it("rejects the boundary case where a recipient remains pending", () => {
    const summary = {
      ...createExecutionSummary([successOutcome("recipient-a", 100n, "native", "tx-1")], 10),
      totalCount: 2,
      pendingCount: 1,
      results: [
        successOutcome("recipient-a", 100n, "native", "tx-1"),
        { recipient: "recipient-b", amount: 200n, asset: "native", status: "pending" as const },
      ],
    };
    const result = checkPayrollExecutionReceiptConsistency(summary, receipt);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "EXECUTION_INCOMPLETE")).toBe(true);
  });
});
