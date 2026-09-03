import { analyzeApprovalInvalidation } from "./invalidationAnalyzer";
import { CompiledPayrollPolicy, PayrollDraft } from "../policy/types";

describe("Approval Invalidation Analyzer (#404)", () => {
  const basePolicy = {
    maxBatchAmount: 1000000n,
    requiredApprovalsCount: 2,
    allowedAsset: "USDC",
  };

  const sampleDraft: PayrollDraft = {
    draftId: "draft-001",
    // version: 1,
    totalAmount: "50000",
    asset: "USDC",
    recipients: [
      { amount: "30000", recipientId: "GAAA..." },
      { amount: "20000", recipientId: "GBBB..." },
    ],
    scheduleTimestamp: "1700000000",
    policy: basePolicy as never as CompiledPayrollPolicy,
    approvals: [
      { approverId: "admin1", signature: "sig1", approvedAt: "1699990000" },
      { approverId: "admin2", signature: "sig2", approvedAt: "1699990100" },
    ],
  };

  it("returns no invalidation when draft is unchanged", () => {
    const result = analyzeApprovalInvalidation(sampleDraft, sampleDraft);
    expect(result.requiresReapproval).toBe(false);
    expect(result.invalidatedApprovalsCount).toBe(0);
    expect(result.reasons.length).toBe(0);
  });

  it("detects amount change and invalidates existing approvals", () => {
    const modified = { ...sampleDraft, totalAmount: "55000" };
    const result = analyzeApprovalInvalidation(sampleDraft, modified);
    expect(result.requiresReapproval).toBe(true);
    expect(result.invalidatedApprovalsCount).toBe(2);
    expect(result.reasons[0]).toContain("Total payment amount changed");
  });

  it("detects recipient payout changes and requests reapproval", () => {
    const modified: PayrollDraft = {
      ...sampleDraft,
      recipients: [
        { amount: "25000", recipientId: "GAAA..." },
        { amount: "25000", recipientId: "GBBB..." },
      ],
    };
    const result = analyzeApprovalInvalidation(sampleDraft, modified);
    expect(result.requiresReapproval).toBe(true);
    expect(result.changedFields).toContain("recipient_0");
  });
});
