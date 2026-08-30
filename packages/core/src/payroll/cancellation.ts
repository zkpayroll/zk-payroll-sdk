/**
 * Supported payroll cancellation reason codes, shared between the SDK and
 * any consuming dashboard so cancellation options aren't hard-coded
 * downstream.
 */

export type CancellationReasonCode =
  | "insufficient_funds"
  | "duplicate_run"
  | "employee_dispute"
  | "compliance_hold"
  | "schedule_error"
  | "other";

export interface CancellationReasonInfo {
  code: CancellationReasonCode;
  label: string;
  description: string;
}

export const CANCELLATION_REASONS: readonly CancellationReasonInfo[] = [
  {
    code: "insufficient_funds",
    label: "Insufficient funds",
    description: "The payroll treasury does not hold enough balance to fund this run.",
  },
  {
    code: "duplicate_run",
    label: "Duplicate run",
    description: "This run duplicates a payroll period already processed or scheduled.",
  },
  {
    code: "employee_dispute",
    label: "Employee dispute",
    description: "One or more employees have disputed amounts or eligibility for this run.",
  },
  {
    code: "compliance_hold",
    label: "Compliance hold",
    description: "The run is blocked pending a compliance or regulatory review.",
  },
  {
    code: "schedule_error",
    label: "Schedule error",
    description: "The run was created with an incorrect period or schedule configuration.",
  },
  {
    code: "other",
    label: "Other",
    description: "Reason not covered by the above; see accompanying notes.",
  },
];

const REASON_BY_CODE: ReadonlyMap<CancellationReasonCode, CancellationReasonInfo> = new Map(
  CANCELLATION_REASONS.map((reason) => [reason.code, reason]),
);

/** Human-readable label for a cancellation reason code. */
export function getCancellationReasonLabel(code: CancellationReasonCode): string {
  return REASON_BY_CODE.get(code)?.label ?? code;
}

/** Longer description for a cancellation reason code, for tooltips/help text. */
export function getCancellationReasonDescription(code: CancellationReasonCode): string {
  return REASON_BY_CODE.get(code)?.description ?? "";
}

/** Whether `code` is one of the SDK's supported cancellation reason codes. */
export function isSupportedCancellationReason(code: string): code is CancellationReasonCode {
  return REASON_BY_CODE.has(code as CancellationReasonCode);
}
