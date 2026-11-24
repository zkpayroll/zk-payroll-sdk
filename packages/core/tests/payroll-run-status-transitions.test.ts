import {
  PAYROLL_RUN_STATUS_TRANSITIONS,
  PAYROLL_RUN_STATUSES,
  PayrollRunStatusTransitionError,
  assertPayrollRunStatusTransition,
  canTransitionPayrollRunStatus,
  getAllowedPayrollRunStatusTransitions,
  isTerminalPayrollRunStatus,
} from "../src/payroll/runStatus";

function captureError(fn: () => void): PayrollRunStatusTransitionError {
  try {
    fn();
  } catch (error) {
    return error as PayrollRunStatusTransitionError;
  }
  throw new Error("expected function to throw");
}

describe("payroll run status transitions", () => {
  it("allows the forward lifecycle: draft to scheduled to a final outcome", () => {
    expect(canTransitionPayrollRunStatus("draft", "scheduled")).toBe(true);
    expect(canTransitionPayrollRunStatus("scheduled", "executed")).toBe(true);
    expect(canTransitionPayrollRunStatus("scheduled", "failed")).toBe(true);
  });

  it("allows cancelling a run before it executes", () => {
    expect(canTransitionPayrollRunStatus("draft", "cancelled")).toBe(true);
    expect(canTransitionPayrollRunStatus("scheduled", "cancelled")).toBe(true);
  });

  it("rejects skipping scheduling", () => {
    expect(canTransitionPayrollRunStatus("draft", "executed")).toBe(false);
    expect(canTransitionPayrollRunStatus("draft", "failed")).toBe(false);
  });

  it("rejects any move out of a terminal status", () => {
    expect(canTransitionPayrollRunStatus("executed", "scheduled")).toBe(false);
    expect(canTransitionPayrollRunStatus("cancelled", "draft")).toBe(false);
    expect(canTransitionPayrollRunStatus("failed", "scheduled")).toBe(false);
    expect(canTransitionPayrollRunStatus("failed", "executed")).toBe(false);
  });

  it("rejects staying in the same status", () => {
    expect(canTransitionPayrollRunStatus("scheduled", "scheduled")).toBe(false);
  });

  it("normalizes case and whitespace like parsePayrollRunStatus", () => {
    expect(canTransitionPayrollRunStatus(" DRAFT ", "Scheduled")).toBe(true);
  });

  it("treats unknown or missing statuses as non-transitions instead of throwing", () => {
    expect(canTransitionPayrollRunStatus("draft", undefined)).toBe(false);
    expect(canTransitionPayrollRunStatus(42, "scheduled")).toBe(false);
    expect(canTransitionPayrollRunStatus("paused", "scheduled")).toBe(false);
  });

  it("throws a typed error for an unknown status without echoing the value", () => {
    const secret = "salary-private-value";
    const error = captureError(() => assertPayrollRunStatusTransition(secret, "scheduled"));

    expect(error).toBeInstanceOf(PayrollRunStatusTransitionError);
    expect(error.code).toBe("UNKNOWN_STATUS");
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("throws MISSING_STATUS when the target status is empty", () => {
    const error = captureError(() => assertPayrollRunStatusTransition("draft", "  "));

    expect(error.code).toBe("MISSING_STATUS");
  });

  it("reports an invalid transition with the normalized statuses", () => {
    const error = captureError(() => assertPayrollRunStatusTransition("draft", "executed"));

    expect(error).toBeInstanceOf(PayrollRunStatusTransitionError);
    expect(error.code).toBe("INVALID_TRANSITION");
    expect(error.from).toBe("draft");
    expect(error.to).toBe("executed");
  });

  it("does not throw for any allowed transition", () => {
    for (const from of PAYROLL_RUN_STATUSES) {
      for (const to of getAllowedPayrollRunStatusTransitions(from)) {
        expect(() => assertPayrollRunStatusTransition(from, to)).not.toThrow();
      }
    }
  });

  it("gives terminal statuses no outgoing transitions", () => {
    for (const status of PAYROLL_RUN_STATUSES) {
      const hasTransitions = getAllowedPayrollRunStatusTransitions(status).length > 0;
      expect(hasTransitions).toBe(!isTerminalPayrollRunStatus(status));
    }
  });

  it("has exactly one transition-table entry per status", () => {
    expect(Object.keys(PAYROLL_RUN_STATUS_TRANSITIONS).sort()).toEqual(
      [...PAYROLL_RUN_STATUSES].sort()
    );
  });
});
