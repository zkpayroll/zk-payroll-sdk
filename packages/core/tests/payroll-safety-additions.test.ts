import {
  checkPayrollExecutionReceiptConsistency,
  createExecutionSummary,
  parseSettlementTimeoutResponse,
  successOutcome,
  validatePayrollDraftRevisionLineage,
  analyzeApprovalInvalidation,
  ApprovalInvalidationReasonCode,
} from "../src";

describe("payroll safety additions", () => {
  it("parses typed settlement timeout responses", () => {
    const result = parseSettlementTimeoutResponse({
      status: "TRANSACTION_TIMEOUT",
      timeoutMs: 30_000,
      elapsedMs: 30_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe("CONFIRMATION_TIMEOUT");
      expect(result.value.retryable).toBe(true);
    }
  });

  it("validates draft revision lineage and rejects broken parents", () => {
    expect(
      validatePayrollDraftRevisionLineage([
        { revision: 1 },
        { revision: 2, parentRevision: 1 },
      ]).ok
    ).toBe(true);
    expect(
      validatePayrollDraftRevisionLineage([
        { revision: 2, parentRevision: 99 },
      ]).ok
    ).toBe(false);
  });

  it("detects receipt and execution inconsistencies", () => {
    const summary = createExecutionSummary(
      [successOutcome("recipient", 100n, "native", "tx-1")],
      10
    );
    const result = checkPayrollExecutionReceiptConsistency(summary, {
      receiptId: "rcpt-1",
      payrollId: "run-1",
      settlementStatus: "failed",
      transactionReference: "tx-2",
      metadataDigest: "a".repeat(64),
      issuedAt: Date.now(),
      recipientCount: 2,
    });
    expect(result.ok).toBe(false);
  });

  it("uses typed privacy-safe approval invalidation reasons", () => {
    const draft = {
      draftId: "draft-1",
      totalAmount: "100",
      asset: "native",
      scheduleTimestamp: "2026-01-01",
      recipients: [{ recipientId: "recipient", amount: "100" }],
      policy: {} as never,
      approvals: [{ approverId: "approver", approvedAt: "2026-01-01" }],
    };
    const modified = { ...draft, totalAmount: "200" };
    const result = analyzeApprovalInvalidation(draft, modified);
    expect(result.reasonCodes).toContain(
      ApprovalInvalidationReasonCode.TOTAL_AMOUNT_CHANGED
    );
    expect(result.reasons.join(" ")).not.toContain("200");
  });
});
