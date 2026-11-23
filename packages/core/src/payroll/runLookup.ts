export type PayrollRunLookupNotFoundCode = "PAYROLL_RUN_NOT_FOUND";

export interface PayrollRunLookupSuccess<T> {
  readonly ok: true;
  readonly found: true;
  readonly run: T;
}

export interface PayrollRunLookupNotFound {
  readonly ok: false;
  readonly found: false;
  readonly code: PayrollRunLookupNotFoundCode;
  readonly message: "Payroll run was not found.";
}

export type PayrollRunLookupResult<T> =
  | PayrollRunLookupSuccess<T>
  | PayrollRunLookupNotFound;

export type MissingPayrollRunResult = PayrollRunLookupNotFound;

export function notFoundPayrollRun(): PayrollRunLookupNotFound {
  return {
    ok: false,
    found: false,
    code: "PAYROLL_RUN_NOT_FOUND",
    message: "Payroll run was not found.",
  };
}

export function lookupPayrollRun<T>(
  runs: readonly T[],
  matches: (run: T) => boolean
): PayrollRunLookupResult<T> {
  const run = runs.find(matches);
  return run === undefined
    ? notFoundPayrollRun()
    : { ok: true, found: true, run };
}

export function findPayrollRunById<T extends { readonly runId: string }>(
  runs: readonly T[],
  runId: string
): PayrollRunLookupResult<T> {
  const normalized = runId?.trim();
  if (!normalized) return notFoundPayrollRun();
  return lookupPayrollRun(runs, (run) => run.runId === normalized);
}
