/**
 * Tests for employee payroll eligibility status evaluation (#612).
 */
import {
  evaluateEmployeeEligibilityStatus,
  getEmployeeEligibilityStatus,
  validateEmployeeEligibilityInput,
  assertValidEmployeeEligibilityInput,
  describeEligibilityStatus,
  EmployeeEligibilityValidationError,
  ZkPayrollError,
  type ComplianceHold,
  type EmployeeEligibilityInput,
} from "../src";

function releasedHold(overrides: Partial<ComplianceHold> = {}): ComplianceHold {
  return {
    holdId: "hold-1",
    target: { scope: "employee", id: "emp-9" },
    state: "released",
    reasonCode: "KYC_REVIEW_PENDING",
    placedBy: "officer-a",
    placedAt: 1000,
    releasedBy: "officer-b",
    releasedAt: 2000,
    ...overrides,
  };
}

function activeHold(overrides: Partial<ComplianceHold> = {}): ComplianceHold {
  return {
    holdId: "hold-2",
    target: { scope: "employee", id: "emp-9" },
    state: "active",
    reasonCode: "SANCTIONS_SCREENING",
    placedBy: "officer-a",
    placedAt: 1000,
    ...overrides,
  };
}

describe("evaluateEmployeeEligibilityStatus", () => {
  it("marks an active employee with no compliance data as eligible", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "active",
    });

    expect(result.status).toBe("eligible");
    expect(result.reasons[0].code).toBe("EMPLOYEE_ACTIVE");
  });

  it("marks a suspended employee as ineligible regardless of compliance data", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "suspended",
    });

    expect(result.status).toBe("ineligible");
    expect(result.reasons[0].code).toBe("EMPLOYEE_SUSPENDED");
  });

  it("marks an offboarded employee as ineligible", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "offboarded",
    });

    expect(result.status).toBe("ineligible");
    expect(result.reasons[0].code).toBe("EMPLOYEE_OFFBOARDED");
  });

  it("marks an active employee blocked by an active compliance hold as ineligible", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "active",
      employerId: "employer-1",
      complianceHolds: [activeHold()],
    });

    expect(result.status).toBe("ineligible");
    expect(result.reasons[0].code).toBe("COMPLIANCE_HOLD_ACTIVE");
  });

  it("marks an active employee blocked by an indeterminate-status hold as pending, not ineligible", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "active",
      employerId: "employer-1",
      complianceHolds: [activeHold({ state: "unknown" })],
    });

    expect(result.status).toBe("pending");
    expect(result.reasons[0].code).toBe("COMPLIANCE_HOLD_STATUS_UNKNOWN");
  });

  it("marks an active employee with a released hold on record as conditional", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "active",
      employerId: "employer-1",
      complianceHolds: [releasedHold()],
    });

    expect(result.status).toBe("conditional");
    expect(result.reasons[0].code).toBe("COMPLIANCE_HOLD_RELEASED");
    expect(result.reasons[0].message).toContain("hold-1");
  });

  it("prioritizes an employer-wide active hold over a released employee-scope hold", () => {
    const employerHold: ComplianceHold = {
      holdId: "hold-employer",
      target: { scope: "employer", id: "employer-1" },
      state: "active",
      reasonCode: "REGULATORY_INVESTIGATION",
      placedBy: "officer-a",
      placedAt: 1000,
    };

    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "active",
      employerId: "employer-1",
      complianceHolds: [employerHold, releasedHold()],
    });

    expect(result.status).toBe("ineligible");
    expect(result.reasons[0].code).toBe("COMPLIANCE_HOLD_ACTIVE");
  });

  it("ignores compliance holds scoped to a different employee", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "active",
      employerId: "employer-1",
      complianceHolds: [activeHold({ target: { scope: "employee", id: "emp-other" } })],
    });

    expect(result.status).toBe("eligible");
  });

  it("treats a suspended employee as ineligible even with an unrelated released hold", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-9",
      status: "suspended",
      employerId: "employer-1",
      complianceHolds: [releasedHold()],
    });

    expect(result.status).toBe("ineligible");
    expect(result.reasons[0].code).toBe("EMPLOYEE_SUSPENDED");
  });

  it("echoes the employeeAddress on the result", () => {
    const result = evaluateEmployeeEligibilityStatus({
      employeeAddress: "emp-42",
      status: "active",
    });
    expect(result.employeeAddress).toBe("emp-42");
  });
});

describe("validateEmployeeEligibilityInput / assertValidEmployeeEligibilityInput", () => {
  const validInput: EmployeeEligibilityInput = {
    employeeAddress: "emp-9",
    status: "active",
  };

  it("accepts a valid input with no issues", () => {
    expect(validateEmployeeEligibilityInput(validInput)).toEqual([]);
    expect(() => assertValidEmployeeEligibilityInput(validInput)).not.toThrow();
  });

  it("flags a missing employeeAddress", () => {
    const issues = validateEmployeeEligibilityInput({ ...validInput, employeeAddress: "" });
    expect(issues.some((i) => i.field === "employeeAddress")).toBe(true);
  });

  it("flags an unrecognized status", () => {
    const issues = validateEmployeeEligibilityInput({
      ...validInput,
      status: "on_leave" as never,
    });
    expect(issues.some((i) => i.field === "status")).toBe(true);
  });

  it("flags compliance holds supplied without an employerId", () => {
    const issues = validateEmployeeEligibilityInput({
      ...validInput,
      complianceHolds: [activeHold()],
    });
    expect(issues.some((i) => i.field === "employerId")).toBe(true);
  });

  it("does not flag employerId when complianceHolds is omitted", () => {
    expect(validateEmployeeEligibilityInput(validInput)).toEqual([]);
  });

  it("throws EmployeeEligibilityValidationError with all issues attached on invalid input", () => {
    try {
      assertValidEmployeeEligibilityInput({
        employeeAddress: "",
        status: "bogus" as never,
        complianceHolds: [activeHold()],
      });
      throw new Error("expected assertValidEmployeeEligibilityInput to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmployeeEligibilityValidationError);
      expect(err).toBeInstanceOf(ZkPayrollError);
      const validationErr = err as EmployeeEligibilityValidationError;
      expect(validationErr.code).toBe("EMPLOYEE_ELIGIBILITY_VALIDATION_FAILED");
      expect((validationErr.context.issues as unknown[]).length).toBe(3);
    }
  });

  it("evaluateEmployeeEligibilityStatus throws for invalid input instead of returning a result", () => {
    expect(() =>
      evaluateEmployeeEligibilityStatus({
        employeeAddress: "emp-9",
        status: "bogus" as never,
      })
    ).toThrow(EmployeeEligibilityValidationError);
  });
});

describe("getEmployeeEligibilityStatus", () => {
  it("returns just the categorical status", () => {
    expect(getEmployeeEligibilityStatus({ employeeAddress: "emp-9", status: "active" })).toBe(
      "eligible"
    );
  });
});

describe("describeEligibilityStatus", () => {
  it("returns a label and description for every status", () => {
    for (const status of ["eligible", "conditional", "pending", "ineligible"] as const) {
      const described = describeEligibilityStatus(status);
      expect(described.label).toBeTruthy();
      expect(described.description).toBeTruthy();
    }
  });
});
