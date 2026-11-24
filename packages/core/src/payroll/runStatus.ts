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

/**
 * Allowed run-status transitions. A run is scheduled before it can execute,
 * and terminal statuses (executed, cancelled, failed) have no outgoing
 * transitions, so a finished run cannot be reopened.
 */
export const PAYROLL_RUN_STATUS_TRANSITIONS: Readonly<
  Record<PayrollRunStatus, readonly PayrollRunStatus[]>
> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["executed", "failed", "cancelled"],
  executed: [],
  cancelled: [],
  failed: [],
};

export type PayrollRunStatusTransitionErrorCode =
  | "MISSING_STATUS"
  | "UNKNOWN_STATUS"
  | "INVALID_TRANSITION";

/**
 * Thrown when a run status change is not allowed. Only normalized, known
 * status names are attached; raw input values are never echoed.
 */
export class PayrollRunStatusTransitionError extends Error {
  readonly code: PayrollRunStatusTransitionErrorCode;
  readonly from?: PayrollRunStatus;
  readonly to?: PayrollRunStatus;

  constructor(
    code: PayrollRunStatusTransitionErrorCode,
    message: string,
    details: { from?: PayrollRunStatus; to?: PayrollRunStatus } = {}
  ) {
    super(message);
    this.name = "PayrollRunStatusTransitionError";
    this.code = code;
    this.from = details.from;
    this.to = details.to;
  }
}

/** Returns the statuses a run in `status` may move to; empty for terminal statuses. */
export function getAllowedPayrollRunStatusTransitions(
  status: PayrollRunStatus
): readonly PayrollRunStatus[] {
  return PAYROLL_RUN_STATUS_TRANSITIONS[status];
}

/**
 * Returns true when a run may move from `from` to `to`. Both values are
 * normalized like {@link parsePayrollRunStatus}; unknown or missing values
 * return false rather than throwing.
 */
export function canTransitionPayrollRunStatus(from: unknown, to: unknown): boolean {
  const source = parsePayrollRunStatus(from);
  const target = parsePayrollRunStatus(to);
  if (!source.ok || !target.ok) {
    return false;
  }
  return PAYROLL_RUN_STATUS_TRANSITIONS[source.status].includes(target.status);
}

/**
 * Throws {@link PayrollRunStatusTransitionError} unless a run may move from
 * `from` to `to`.
 */
export function assertPayrollRunStatusTransition(from: unknown, to: unknown): void {
  const source = parsePayrollRunStatus(from);
  if (!source.ok) {
    throw new PayrollRunStatusTransitionError(source.code, source.message);
  }
  const target = parsePayrollRunStatus(to);
  if (!target.ok) {
    throw new PayrollRunStatusTransitionError(target.code, target.message);
  }
  if (!PAYROLL_RUN_STATUS_TRANSITIONS[source.status].includes(target.status)) {
    throw new PayrollRunStatusTransitionError(
      "INVALID_TRANSITION",
      `Payroll run cannot move from ${source.status} to ${target.status}.`,
      { from: source.status, to: target.status }
    );
  }
}
