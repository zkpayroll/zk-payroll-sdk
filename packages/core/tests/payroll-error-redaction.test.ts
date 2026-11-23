import {
  redactPayrollContext,
  redactPayrollError,
} from "../src";

describe("privacy-safe payroll error redaction", () => {
  it("redacts salary, recipient, proof, and key values", () => {
    const safe = redactPayrollError(
      new Error(
        "Salary salary=5000 recipient GABC123 employee=emp-1 privateKey=SABC proof=deadbeef"
      )
    );
    expect(safe.safe).toBe(true);
    expect(safe.message).not.toContain("5000");
    expect(safe.message).not.toContain("GABC123");
  });

  it("returns a stable privacy-safe result for unknown failures", () => {
    expect(redactPayrollError(null)).toEqual({
      code: "PAYROLL_ERROR",
      message: "A privacy-sensitive payroll operation failed.",
      safe: true,
    });
  });

  it("redacts nested payroll context fields", () => {
    const safe = redactPayrollContext({
      network: "testnet",
      employeeId: "employee-1",
      salary: 5000n,
    });
    expect(safe.network).toBe("testnet");
    expect(safe.employeeId).toBe("[PAYROLL_DATA_REDACTED]");
    expect(safe.salary).toBe("[PAYROLL_DATA_REDACTED]");
  });
});
