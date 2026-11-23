/**
 * Payroll lifecycle status (Issue #371).
 *
 * - "draft": still being edited; not yet submitted for lock.
 * - "locked": submitted and awaiting/undergoing on-chain settlement;
 *   contents are frozen.
 * - "settled": settlement completed on-chain.
 * - "cancelled": abandoned before settlement.
 */
export type PayrollStatus = "draft" | "locked" | "settled" | "cancelled";
export type PayrollPeriodStatus = PayrollStatus;

export const EDITABLE_PAYROLL_STATUSES: readonly PayrollStatus[] = ["draft"];

/**
 * Late payroll adjustment escalation levels.
 *
 * Adjustments submitted after a payroll has been locked are escalated
 * according to how late they arrive relative to settlement.
 *
 * - "none": no escalation required (adjustment applied to a draft).
 * - "standard": late adjustment requiring a standard reviewer sign-off.
 * - "urgent": late adjustment requiring an administrator sign-off.
 * - "blocked": adjustment cannot be applied (payroll already settled or cancelled).
 */
export type LateAdjustmentEscalationLevel =
  | "none"
  | "standard"
  | "urgent"
  | "blocked";

export const LATE_ADJUSTMENT_ESCALATION_LEVELS: readonly LateAdjustmentEscalationLevel[] =
  ["none", "standard", "urgent", "blocked"];

/**
 * A request to adjust payroll after it may already have been locked.
 */
export interface LateAdjustmentRequest {
  /** Identifier of the payroll being adjusted. */
  payrollId: string;
  /** Current status of the payroll at the time the adjustment is submitted. */
  payrollStatus: PayrollStatus;
  /** Identifier of the contributor/employee the adjustment applies to. */
  recipientId: string;
  /** Signed adjustment amount in base units (may be negative). */
  amount: bigint;
  /** Human-readable reason; must be non-empty. */
  reason: string;
}

/**
 * Result of evaluating a late adjustment request.
 */
export interface LateAdjustmentEscalationResult {
  level: LateAdjustmentEscalationLevel;
  requiresApproval: boolean;
  /** Present when level is "blocked"; actionable explanation for integrators. */
  error?: string;
}

/**
 * Named alias for the escalation outcome of a late adjustment evaluation.
 * Equivalent to {@link LateAdjustmentEscalationResult}.
 */
export type LateAdjustmentEscalation = LateAdjustmentEscalationResult;
