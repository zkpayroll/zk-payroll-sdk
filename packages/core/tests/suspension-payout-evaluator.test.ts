import {
  evaluateSuspensionPayout,
  evaluateSuspensionPayoutBatch,
  SuspensionPayoutEvaluation,
} from "../src/employees/suspensionPayoutEvaluator";
import { EmployeeEligibilityRecord } from "../src/eligibility/types";

const REF_TIME = 1700000000000;

function makeEmployee(
  overrides: Partial<EmployeeEligibilityRecord> = {}
): EmployeeEligibilityRecord {
  return {
    employeeId: "emp-12345",
    recipient: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV",
    status: "suspended",
    salary: BigInt(50000),
    complianceStatus: "passed",
    ...overrides,
  };
}

describe("evaluateSuspensionPayout", () => {
  it("returns accrued_payout for a suspended employee with salary", () => {
    const employee = makeEmployee();
    const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

    expect(result.disposition).toBe("accrued_payout");
    expect(result.shouldPayout).toBe(true);
    expect(result.reasonCode).toBe("ACCRUED_WAGES_DUE");
    expect(result.employeeId).toBe("emp-12345");
    expect(result.evaluatedAt).toBe(REF_TIME);
    expect(result.suggestedAction).toBeDefined();
  });

  it("returns final_settlement for a suspended employee with expired contract", () => {
    const employee = makeEmployee({
      expiryDate: REF_TIME - 86400000, // expired 1 day ago
    });
    const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

    expect(result.disposition).toBe("final_settlement");
    expect(result.shouldPayout).toBe(true);
    expect(result.reasonCode).toBe("FINAL_SETTLEMENT_DUE");
    expect(result.suggestedAction).toContain("final settlement");
  });

  it("returns no_payout with NOT_SUSPENDED for a non-suspended employee", () => {
    const employee = makeEmployee({ status: "active" });
    const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

    expect(result.disposition).toBe("no_payout");
    expect(result.shouldPayout).toBe(false);
    expect(result.reasonCode).toBe("NOT_SUSPENDED");
  });

  it("returns no_payout with ACCOUNT_BLOCKED for a blocked suspended employee", () => {
    const employee = makeEmployee({ isBlocked: true });
    const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

    expect(result.disposition).toBe("no_payout");
    expect(result.shouldPayout).toBe(false);
    expect(result.reasonCode).toBe("ACCOUNT_BLOCKED");
    expect(result.suggestedAction).toBeDefined();
  });

  it("returns accrued_payout for a blocked suspended employee when allowBlockedPayout is true", () => {
    const employee = makeEmployee({ isBlocked: true });
    const result = evaluateSuspensionPayout(employee, {
      referenceTime: REF_TIME,
      allowBlockedPayout: true,
    });

    expect(result.disposition).toBe("accrued_payout");
    expect(result.shouldPayout).toBe(true);
    expect(result.reasonCode).toBe("ACCRUED_WAGES_DUE");
  });

  it("returns review_required with ACCOUNT_LOCKED for a locked suspended employee", () => {
    const employee = makeEmployee({ isLocked: true });
    const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

    expect(result.disposition).toBe("review_required");
    expect(result.shouldPayout).toBe(false);
    expect(result.reasonCode).toBe("ACCOUNT_LOCKED");
    expect(result.suggestedAction).toContain("Unlock");
  });

  it("returns no_payout with COMPLIANCE_FAILED for a compliance-failed suspended employee", () => {
    const employee = makeEmployee({ complianceStatus: "failed" });
    const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

    expect(result.disposition).toBe("no_payout");
    expect(result.shouldPayout).toBe(false);
    expect(result.reasonCode).toBe("COMPLIANCE_FAILED");
  });

  it("allows payout for compliance-failed employee when allowComplianceFailedSettlement is true", () => {
    const employee = makeEmployee({ complianceStatus: "failed" });
    const result = evaluateSuspensionPayout(employee, {
      referenceTime: REF_TIME,
      allowComplianceFailedSettlement: true,
    });

    expect(result.shouldPayout).toBe(true);
    expect(result.disposition).toBe("accrued_payout");
    expect(result.reasonCode).toBe("ACCRUED_WAGES_DUE");
  });

  it("returns review_required with NO_SALARY_CONFIGURED when no salary is set", () => {
    const employee = makeEmployee({ salary: undefined, amount: undefined });
    const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

    expect(result.disposition).toBe("review_required");
    expect(result.shouldPayout).toBe(false);
    expect(result.reasonCode).toBe("NO_SALARY_CONFIGURED");
    expect(result.suggestedAction).toContain("Configure");
  });

  it("returns review_required with PENDING_REVIEW for pending compliance", () => {
    const employee = makeEmployee({ complianceStatus: "pending" });
    const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

    expect(result.disposition).toBe("review_required");
    expect(result.shouldPayout).toBe(false);
    expect(result.reasonCode).toBe("PENDING_REVIEW");
    expect(result.suggestedAction).toContain("compliance review");
  });

  describe("employee ID redaction", () => {
    it("redacts employee ID by default in redactedReason", () => {
      const employee = makeEmployee({ employeeId: "emp-12345" });
      const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

      expect(result.redactedEmployeeId).toBe("emp***345");
      expect(result.redactedReason).toContain("emp***345");
      expect(result.redactedReason).not.toContain("emp-12345");
    });

    it("uses full ID in reason field", () => {
      const employee = makeEmployee({ employeeId: "emp-12345" });
      const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

      expect(result.reason).toContain("emp-12345");
    });

    it("shows full ID in redactedReason when redact is false", () => {
      const employee = makeEmployee({ employeeId: "emp-12345" });
      const result = evaluateSuspensionPayout(employee, {
        referenceTime: REF_TIME,
        redact: false,
      });

      expect(result.redactedReason).toContain("emp-12345");
    });

    it("handles short employee IDs with [REDACTED_EMPLOYEE]", () => {
      const employee = makeEmployee({ employeeId: "ab" });
      const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

      expect(result.redactedEmployeeId).toBe("[REDACTED_EMPLOYEE]");
    });

    it("handles empty employee IDs with [ANONYMOUS_EMPLOYEE]", () => {
      const employee = makeEmployee({ employeeId: "" });
      const result = evaluateSuspensionPayout(employee, { referenceTime: REF_TIME });

      expect(result.redactedEmployeeId).toBe("[ANONYMOUS_EMPLOYEE]");
    });
  });
});

describe("evaluateSuspensionPayoutBatch", () => {
  it("evaluates a batch of mixed employees correctly", () => {
    const employees: EmployeeEligibilityRecord[] = [
      // accrued_payout
      makeEmployee({ employeeId: "emp-001" }),
      // final_settlement (expired)
      makeEmployee({
        employeeId: "emp-002",
        expiryDate: REF_TIME - 86400000,
      }),
      // no_payout (not suspended)
      makeEmployee({ employeeId: "emp-003", status: "active" }),
      // no_payout (blocked)
      makeEmployee({ employeeId: "emp-004", isBlocked: true }),
      // review_required (locked)
      makeEmployee({ employeeId: "emp-005", isLocked: true }),
      // review_required (no salary)
      makeEmployee({ employeeId: "emp-006", salary: undefined, amount: undefined }),
    ];

    const batch = evaluateSuspensionPayoutBatch(employees, { referenceTime: REF_TIME });

    expect(batch.totalEvaluated).toBe(6);
    expect(batch.payoutCount).toBe(2); // emp-001 (accrued) + emp-002 (final)
    expect(batch.noPayoutCount).toBe(2); // emp-003 (not suspended) + emp-004 (blocked)
    expect(batch.reviewRequiredCount).toBe(2); // emp-005 (locked) + emp-006 (no salary)
    expect(batch.results).toHaveLength(6);

    expect(batch.dispositionSummary.accrued_payout).toBe(1);
    expect(batch.dispositionSummary.final_settlement).toBe(1);
    expect(batch.dispositionSummary.no_payout).toBe(2);
    expect(batch.dispositionSummary.review_required).toBe(2);

    // Verify individual results
    expect(batch.results[0].reasonCode).toBe("ACCRUED_WAGES_DUE");
    expect(batch.results[1].reasonCode).toBe("FINAL_SETTLEMENT_DUE");
    expect(batch.results[2].reasonCode).toBe("NOT_SUSPENDED");
    expect(batch.results[3].reasonCode).toBe("ACCOUNT_BLOCKED");
    expect(batch.results[4].reasonCode).toBe("ACCOUNT_LOCKED");
    expect(batch.results[5].reasonCode).toBe("NO_SALARY_CONFIGURED");
  });

  it("returns zero counts for an empty batch", () => {
    const batch = evaluateSuspensionPayoutBatch([], { referenceTime: REF_TIME });

    expect(batch.totalEvaluated).toBe(0);
    expect(batch.payoutCount).toBe(0);
    expect(batch.noPayoutCount).toBe(0);
    expect(batch.reviewRequiredCount).toBe(0);
    expect(batch.results).toHaveLength(0);
  });
});
