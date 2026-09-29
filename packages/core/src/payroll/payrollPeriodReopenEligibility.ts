/**
 * Payroll Period Reopen Eligibility Helper
 *
 * Evaluates whether a completed payroll period is eligible to be reopened for
 * corrections or amendments. Checks period status, timing constraints, and
 * operational prerequisites to prevent unsafe reopens.
 *
 * ## Privacy & Security Guarantees
 * - No payroll values (amounts, salaries, employee counts) are exposed in messages
 * - Period identifiers are masked by default in user-facing messages
 * - Only stable codes and actionable messages are returned
 */

/** Codes indicating why a period cannot be reopened */
export type ReopenEligibilityCode =
  | "ELIGIBLE"
  | "PERIOD_NOT_FOUND"
  | "PERIOD_NOT_CLOSED"
  | "PERIOD_TOO_OLD"
  | "PENDING_CORRECTIONS"
  | "SETTLEMENT_IN_PROGRESS"
  | "ARCHIVE_LOCKED"
  | "INVALID_PERIOD_ID";

/** Payroll period information needed for reopen eligibility evaluation */
export interface PayrollPeriod {
  /** Unique period identifier (e.g., "period-2026-01") */
  periodId: string;
  /** Status of the period (e.g., "open", "closed", "archived") */
  status: string;
  /** Timestamp when period was closed (Unix milliseconds) */
  closedAt?: number;
  /** Whether there are pending corrections for this period */
  hasPendingCorrections?: boolean;
  /** Whether settlement is currently in progress */
  settlementInProgress?: boolean;
  /** Whether period is locked for archival */
  archiveLocked?: boolean;
}

/** Configuration for reopen eligibility evaluation */
export interface ReopenEligibilityOptions {
  /** Maximum age in milliseconds for a period to be reopenable (default: 90 days) */
  maxPeriodAgeMs?: number;
  /** Whether to allow reopening if corrections are pending (default: false) */
  allowWithPendingCorrections?: boolean;
  /** Mask period IDs in user-facing messages (default: true) */
  redactPeriodId?: boolean;
}

/** Evaluation result */
export interface ReopenEligibilityResult {
  /** Whether the period is eligible for reopening */
  eligible: boolean;
  /** Stable code indicating status or reason for ineligibility */
  code: ReopenEligibilityCode;
  /** User-facing message (safe to display) */
  message: string;
  /** Period identifier (masked by default) */
  periodId: string;
  /** Days since the period was closed */
  daysSinceClosure?: number;
}

/** Default maximum period age: 90 days */
export const DEFAULT_MAX_PERIOD_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Masks a period ID for safe display in logs and user-facing messages
 */
function maskPeriodId(id: string): string {
  if (!id || id.trim().length === 0) return "[UNKNOWN_PERIOD]";
  const clean = id.trim();
  if (clean.length <= 6) return "[PERIOD_REDACTED]";
  return `${clean.slice(0, 3)}...${clean.slice(-3)}`;
}

/**
 * Evaluates whether a payroll period is eligible to be reopened
 *
 * @param period - The payroll period to evaluate
 * @param options - Configuration options
 * @returns Eligibility evaluation result
 */
export function isPayrollPeriodReopenEligible(
  period: PayrollPeriod,
  options: ReopenEligibilityOptions = {}
): ReopenEligibilityResult {
  const maxAge = options.maxPeriodAgeMs ?? DEFAULT_MAX_PERIOD_AGE_MS;
  const redact = options.redactPeriodId !== false;
  const displayId = redact ? maskPeriodId(period.periodId) : period.periodId;

  // Validate period ID
  if (!period.periodId || typeof period.periodId !== "string" || period.periodId.trim() === "") {
    return {
      eligible: false,
      code: "INVALID_PERIOD_ID",
      message: "Period identifier is missing or invalid",
      periodId: displayId,
    };
  }

  // Check if period exists (status should be set)
  if (!period.status) {
    return {
      eligible: false,
      code: "PERIOD_NOT_FOUND",
      message: `Period ${displayId} was not found in the system`,
      periodId: displayId,
    };
  }

  // Period must be closed to reopen
  if (period.status !== "closed" && period.status !== "archived") {
    return {
      eligible: false,
      code: "PERIOD_NOT_CLOSED",
      message: `Period ${displayId} is still open and does not need reopening`,
      periodId: displayId,
    };
  }

  // Check if too old
  if (period.closedAt) {
    const now = Date.now();
    const ageMs = now - period.closedAt;
    if (ageMs > maxAge) {
      const daysSince = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      return {
        eligible: false,
        code: "PERIOD_TOO_OLD",
        message: `Period ${displayId} was closed ${daysSince} days ago and is no longer eligible for reopening`,
        periodId: displayId,
        daysSinceClosure: daysSince,
      };
    }
  }

  // Check for pending corrections
  if (period.hasPendingCorrections && !options.allowWithPendingCorrections) {
    return {
      eligible: false,
      code: "PENDING_CORRECTIONS",
      message: `Period ${displayId} has pending corrections that must be resolved before reopening`,
      periodId: displayId,
    };
  }

  // Check if settlement is in progress
  if (period.settlementInProgress) {
    return {
      eligible: false,
      code: "SETTLEMENT_IN_PROGRESS",
      message: `Settlement is currently in progress for period ${displayId}; wait for completion before reopening`,
      periodId: displayId,
    };
  }

  // Check if archived period is locked
  if (period.status === "archived" && period.archiveLocked) {
    return {
      eligible: false,
      code: "ARCHIVE_LOCKED",
      message: `Period ${displayId} is archived and locked; contact support to unlock before reopening`,
      periodId: displayId,
    };
  }

  // All checks passed
  return {
    eligible: true,
    code: "ELIGIBLE",
    message: `Period ${displayId} is eligible for reopening`,
    periodId: displayId,
  };
}

/**
 * Evaluates a batch of periods for reopen eligibility
 *
 * @param periods - Array of payroll periods to evaluate
 * @param options - Configuration options
 * @returns Array of eligibility results
 */
export function evaluateBatchReopenEligibility(
  periods: PayrollPeriod[],
  options: ReopenEligibilityOptions = {}
): ReopenEligibilityResult[] {
  return periods.map((period) => isPayrollPeriodReopenEligible(period, options));
}

/**
 * Filters eligible periods from a batch
 *
 * @param periods - Array of payroll periods
 * @param options - Configuration options
 * @returns Array of eligible periods with their evaluation results
 */
export function filterEligibleReopenPeriods(
  periods: PayrollPeriod[],
  options: ReopenEligibilityOptions = {}
): { period: PayrollPeriod; result: ReopenEligibilityResult }[] {
  return evaluateBatchReopenEligibility(periods, options)
    .map((result, index) => ({ period: periods[index], result }))
    .filter(({ result }) => result.eligible);
}

/**
 * Summarizes reopen eligibility results for multiple periods
 *
 * @param results - Array of eligibility results
 * @returns Summary statistics
 */
export function summarizeReopenEligibility(results: ReopenEligibilityResult[]): {
  total: number;
  eligibleCount: number;
  ineligibleCount: number;
  reasonCounts: Record<string, number>;
} {
  const reasonCounts: Record<string, number> = {};

  for (const result of results) {
    reasonCounts[result.code] = (reasonCounts[result.code] ?? 0) + 1;
  }

  const eligibleCount = results.filter((r) => r.eligible).length;

  return {
    total: results.length,
    eligibleCount,
    ineligibleCount: results.length - eligibleCount,
    reasonCounts,
  };
}
