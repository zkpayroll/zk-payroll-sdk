import { ZkPayrollError } from "../core/errors";

/**
 * Thrown when an edit is attempted against a revision that has already
 * been approved. Names the approver and points the caller at the
 * supported recovery path (starting a new revision).
 */
export class RevisionEditBlockedError extends ZkPayrollError {
  constructor(
    public readonly revisionId: string,
    public readonly approvedBy: string,
    public readonly approvedAt: number
  ) {
    super(
      `Revision "${revisionId}" was approved by "${approvedBy}" and can no longer be edited. ` +
        `Create a new revision to make further changes.`,
      "REVISION_APPROVED_EDIT_BLOCKED",
      { revisionId, approvedBy, approvedAt }
    );
    this.name = "RevisionEditBlockedError";
  }
}

/**
 * Thrown when `approve()` is called on a revision that is already approved
 * without explicitly opting in via `{ allowReapproval: true }`. Guards
 * against accidental duplicate approvals.
 */
export class RevisionAlreadyApprovedError extends ZkPayrollError {
  constructor(
    public readonly revisionId: string,
    public readonly approvedBy: string,
    public readonly approvedAt: number
  ) {
    super(
      `Revision "${revisionId}" is already approved by "${approvedBy}". ` +
        `Pass { allowReapproval: true } to re-approve it intentionally.`,
      "REVISION_ALREADY_APPROVED",
      { revisionId, approvedBy, approvedAt }
    );
    this.name = "RevisionAlreadyApprovedError";
  }
}

/**
 * Thrown when required revision input (identifiers, approver) fails
 * validation before an operation can proceed.
 */
export class RevisionValidationError extends ZkPayrollError {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message, "REVISION_VALIDATION_FAILED", { field });
    this.name = "RevisionValidationError";
  }
}
