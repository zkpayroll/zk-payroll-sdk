/**
 * Employee removal validation helper (Issue #371).
 *
 * Client-side check for whether an employee can be removed from a payroll
 * draft, based on the payroll's lifecycle status. Once a payroll is locked
 * or settled its contents are frozen on-chain, so a removal attempt against
 * it would fail at the contract — this catches that before the dashboard
 * even attempts the edit.
 *
 * Mirrors the reason-code/result shape used by `./walletRotation.ts` for
 * consistency with other employee-facing validation helpers.
 *
 * @module
 */

import type { PayrollStatus } from "../payroll/types";
import { EDITABLE_PAYROLL_STATUSES } from "../payroll/types";

// ── Reason codes ────────────────────────────────────────────────────────────

export const EmployeeRemovalReasonCode = {
  PAYROLL_LOCKED: "PAYROLL_LOCKED",
  PAYROLL_SETTLED: "PAYROLL_SETTLED",
  PAYROLL_CANCELLED: "PAYROLL_CANCELLED",
} as const;

export type EmployeeRemovalReasonCodeType =
  (typeof EmployeeRemovalReasonCode)[keyof typeof EmployeeRemovalReasonCode];

const REASON_DESCRIPTIONS: Record<EmployeeRemovalReasonCodeType, string> = {
  [EmployeeRemovalReasonCode.PAYROLL_LOCKED]:
    "This payroll is locked and awaiting settlement; its employee list can no longer be edited.",
  [EmployeeRemovalReasonCode.PAYROLL_SETTLED]:
    "This payroll has already been settled on-chain and its employee list is final.",
  [EmployeeRemovalReasonCode.PAYROLL_CANCELLED]:
    "This payroll was cancelled; there is nothing left to edit.",
};

export function getEmployeeRemovalReasonDescription(code: EmployeeRemovalReasonCodeType): string {
  return REASON_DESCRIPTIONS[code];
}

// ── Types ────────────────────────────────────────────────────────────────────

/** A blocked-removal finding, safe to render directly in the UI. */
export interface EmployeeRemovalBlockedReason {
  code: EmployeeRemovalReasonCodeType;
  message: string;
  payrollStatus: PayrollStatus;
}

/** Result of checking whether an employee may be removed from a payroll draft. */
export interface EmployeeRemovalCheckResult {
  employeeId: string;
  payrollStatus: PayrollStatus;
  /** `true` when the removal is allowed. */
  allowed: boolean;
  /** Present (and non-null) only when `allowed` is `false`. */
  blockedReason: EmployeeRemovalBlockedReason | null;
}

const STATUS_REASON_CODE: Partial<Record<PayrollStatus, EmployeeRemovalReasonCodeType>> = {
  locked: EmployeeRemovalReasonCode.PAYROLL_LOCKED,
  settled: EmployeeRemovalReasonCode.PAYROLL_SETTLED,
  cancelled: EmployeeRemovalReasonCode.PAYROLL_CANCELLED,
};

/**
 * Check whether an employee can be removed from a payroll draft.
 *
 * Removal is allowed only while the payroll is in an editable state (today,
 * just "draft" — see `EDITABLE_PAYROLL_STATUSES`). Any other status returns
 * a typed, UI-friendly blocked reason rather than `false` alone, so the
 * dashboard can explain *why* the action is unavailable.
 */
export function checkEmployeeRemoval(
  employeeId: string,
  payrollStatus: PayrollStatus,
): EmployeeRemovalCheckResult {
  if (EDITABLE_PAYROLL_STATUSES.includes(payrollStatus)) {
    return { employeeId, payrollStatus, allowed: true, blockedReason: null };
  }

  const code = STATUS_REASON_CODE[payrollStatus];
  // Every non-editable PayrollStatus has an entry in STATUS_REASON_CODE —
  // this fallback only guards against a status value from outside the
  // known union (e.g. loosely-typed API input).
  const resolvedCode = code ?? EmployeeRemovalReasonCode.PAYROLL_LOCKED;

  return {
    employeeId,
    payrollStatus,
    allowed: false,
    blockedReason: {
      code: resolvedCode,
      message: getEmployeeRemovalReasonDescription(resolvedCode),
      payrollStatus,
    },
  };
}
