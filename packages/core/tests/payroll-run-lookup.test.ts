import { findPayrollRunById, lookupPayrollRun } from "../src";

describe("typed payroll run lookup", () => {
  it("returns a found run", () => {
    const result = findPayrollRunById([{ runId: "run-1", status: "draft" }], "run-1");
    expect(result).toEqual({
      ok: true,
      found: true,
      run: { runId: "run-1", status: "draft" },
    });
  });

  it("returns a typed not-found result", () => {
    const result = findPayrollRunById([], "missing");
    expect(result).toEqual({
      ok: false,
      found: false,
      code: "PAYROLL_RUN_NOT_FOUND",
      message: "Payroll run was not found.",
    });
  });

  it("uses the exact predicate boundary", () => {
    const runs = [{ id: 1 }, { id: 2 }];
    expect(lookupPayrollRun(runs, (run) => run.id === 2).ok).toBe(true);
    expect(lookupPayrollRun(runs, (run) => run.id === 3)).toMatchObject({
      ok: false,
      code: "PAYROLL_RUN_NOT_FOUND",
    });
  });
});
