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
 *
 * ## Late Payroll Adjustment Escalation
 * When a period is no longer eligible for a standard reopen because it is too
 * old, the result includes an `escalation` descriptor so integrators can route
 * the request to a late-adjustment review queue instead of silently failing.
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

/** Escalation route for late payroll adjustments */
export type LateAdjustmentEscalationRoute = "LATE_ADJUSTMENT_REVIEW" | "NONE";

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
  /** Whether to produce a late-adjustment escalation descriptor for TOO_OLD periods (default: true) */
  escalateLateAdjustments?: boolean;
  /** Maximum age in milliseconds for late-adjustment escalation (default: 365 days) */
  maxLateAdjustmentAgeMs?: number;
}

/**
 * Escalation descriptor for late payroll adjustments on reopen evaluation.
 *
 * Named distinctly from the `LateAdjustmentEscalation` type in `./types` to
 * avoid a conflicting re-export through the payroll barrel module.
 */
export interface LateAdjustmentReopenEscalation {
  /** Route the request should be sent to */
  route: LateAdjustmentEscalationRoute;
  /** Whether the period is within the late-adjustment escalation window */
  escalatable: boolean;
  /** Actionable guidance for the integrator */
  guidance: string;
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
  /** Late-adjustment escalation descriptor (present for PERIOD_TOO_OLD) */
  escalation?: LateAdjustmentReopenEscalation;
}

/** Default maximum period age: 90 days */
export const DEFAULT_MAX_PERIOD_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Default maximum age for late-adjustment escalation: 365 days */
export const DEFAULT_MAX_LATE_ADJUSTMENT_AGE_MS = 365 * 24 * 60 * 60 * 1000;

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
 * Builds the late-adjustment escalation descriptor for a period that is too old
 * for a standard reopen.
 */
function buildLateAdjustmentEscalation(
  ageMs: number,
  options: ReopenEligibilityOptions
): LateAdjustmentReopenEscalation {
  const enabled = options.escalateLateAdjustments !== false;
  const maxLateAge = options.maxLateAdjustmentAgeMs ?? DEFAULT_MAX_LATE_ADJUSTMENT_AGE_MS;

  if (!enabled) {
    return {
      route: "NONE",
      escalatable: false,
      guidance: "Late-adjustment escalation is disabled; a new payroll period must be used for corrections",
    };
  }

  if (ageMs > maxLateAge) {
    return {
      route: "NONE",
      escalatable: false,
      guidance: "Period is beyond the late-adjustment escalation window; record the correction in a current period",
    };
  }

  return {
    route: "LATE_ADJUSTMENT_REVIEW",
    escalatable: true,
    guidance: "Submit a late payroll adjustment request for manual review before any reopen",
  };
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

  // Check if too old; route to late-adjustment escalation when permitted
  if (period.closedAt) {
    const now = Date.now();
    const ageMs = now - period.closedAt;
    if (ageMs > maxAge) {
      const daysSince = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const escalation = buildLateAdjustmentEscalation(ageMs, options);
      const suffix =
        escalation.route === "LATE_ADJUSTMENT_REVIEW"
          ? "; route to late payroll adjustment review"
          : "";
      return {
        eligible: false,
        code: "PERIOD_TOO_OLD",
        message: `Period ${displayId} was closed ${daysSince} days ago and is no longer eligible for standard reopening${suffix}`,
        periodId: displayId,
        daysSinceClosure: daysSince,
        escalation,
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
 * Filters periods that should be routed to late-adjustment review
 *
 * @param periods - Array of payroll periods
 * @param options - Configuration options
 * @returns Periods whose evaluation carries a LATE_ADJUSTMENT_REVIEW escalation
 */
export function filterLateAdjustmentEscalations(
  periods: PayrollPeriod[],
  options: ReopenEligibilityOptions = {}
): { period: PayrollPeriod; result: ReopenEligibilityResult }[] {
  return evaluateBatchReopenEligibility(periods, options)
    .map((result, index) => ({ period: periods[index], result }))
    .filter(
      ({ result }) =>
        result.escalation?.route === "LATE_ADJUSTMENT_REVIEW" && result.escalation.escalatable
    );
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
  escalatableCount: number;
  reasonCounts: Record<string, number>;
} {
  const reasonCounts: Record<string, number> = {};

  for (const result of results) {
    reasonCounts[result.code] = (reasonCounts[result.code] ?? 0) + 1;
  }

  const eligibleCount = results.filter((r) => r.eligible).length;
  const escalatableCount = results.filter(
    (r) => r.escalation?.route === "LATE_ADJUSTMENT_REVIEW" && r.escalation.escalatable
  ).length;

  return {
    total: results.length,
    eligibleCount,
    ineligibleCount: results.length - eligibleCount,
    escalatableCount,
    reasonCounts,
  };
}
