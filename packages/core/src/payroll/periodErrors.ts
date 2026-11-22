/**
 * Safe Error Types for Payroll Period Boundaries (#875).
 *
 * Implements structured, privacy-preserving errors for payroll period
 * configuration, temporal boundary checks, and state transitions.
 *
 * @module
 */

export type PayrollPeriodErrorCode =
  | "INVALID_PERIOD_ID"
  | "PERIOD_END_BEFORE_START"
  | "PERIOD_TOO_SHORT"
  | "PERIOD_TOO_LONG"
  | "INVALID_CUTOFF_DATE"
  | "INVALID_SETTLEMENT_DATE"
  | "OVERLAPPING_PERIODS"
  | "PERIOD_ALREADY_CLOSED"
  | "PERIOD_LOCKED"
  | "PERIOD_NOT_FOUND"
  | "TAMPERED_PERIOD_HASH";

export interface SafePayrollPeriodIssue {
  readonly code: PayrollPeriodErrorCode;
  readonly field: string;
  readonly message: string;
}

export class PayrollPeriodError extends Error {
  readonly code: PayrollPeriodErrorCode;
  readonly issues: readonly SafePayrollPeriodIssue[];

  constructor(
    message: string,
    code: PayrollPeriodErrorCode,
    issues: readonly SafePayrollPeriodIssue[] = []
  ) {
    super(message);
    this.name = "PayrollPeriodError";
    this.code = code;
    this.issues = Object.freeze([...issues]);
    Object.setPrototypeOf(this, PayrollPeriodError.prototype);
  }
}

export function formatSafePayrollPeriodIssue(
  code: PayrollPeriodErrorCode,
  field: string
): SafePayrollPeriodIssue {
  const safeMessages: Record<PayrollPeriodErrorCode, string> = {
    INVALID_PERIOD_ID: "Payroll period identifier must be a non-empty alphanumeric string",
    PERIOD_END_BEFORE_START: "Payroll period end timestamp must be strictly after start timestamp",
    PERIOD_TOO_SHORT: "Payroll period duration is below minimum threshold (1 hour)",
    PERIOD_TOO_LONG: "Payroll period duration exceeds maximum supported threshold (366 days)",
    INVALID_CUTOFF_DATE: "Cutoff date must fall strictly between period start and period end",
    INVALID_SETTLEMENT_DATE: "Settlement date must be equal to or after period end",
    OVERLAPPING_PERIODS: "Proposed payroll period overlaps with an existing period for this employer",
    PERIOD_ALREADY_CLOSED: "The payroll period is closed and cannot receive additional adjustments",
    PERIOD_LOCKED: "The payroll period is currently locked during active disbursement execution",
    PERIOD_NOT_FOUND: "No payroll period matching the specified identifier exists",
    TAMPERED_PERIOD_HASH: "Period state integrity verification failed; state tampering detected",
  };

  return {
    code,
    field,
    message: safeMessages[code] || "Payroll period operation failed validation",
  };
}
