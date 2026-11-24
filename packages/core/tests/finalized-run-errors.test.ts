import { FinalizedPayrollRunError, assertPayrollRunFinalized, assertPayrollRunMutable } from "../src/payroll/finalizedRunErrors";

describe("finalized payroll run errors", () => {
  it("allows an open run and rejects a finalized one", () => {
    expect(() => assertPayrollRunMutable("PENDING")).not.toThrow();
    expect(() => assertPayrollRunMutable("COMPLETED")).toThrow(FinalizedPayrollRunError);
    try {
      assertPayrollRunMutable("COMPLETED");
    } catch (error) {
      expect(error).toMatchObject({ code: "RUN_ALREADY_FINALIZED" });
      expect((error as Error).message).not.toMatch(/salary|employee|proof/i);
    }
  });

  it("rejects a missing reference and a non-finalized read", () => {
    expect(() => assertPayrollRunMutable("")).toThrow(FinalizedPayrollRunError);
    expect(() => assertPayrollRunMutable("pending")).toThrow(FinalizedPayrollRunError);
    expect(() => assertPayrollRunFinalized("PENDING")).toThrow(FinalizedPayrollRunError);
    expect(() => assertPayrollRunFinalized("FINALIZED")).not.toThrow();
  });
});
