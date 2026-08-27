/**
 * Compliance hold types (#320).
 *
 * A compliance hold blocks payroll actions at one of four scopes -- an
 * entire employer, a specific pay period, a specific batch, or a single
 * employee -- until it is explicitly released by an authorized party.
 * Holds carry a closed set of `reasonCode`s rather than free text so that
 * dashboard and backend clients can render a status without ever needing
 * to display (or store) sensitive investigation details.
 */

/** The level at which a compliance hold applies. */
export type HoldScope = "employer" | "period" | "batch" | "employee";

/**
 * Lifecycle state of a hold.
 *
 * - `"active"`   -- currently blocks payroll actions in its scope.
 * - `"released"` -- was placed, then explicitly released; no longer blocks.
 * - `"unknown"`  -- status could not be determined (malformed/incomplete
 *   response, or hold record not found). Treated as blocking by
 *   {@link isPayrollActionBlocked} so callers fail closed rather than
 *   silently proceeding with payroll under an indeterminate hold.
 */
export type HoldState = "active" | "released" | "unknown";

/**
 * Closed set of safe, non-identifying reason codes for a hold. Using an
 * enumerated code (rather than free text) keeps hold status safe to log,
 * display, and pass across service boundaries without leaking case details.
 */
export type HoldReasonCode =
  | "KYC_REVIEW_PENDING"
  | "SANCTIONS_SCREENING"
  | "TAX_WITHHOLDING_DISCREPANCY"
  | "REGULATORY_INVESTIGATION"
  | "DUPLICATE_PAYMENT_SUSPECTED"
  | "MANUAL_REVIEW_REQUESTED"
  | "OTHER";

/** Identifies what a hold applies to: a scope plus the id within it. */
export interface HoldTarget {
  scope: HoldScope;
  /** Employer id, period id, batch id, or employee id, depending on `scope`. */
  id: string;
}

/** A compliance hold, as returned by a status query. */
export interface ComplianceHold {
  holdId: string;
  target: HoldTarget;
  state: HoldState;
  reasonCode: HoldReasonCode;
  /** Optional free-text note. Never used to drive blocking logic. */
  note?: string;
  placedBy: string;
  placedAt: number;
  releasedBy?: string;
  releasedAt?: number;
  releaseReason?: string;
}

/** Input for placing a new compliance hold. */
export interface PlaceHoldRequest {
  target: HoldTarget;
  reasonCode: HoldReasonCode;
  note?: string;
  placedBy: string;
}

/** Input for releasing an existing compliance hold. */
export interface ReleaseHoldRequest {
  holdId: string;
  releasedBy: string;
  /** Proof that `releasedBy` is authorized to release this hold. */
  authorizationToken: string;
  releaseReason?: string;
}

/** The scopes a specific payroll action touches, used to check for blocking holds. */
export interface PayrollActionScope {
  employer: string;
  period?: string;
  batch?: string;
  employee?: string;
}

/** Result of checking whether a payroll action is blocked by a compliance hold. */
export interface HoldCheckResult {
  blocked: boolean;
  /** The hold responsible for blocking, when `blocked` is true. */
  hold?: ComplianceHold;
  /** Human-readable explanation, safe to show a dashboard user. */
  explanation: string;
}
