import {
  checkEmployeeRemoval,
  EmployeeRemovalReasonCode,
  getEmployeeRemovalReasonDescription,
} from "../src/employees/removal";

describe("checkEmployeeRemoval", () => {
  it("allows removal when the payroll is in draft status", () => {
    const result = checkEmployeeRemoval("emp-1", "draft");
    expect(result.allowed).toBe(true);
    expect(result.blockedReason).toBeNull();
    expect(result.employeeId).toBe("emp-1");
    expect(result.payrollStatus).toBe("draft");
  });

  it("blocks removal when the payroll is locked", () => {
    const result = checkEmployeeRemoval("emp-1", "locked");
    expect(result.allowed).toBe(false);
    expect(result.blockedReason?.code).toBe(EmployeeRemovalReasonCode.PAYROLL_LOCKED);
  });

  it("blocks removal when the payroll is settled", () => {
    const result = checkEmployeeRemoval("emp-1", "settled");
    expect(result.allowed).toBe(false);
    expect(result.blockedReason?.code).toBe(EmployeeRemovalReasonCode.PAYROLL_SETTLED);
  });

  it("blocks removal when the payroll is cancelled", () => {
    const result = checkEmployeeRemoval("emp-1", "cancelled");
    expect(result.allowed).toBe(false);
    expect(result.blockedReason?.code).toBe(EmployeeRemovalReasonCode.PAYROLL_CANCELLED);
  });

  it("returns a UI-friendly, non-empty message for every blocked status", () => {
    for (const status of ["locked", "settled", "cancelled"] as const) {
      const result = checkEmployeeRemoval("emp-1", status);
      expect(result.blockedReason?.message.length).toBeGreaterThan(0);
      expect(result.blockedReason?.payrollStatus).toBe(status);
    }
  });

  it("exposes reason descriptions for every reason code (for standalone UI lookups)", () => {
    for (const code of Object.values(EmployeeRemovalReasonCode)) {
      expect(getEmployeeRemovalReasonDescription(code).length).toBeGreaterThan(0);
    }
  });

  it("only draft status is allowed — every other status is blocked", () => {
    const statuses = ["draft", "locked", "settled", "cancelled"] as const;
    const results = statuses.map((s) => checkEmployeeRemoval("emp-1", s).allowed);
    expect(results).toEqual([true, false, false, false]);
  });
});
