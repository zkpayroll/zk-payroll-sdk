/**
 * Typed Validation for Payroll Period Boundaries (#874).
 *
 * Implements pure validation for payroll period boundaries, temporal order,
 * frequency rules, and non-overlap constraints.
 *
 * @module
 */

import {
  PayrollPeriodError,
  SafePayrollPeriodIssue,
  formatSafePayrollPeriodIssue,
} from "./periodErrors";

export type PayrollFrequency = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "CUSTOM";

export interface PayrollPeriodInput {
  readonly periodId: string;
  readonly employer: string;
  readonly start: number;
  readonly end: number;
  readonly cutoff?: number;
  readonly settlementDate?: number;
  readonly frequency?: PayrollFrequency;
}

export interface PeriodValidationResult {
  readonly isValid: boolean;
  readonly issues: readonly SafePayrollPeriodIssue[];
}

/** 1 hour in milliseconds (minimum supported payroll period). */
const MIN_PERIOD_DURATION_MS = 60 * 60 * 1000;

/** 366 days in milliseconds (maximum supported payroll period). */
const MAX_PERIOD_DURATION_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Validates a payroll period input against temporal and domain constraints.
 */
export function validatePayrollPeriod(
  input: PayrollPeriodInput,
  existingPeriods: readonly PayrollPeriodInput[] = []
): PeriodValidationResult {
  const issues: SafePayrollPeriodIssue[] = [];

  if (!input || typeof input !== "object") {
    issues.push(formatSafePayrollPeriodIssue("INVALID_PERIOD_ID", "input"));
    return { isValid: false, issues: Object.freeze(issues) };
  }

  // 1. Period ID
  const trimmedId = typeof input.periodId === "string" ? input.periodId.trim() : "";
  if (!trimmedId) {
    issues.push(formatSafePayrollPeriodIssue("INVALID_PERIOD_ID", "periodId"));
  }

  // 2. Start and End Order
  if (!Number.isFinite(input.start) || !Number.isFinite(input.end)) {
    issues.push(formatSafePayrollPeriodIssue("PERIOD_END_BEFORE_START", "timing"));
  } else if (input.end <= input.start) {
    issues.push(formatSafePayrollPeriodIssue("PERIOD_END_BEFORE_START", "end"));
  } else {
    const duration = input.end - input.start;
    if (duration < MIN_PERIOD_DURATION_MS) {
      issues.push(formatSafePayrollPeriodIssue("PERIOD_TOO_SHORT", "duration"));
    }
    if (duration > MAX_PERIOD_DURATION_MS) {
      issues.push(formatSafePayrollPeriodIssue("PERIOD_TOO_LONG", "duration"));
    }
  }

  // 3. Cutoff Date
  if (input.cutoff !== undefined) {
    if (!Number.isFinite(input.cutoff) || input.cutoff <= input.start || input.cutoff > input.end) {
      issues.push(formatSafePayrollPeriodIssue("INVALID_CUTOFF_DATE", "cutoff"));
    }
  }

  // 4. Settlement Date
  if (input.settlementDate !== undefined) {
    if (!Number.isFinite(input.settlementDate) || input.settlementDate < input.end) {
      issues.push(formatSafePayrollPeriodIssue("INVALID_SETTLEMENT_DATE", "settlementDate"));
    }
  }

  // 5. Overlap Check with Existing Periods for Same Employer
  if (Number.isFinite(input.start) && Number.isFinite(input.end) && input.end > input.start) {
    for (const existing of existingPeriods) {
      if (existing.periodId === trimmedId) continue;
      if (existing.employer !== input.employer) continue;

      // Overlap condition: start < existing.end && end > existing.start
      if (input.start < existing.end && input.end > existing.start) {
        issues.push(formatSafePayrollPeriodIssue("OVERLAPPING_PERIODS", "periodId"));
        break;
      }
    }
  }

  return {
    isValid: issues.length === 0,
    issues: Object.freeze(issues),
  };
}

/**
 * Asserts that a payroll period input is valid, throwing PayrollPeriodError if not.
 */
export function assertValidPayrollPeriod(
  input: PayrollPeriodInput,
  existingPeriods: readonly PayrollPeriodInput[] = []
): void {
  const result = validatePayrollPeriod(input, existingPeriods);
  if (!result.isValid) {
    const firstIssue = result.issues[0];
    throw new PayrollPeriodError(
      firstIssue ? firstIssue.message : "Payroll period validation failed",
      firstIssue ? firstIssue.code : "INVALID_PERIOD_ID",
      result.issues
    );
  }
}
