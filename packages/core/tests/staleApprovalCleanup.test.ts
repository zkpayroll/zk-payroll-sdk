import { evaluateStaleApprovalCleanupEligibility } from "../src/payroll/staleApprovalCleanup";

describe("evaluateStaleApprovalCleanupEligibility", () => {
  const ONE_HOUR = 3600000;
  
  it("allows cleanup for stale approved status", () => {
    const result = evaluateStaleApprovalCleanupEligibility({
      status: "approved",
      executed: false,
      expiresAt: Date.now() - ONE_HOUR,
    });
    
    expect(result.isEligible).toBe(true);
    expect(result.code).toBe("ELIGIBLE");
  });

  it("blocks cleanup if executed", () => {
    const result = evaluateStaleApprovalCleanupEligibility({
      status: "approved",
      executed: true,
      expiresAt: Date.now() - ONE_HOUR,
    });
    
    expect(result.isEligible).toBe(false);
    expect(result.code).toBe("ALREADY_EXECUTED");
  });

  it("blocks cleanup if missing expiration timestamp", () => {
    const result = evaluateStaleApprovalCleanupEligibility({
      status: "pending",
      executed: false,
      expiresAt: null,
    });
    
    expect(result.isEligible).toBe(false);
    expect(result.code).toBe("MISSING_TIMESTAMP");
  });

  it("blocks cleanup if not yet stale", () => {
    const result = evaluateStaleApprovalCleanupEligibility({
      status: "approved",
      executed: false,
      expiresAt: Date.now() + ONE_HOUR,
    });
    
    expect(result.isEligible).toBe(false);
    expect(result.code).toBe("APPROVAL_NOT_STALE");
  });

  it("blocks cleanup for unrecognized status", () => {
    const result = evaluateStaleApprovalCleanupEligibility({
      status: "invalid_status",
      executed: false,
      expiresAt: Date.now() - ONE_HOUR,
    });
    
    expect(result.isEligible).toBe(false);
    expect(result.code).toBe("INVALID_STATUS");
  });
});
