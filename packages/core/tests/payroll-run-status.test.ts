import {
  PayrollRunStatus,
  PAYROLL_RUN_STATUSES,
  isPayrollRunStatus,
  isTerminalPayrollRunStatus,
  parsePayrollRunStatus,
} from "../src/payroll/runStatus";

describe("payroll run status model", () => {
  it("normalizes a supported external status to a typed value", () => {
    expect(parsePayrollRunStatus(" EXECUTED ")).toEqual({
      ok: true,
      status: PayrollRunStatus.EXECUTED,
    });
    expect(isPayrollRunStatus("scheduled")).toBe(true);
    expect(isTerminalPayrollRunStatus(PayrollRunStatus.FAILED)).toBe(true);
  });

  it("returns a stable failure without exposing an unknown value", () => {
    const secret = "private-payroll-value";
    const result = parsePayrollRunStatus(secret);
    expect(result).toMatchObject({ ok: false, code: "UNKNOWN_STATUS" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("exports every status once in stable lifecycle order", () => {
    expect(PAYROLL_RUN_STATUSES).toEqual(["draft", "scheduled", "executed", "cancelled", "failed"]);
    expect(new Set(PAYROLL_RUN_STATUSES).size).toBe(PAYROLL_RUN_STATUSES.length);
    expect(Object.isFrozen(PAYROLL_RUN_STATUSES)).toBe(true);
  });
});
