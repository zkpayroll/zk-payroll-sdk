import type { EmployeeStatus } from "./lifecycle";
import type { ComplianceHold } from "../compliance/types";

/**
 * Categorical eligibility status for an employee's next payroll run.
 *
 * - `eligible`    -- active, with no blocking compliance hold. Safe to include
 *   in a payroll run.
 * - `conditional` -- active and not currently blocked, but there is a
 *   released compliance hold on record for this employee. Advisory only --
 *   the employee can be paid, but a dashboard should surface the history.
 * - `pending`     -- blocked, but only by a condition expected to resolve
 *   without a policy decision (e.g. a compliance hold whose status could not
 *   be determined from the last query). No data correction is required.
 * - `ineligible`  -- blocked by a condition that requires a data fix or an
 *   explicit policy decision before the employee can be paid (suspended,
 *   offboarded, or an actively enforced compliance hold).
 */
export type EligibilityStatus = "eligible" | "conditional" | "pending" | "ineligible";

/**
 * Closed set of reason codes explaining an {@link EligibilityStatus}. Using a
 * closed set (rather than free text) keeps eligibility results safe to log,
 * display, and pass across service boundaries, matching the convention used
 * by {@link HoldReasonCode} in the compliance module.
 */
export type EligibilityReasonCode =
  | "EMPLOYEE_ACTIVE"
  | "EMPLOYEE_SUSPENDED"
  | "EMPLOYEE_OFFBOARDED"
  | "COMPLIANCE_HOLD_ACTIVE"
  | "COMPLIANCE_HOLD_STATUS_UNKNOWN"
  | "COMPLIANCE_HOLD_RELEASED";

/** A single reason contributing to an employee's eligibility status. */
export interface EligibilityReason {
  code: EligibilityReasonCode;
  /** Human-readable explanation, safe to show a dashboard user. */
  message: string;
}

/** Input to {@link evaluateEmployeeEligibilityStatus}. */
export interface EmployeeEligibilityInput {
  /** Stellar address of the employee being evaluated. */
  employeeAddress: string;
  /** The employee's current lifecycle status. */
  status: EmployeeStatus;
  /**
   * Compliance holds to check against the employee's scope. Optional --
   * omit when the caller has no compliance hold data available.
   * Providing this requires also providing `employerId`.
   */
  complianceHolds?: readonly ComplianceHold[];
  /**
   * Employer id used to scope the compliance hold check (an employer-wide
   * hold blocks every employee underneath it). Required whenever
   * `complianceHolds` is provided.
   */
  employerId?: string;
}

/** Result of evaluating an employee's payroll eligibility status. */
export interface EmployeeEligibilityStatusResult {
  employeeAddress: string;
  status: EligibilityStatus;
  /** All reasons contributing to the status, most significant first. */
  reasons: EligibilityReason[];
}

/** Human-readable label and description for each eligibility status. */
export const ELIGIBILITY_STATUS_LABELS: Record<
  EligibilityStatus,
  { label: string; description: string }
> = {
  eligible: {
    label: "Eligible",
    description: "Employee is active with no blocking compliance hold and can be paid.",
  },
  conditional: {
    label: "Conditional",
    description:
      "Employee can be paid, but has a released compliance hold on record worth reviewing.",
  },
  pending: {
    label: "Pending",
    description:
      "Employee is not currently eligible, but the block is expected to resolve without a policy decision (e.g. an indeterminate hold status).",
  },
  ineligible: {
    label: "Ineligible",
    description:
      "Employee is blocked by a condition that requires a data fix or a policy decision (suspension, offboarding, or an active compliance hold).",
  },
};

/** Returns the human-readable label and description for an eligibility status. */
export function describeEligibilityStatus(status: EligibilityStatus): {
  label: string;
  description: string;
} {
  return ELIGIBILITY_STATUS_LABELS[status];
}
