/**
 * Typed errors for payroll runs that have already been finalized.
 * Messages stay generic so salary, employee, and proof data cannot leak.
 */

export type FinalizedPayrollRunCode =
  | "RUN_ALREADY_FINALIZED"
  | "RUN_NOT_FINALIZED"
  | "INVALID_RUN_REFERENCE";

const FINALIZED = new Set(["EXECUTED", "COMPLETED", "CANCELLED", "FAILED", "FINALIZED"]);

const MESSAGES: Record<FinalizedPayrollRunCode, string> = {
  RUN_ALREADY_FINALIZED: "This payroll run is finalized and can no longer be changed.",
  RUN_NOT_FINALIZED: "This operation requires a finalized payroll run.",
  INVALID_RUN_REFERENCE: "The payroll run reference is not valid.",
};

export class FinalizedPayrollRunError extends Error {
  readonly code: FinalizedPayrollRunCode;

  constructor(code: FinalizedPayrollRunCode) {
    super(MESSAGES[code]);
    this.name = "FinalizedPayrollRunError";
    this.code = code;
  }
}

export function assertPayrollRunMutable(status: unknown): void {
  if (!isRunStatus(status)) {
    throw new FinalizedPayrollRunError("INVALID_RUN_REFERENCE");
  }
  if (FINALIZED.has(status)) {
    throw new FinalizedPayrollRunError("RUN_ALREADY_FINALIZED");
  }
}

export function assertPayrollRunFinalized(status: unknown): void {
  if (!isRunStatus(status) || !FINALIZED.has(status)) {
    throw new FinalizedPayrollRunError("RUN_NOT_FINALIZED");
  }
}

function isRunStatus(status: unknown): status is string {
  return typeof status === "string" && /^[A-Z_]{1,32}$/.test(status);
}
