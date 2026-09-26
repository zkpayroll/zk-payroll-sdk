export const PayrollRunStatus = {
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  EXECUTED: "executed",
  CANCELLED: "cancelled",
  FAILED: "failed",
} as const;
export type PayrollRunStatus = (typeof PayrollRunStatus)[keyof typeof PayrollRunStatus];
/** Stable ordered list for filters, forms, and exhaustive SDK integrations. */
export const PAYROLL_RUN_STATUSES: readonly PayrollRunStatus[] = Object.freeze(
  Object.values(PayrollRunStatus)
);
export type PayrollRunStatusParseResult =
  | { ok: true; status: PayrollRunStatus }
  | { ok: false; code: "MISSING_STATUS" | "UNKNOWN_STATUS"; message: string };
const VALUES = new Set<string>(PAYROLL_RUN_STATUSES);
const TERMINAL_VALUES = new Set<PayrollRunStatus>([
  PayrollRunStatus.EXECUTED,
  PayrollRunStatus.CANCELLED,
  PayrollRunStatus.FAILED,
]);

/** Converts an untrusted contract/API value without reflecting it in errors. */
export function parsePayrollRunStatus(value: unknown): PayrollRunStatusParseResult {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, code: "MISSING_STATUS", message: "Payroll run status is required." };
  }
  const normalized = value.trim().toLowerCase();
  if (!VALUES.has(normalized)) {
    return {
      ok: false,
      code: "UNKNOWN_STATUS",
      message: "Payroll run status is not supported by this SDK version.",
    };
  }
  return { ok: true, status: normalized as PayrollRunStatus };
}
export function isPayrollRunStatus(value: unknown): value is PayrollRunStatus {
  return parsePayrollRunStatus(value).ok;
}
export function isTerminalPayrollRunStatus(status: PayrollRunStatus): boolean {
  return TERMINAL_VALUES.has(status);
}
