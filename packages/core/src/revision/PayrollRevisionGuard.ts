import { DraftBuilder } from "../draft/DraftBuilder";
import type { PayrollDraft } from "../draft/types";
import {
  RevisionAlreadyApprovedError,
  RevisionEditBlockedError,
  RevisionValidationError,
} from "./errors";
import {
  ApproveRevisionOptions,
  PayrollRevisionSnapshot,
  RevisionApproval,
  RevisionStatus,
  RevisionStatusType,
} from "./types";

/**
 * Wraps a `PayrollDraft` with an approval lifecycle: a revision is freely
 * editable while in `DRAFT` status, and becomes immutable once `approve()`
 * is called — matching the draft/approval vocabulary already used by
 * `DraftBuilder` and `PayrollApprovalRequestBuilder`.
 *
 * Design goals:
 * - Unapproved revisions remain freely editable (`edit`, `replaceDraft`).
 * - Approved revisions reject edits with an actionable error naming the
 *   approver and pointing at the supported recovery path (a new revision).
 * - Re-approving an already-approved revision is rejected unless the
 *   caller explicitly opts in via `{ allowReapproval: true }`.
 *
 * @example
 * const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-1", draft);
 * guard.edit((b) => b.add({ recipientId: "GABC...", amount: "1000", asset: "native" }));
 * guard.approve("GAPPROVER...");
 * guard.edit((b) => b.add({ recipientId: "GDEF...", amount: "500", asset: "native" }));
 * // throws RevisionEditBlockedError
 */
export class PayrollRevisionGuard {
  private draft: PayrollDraft;
  private status: RevisionStatusType = RevisionStatus.DRAFT;
  private approval: RevisionApproval | undefined;
  private version = 1;

  constructor(
    public readonly payrollRunId: string,
    public readonly revisionId: string,
    initialDraft: PayrollDraft
  ) {
    if (!payrollRunId?.trim()) {
      throw new RevisionValidationError("Payroll run ID is required.", "payrollRunId");
    }
    if (!revisionId?.trim()) {
      throw new RevisionValidationError("Revision ID is required.", "revisionId");
    }
    if (!initialDraft) {
      throw new RevisionValidationError("An initial draft is required.", "draft");
    }
    this.draft = initialDraft;
  }

  /** Creates a new, unapproved revision wrapping the given draft. */
  static fromDraft(
    payrollRunId: string,
    revisionId: string,
    draft: PayrollDraft
  ): PayrollRevisionGuard {
    return new PayrollRevisionGuard(payrollRunId, revisionId, draft);
  }

  get isApproved(): boolean {
    return this.status === RevisionStatus.APPROVED;
  }

  getStatus(): RevisionStatusType {
    return this.status;
  }

  getVersion(): number {
    return this.version;
  }

  getApproval(): RevisionApproval | undefined {
    return this.approval ? { ...this.approval } : undefined;
  }

  /** Returns a defensive copy of the current draft. */
  getDraft(): PayrollDraft {
    return { ...this.draft, entries: this.draft.entries.map((entry) => ({ ...entry })) };
  }

  /**
   * Applies an edit via a `DraftBuilder` mutator and stores the rebuilt
   * draft. Unapproved revisions accept any number of edits.
   *
   * @throws {RevisionEditBlockedError} if the revision is approved.
   * @throws {DraftValidationFailedError} if the mutated draft is invalid.
   */
  edit(mutator: (builder: DraftBuilder) => DraftBuilder): PayrollDraft {
    this.assertEditable();
    const builder = mutator(new DraftBuilder(this.draft));
    this.draft = builder.build();
    this.version += 1;
    return this.getDraft();
  }

  /**
   * Replaces the current draft wholesale.
   *
   * @throws {RevisionEditBlockedError} if the revision is approved.
   */
  replaceDraft(next: PayrollDraft): PayrollDraft {
    this.assertEditable();
    this.draft = next;
    this.version += 1;
    return this.getDraft();
  }

  /**
   * Approves the revision, freezing it against further edits.
   *
   * @throws {RevisionValidationError} if `approverId` is missing.
   * @throws {RevisionAlreadyApprovedError} if the revision is already
   *         approved and `options.allowReapproval` is not `true`.
   */
  approve(approverId: string, options: ApproveRevisionOptions = {}): RevisionApproval {
    if (!approverId?.trim()) {
      throw new RevisionValidationError(
        "Approver ID is required to approve a revision.",
        "approverId"
      );
    }

    if (this.isApproved && !options.allowReapproval) {
      const current = this.approval as RevisionApproval;
      throw new RevisionAlreadyApprovedError(
        this.revisionId,
        current.approverId,
        current.approvedAt
      );
    }

    this.approval = { approverId, approvedAt: Date.now() };
    this.status = RevisionStatus.APPROVED;
    return { ...this.approval };
  }

  /** Returns an immutable snapshot suitable for persistence or serialization. */
  toSnapshot(): PayrollRevisionSnapshot {
    return {
      revisionId: this.revisionId,
      payrollRunId: this.payrollRunId,
      status: this.status,
      version: this.version,
      draft: this.getDraft(),
      approval: this.getApproval(),
    };
  }

  private assertEditable(): void {
    if (this.isApproved) {
      const current = this.approval as RevisionApproval;
      throw new RevisionEditBlockedError(this.revisionId, current.approverId, current.approvedAt);
    }
  }
}
