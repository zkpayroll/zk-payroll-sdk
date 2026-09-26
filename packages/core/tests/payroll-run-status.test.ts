import {
  PayrollRunStatus,
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
});
