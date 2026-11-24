import {
  PayrollScheduleValidationError,
  payrollSchedulesOverlap,
  validateNoPayrollScheduleOverlap,
  validatePayrollSchedulePeriod,
} from "../../src/payroll/schedule-validation";

describe("Payroll schedule overlap validation", () => {
  const existing = {
    id: "schedule-1",
    scopeId: "org-1",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-31T23:59:59.999Z",
  };

  it("allows a schedule when there are no existing schedules", () => {
    expect(() =>
      validateNoPayrollScheduleOverlap(existing, []),
    ).not.toThrow();
  });

  it("detects overlapping schedules within the same scope", () => {
    const proposed = {
      scopeId: "org-1",
      startDate: "2026-01-15T00:00:00.000Z",
      endDate: "2026-02-15T00:00:00.000Z",
    };

    expect(() =>
      validateNoPayrollScheduleOverlap(proposed, [existing]),
    ).toThrow(PayrollScheduleValidationError);
  });

  it("allows non-overlapping schedules", () => {
    const proposed = {
      scopeId: "org-1",
      startDate: "2026-02-01T00:00:00.000Z",
      endDate: "2026-02-28T23:59:59.999Z",
    };

    expect(() =>
      validateNoPayrollScheduleOverlap(proposed, [existing]),
    ).not.toThrow();
  });

  it("does not block schedules in a different scope", () => {
    const proposed = {
      scopeId: "org-2",
      startDate: existing.startDate,
      endDate: existing.endDate,
    };

    expect(() =>
      validateNoPayrollScheduleOverlap(proposed, [existing]),
    ).not.toThrow();
  });

  it("detects overlapping boundary dates", () => {
    const proposed = {
      scopeId: "org-1",
      startDate: existing.endDate,
      endDate: "2026-02-15T00:00:00.000Z",
    };

    expect(payrollSchedulesOverlap(proposed, existing)).toBe(true);
  });

  it("allows updating a schedule without conflicting with itself", () => {
    const proposed = {
      id: "schedule-1",
      scopeId: "org-1",
      startDate: existing.startDate,
      endDate: existing.endDate,
    };

    expect(() =>
      validateNoPayrollScheduleOverlap(
        proposed,
        [existing],
        "schedule-1",
      ),
    ).not.toThrow();
  });

  it("rejects start dates later than end dates", () => {
    const invalid = {
      scopeId: "org-1",
      startDate: "2026-03-31T00:00:00.000Z",
      endDate: "2026-03-01T00:00:00.000Z",
    };

    expect(() =>
      validatePayrollSchedulePeriod(invalid),
    ).toThrow(PayrollScheduleValidationError);
  });

  it("rejects invalid date input", () => {
    const invalid = {
      scopeId: "org-1",
      startDate: "not-a-date",
      endDate: "2026-03-31T00:00:00.000Z",
    };

    expect(() =>
      validatePayrollSchedulePeriod(invalid),
    ).toThrow("Invalid payroll schedule start date.");
  });

  it("rejects an empty scope ID", () => {
    const invalid = {
      scopeId: " ",
      startDate: "2026-03-01T00:00:00.000Z",
      endDate: "2026-03-31T00:00:00.000Z",
    };

    expect(() =>
      validatePayrollSchedulePeriod(invalid),
    ).toThrow("Payroll schedule scope is required.");
  });
});