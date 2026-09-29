import {
  cleanupStaleApprovalRequests,
  type PayrollApprovalRequest,
} from "../../src/approval";

const request = (
  approvalId: string,
  expiresAt: number,
): PayrollApprovalRequest => ({
  approvalId,
  payrollRunId: "run-private",
  approverId: "approver-private",
  recipientId: "recipient-private",
  amount: 100n,
  asset: "USDC",
  expiresAt,
});

describe("cleanupStaleApprovalRequests", () => {
  it("removes expired approvals, including requests expiring at now", () => {
    const requests = [
      request("expired", 99),
      request("at-boundary", 100),
      request("active", 101),
    ];

    expect(cleanupStaleApprovalRequests(requests, 100)).toEqual([requests[2]]);
  });

  it("drops malformed expiries without mutating the input", () => {
    const requests = [request("active", 101), request("invalid", Number.NaN)];

    expect(cleanupStaleApprovalRequests(requests, 100)).toEqual([requests[0]]);
    expect(requests).toHaveLength(2);
  });

  it("rejects a non-finite cleanup time with a generic error", () => {
    expect(() =>
      cleanupStaleApprovalRequests([request("private-id", 101)], Number.NaN),
    ).toThrow("Current time must be a finite timestamp.");
  });
});