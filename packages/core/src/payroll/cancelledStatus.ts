/**
 * Cancelled batch status helper.
 *
 * Converts cancelled payroll batch/run metadata into a safe, UI-ready
 * label and a concrete next-step message, so cancellation status doesn't
 * get reimplemented (and drift) across every screen that shows it.
 *
 * Complements `getPayrollRunStatusLabel("cancelled")` in `../status`, which
 * only returns a generic static "Cancelled" badge — this helper looks at
 * *why* a batch was cancelled and *who* cancelled it to produce a specific,
 * actionable message instead.
 */

/** Known reasons a payroll batch/run may have been cancelled. */
export type CancellationReason =
  | "admin_cancelled"
  | "insufficient_funds"
  | "employee_data_changed"
  | "compliance_hold"
  | "approval_expired"
  | "duplicate_submission"
  | "unknown";

/** Who initiated the cancellation. */
export type CancelledBy = "admin" | "system" | "compliance" | "unknown";

/** Raw metadata describing a cancelled payroll batch/run. */
export interface CancelledBatchMetadata {
  batchId: string;
  reason?: CancellationReason;
  cancelledBy?: CancelledBy;
  /** Epoch ms the cancellation occurred. */
  cancelledAt?: number;
  /** Free-text note from the canceller (e.g. admin's reason field). Never
   * included verbatim in the output label/message — see redaction note
   * on `toSafeCancelledStatus`. */
  note?: string;
}

/** UI-safe, redaction-conscious cancelled-status output. */
export interface CancelledBatchStatus {
  batchId: string;
  /** Short label for badges and compact displays. */
  label: string;
  /** Concrete, actionable next-step message for the viewer. */
  nextStep: string;
  /** Suggested badge variant, matching status.ts's convention. */
  variant: "default" | "success" | "warning" | "danger" | "info";
  /** Whether this cancellation can be reversed/resubmitted by an admin. */
  isRecoverable: boolean;
  /** ISO 8601 timestamp, if `cancelledAt` was provided. */
  cancelledAtIso?: string;
}

const REASON_META: Record<
  CancellationReason,
  {
    label: string;
    nextStep: string;
    variant: CancelledBatchStatus["variant"];
    isRecoverable: boolean;
  }
> = {
  admin_cancelled: {
    label: "Cancelled by Admin",
    nextStep: "This batch was manually cancelled. Create a new batch to resubmit these payments.",
    variant: "default",
    isRecoverable: true,
  },
  insufficient_funds: {
    label: "Cancelled — Insufficient Funds",
    nextStep: "Top up the treasury balance, then resubmit this batch.",
    variant: "danger",
    isRecoverable: true,
  },
  employee_data_changed: {
    label: "Cancelled — Employee Data Changed",
    nextStep:
      "One or more employee records changed after this batch was created. Review employee data and create a new batch.",
    variant: "warning",
    isRecoverable: true,
  },
  compliance_hold: {
    label: "Cancelled — Compliance Hold",
    nextStep:
      "This batch was blocked by a compliance review. Contact your compliance team for next steps.",
    variant: "danger",
    isRecoverable: false,
  },
  approval_expired: {
    label: "Cancelled — Approval Expired",
    nextStep:
      "The approval window closed before enough signers approved. Create a new batch to try again.",
    variant: "warning",
    isRecoverable: true,
  },
  duplicate_submission: {
    label: "Cancelled — Duplicate",
    nextStep:
      "This batch duplicated an already-processed submission and was automatically cancelled. No action needed.",
    variant: "info",
    isRecoverable: false,
  },
  unknown: {
    label: "Cancelled",
    nextStep: "This batch was cancelled. Contact support if you're unsure why.",
    variant: "default",
    isRecoverable: true,
  },
};

/**
 * Converts cancelled batch metadata into a safe label and next-step
 * message.
 *
 * Redaction note: the caller-supplied `note` field is intentionally never
 * echoed into `label` or `nextStep` — free-text cancellation notes can
 * contain sensitive context (e.g. a specific employee's name or amount)
 * that shouldn't be surfaced through a generic status helper reused across
 * screens with different audiences. Callers that need to show the raw
 * note should read `metadata.note` directly in a context where that's
 * appropriate, not rely on this helper to carry it.
 *
 * @param metadata - Raw cancelled batch metadata.
 * @param now - Current time in epoch ms, used only if `cancelledAt` needs
 *   a relative-time consumer downstream (kept simple here — this helper
 *   returns an absolute ISO string, not a relative one).
 */
export function toSafeCancelledStatus(metadata: CancelledBatchMetadata): CancelledBatchStatus {
  const reason = metadata.reason ?? "unknown";
  const meta = REASON_META[reason];

  return {
    batchId: metadata.batchId,
    label: meta.label,
    nextStep: meta.nextStep,
    variant: meta.variant,
    isRecoverable: meta.isRecoverable,
    cancelledAtIso:
      metadata.cancelledAt !== undefined ? new Date(metadata.cancelledAt).toISOString() : undefined,
  };
}

/**
 * Returns a short human-readable "who cancelled this" attribution string,
 * safe for display (never includes free-text notes or specific admin
 * identities — only the coarse `cancelledBy` category).
 *
 * @example
 * ```ts
 * describeCancelledBy({ batchId: "b1", cancelledBy: "admin" }); // "Cancelled by an admin"
 * describeCancelledBy({ batchId: "b1" }); // "Cancelled" (cancelledBy unknown)
 * ```
 */
export function describeCancelledBy(metadata: Pick<CancelledBatchMetadata, "cancelledBy">): string {
  switch (metadata.cancelledBy) {
    case "admin":
      return "Cancelled by an admin";
    case "system":
      return "Cancelled automatically by the system";
    case "compliance":
      return "Cancelled by compliance review";
    default:
      return "Cancelled";
  }
}
