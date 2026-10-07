import type { PayrollDraft } from "../draft/types";

/**
 * Lifecycle status of a payroll revision.
 *
 * A revision starts as `DRAFT` and can be freely edited. Once `approve()`
 * is called it moves to `APPROVED`, after which edits are rejected — the
 * caller must start a new revision to make further changes.
 */
export const RevisionStatus = {
  DRAFT: "DRAFT",
  APPROVED: "APPROVED",
} as const;

export type RevisionStatusType = (typeof RevisionStatus)[keyof typeof RevisionStatus];

/** Record of who approved a revision and when. */
export interface RevisionApproval {
  readonly approverId: string;
  /** Unix timestamp in milliseconds. */
  readonly approvedAt: number;
}

/** Options accepted by {@link PayrollRevisionGuard.approve}. */
export interface ApproveRevisionOptions {
  /**
   * When `true`, allows re-approving a revision that is already approved
   * (e.g. re-signing after an authorized metadata-only change). Defaults
   * to `false` so accidental double-approval is rejected.
   */
  allowReapproval?: boolean;
}

/** Immutable, serializable snapshot of a revision's current state. */
export interface PayrollRevisionSnapshot {
  readonly revisionId: string;
  readonly payrollRunId: string;
  readonly status: RevisionStatusType;
  /** Increments on every accepted edit; stable across approval. */
  readonly version: number;
  readonly draft: PayrollDraft;
  readonly approval?: RevisionApproval;
}
