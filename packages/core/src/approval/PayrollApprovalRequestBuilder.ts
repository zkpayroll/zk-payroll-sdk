import { maskIdentifier } from "./masking";
import type {
  ApprovalValidationIssue,
  ApprovalValidationResult,
  PayrollApprovalRequest,
} from "./types";

const MAX_MEMO_LENGTH = 128;
const MAX_METADATA_KEYS = 20;

/** Internal mutable view of the request while it is being built. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type DraftRequest = Partial<Mutable<PayrollApprovalRequest>>;

export class PayrollApprovalValidationError extends Error {
  public readonly code = "PAYROLL_APPROVAL_VALIDATION_FAILED";
  public readonly issues: ApprovalValidationIssue[];

  constructor(issues: ApprovalValidationIssue[]) {
    // Message contains only stable codes, never sensitive values.
    const codes = issues.map((i) => i.code).join(", ");
    super(`Approval request is invalid: ${codes}`);
    this.name = "PayrollApprovalValidationError";
    this.issues = issues;
  }
}

export class PayrollApprovalRequestBuilder {
  private request: DraftRequest = {};
  private seenRecipients = new Set<string>();
  private duplicateRecipient: string | undefined;

  withApprovalId(id: string): this {
    this.request.approvalId = id;
    return this;
  }

  withPayrollRunId(id: string): this {
    this.request.payrollRunId = id;
    return this;
  }

  withApproverId(id: string): this {
    this.request.approverId = id;
    return this;
  }

  /**
   * Registers a recipient. Calling this more than once with the same
   * identifier is treated as a duplicate and reported with a masked
   * identifier only.
   */
  withRecipientId(id: string): this {
    if (id && this.seenRecipients.has(id)) {
      this.duplicateRecipient = id;
    }
    if (id) this.seenRecipients.add(id);
    this.request.recipientId = id;
    return this;
  }

  withAmount(amount: bigint): this {
    this.request.amount = amount;
    return this;
  }

  withAsset(asset: string): this {
    this.request.asset = asset;
    return this;
  }

  withMemo(memo: string): this {
    this.request.memo = memo;
    return this;
  }

  withExpiresAt(timestamp: number): this {
    this.request.expiresAt = timestamp;
    return this;
  }

  withMetadata(metadata: Record<string, string>): this {
    this.request.metadata = metadata;
    return this;
  }

  validate(): ApprovalValidationResult {
    const errors: ApprovalValidationIssue[] = [];
    const warnings: ApprovalValidationIssue[] = [];

    if (!this.request.approvalId?.trim()) {
      errors.push({
        code: "MISSING_APPROVAL_ID",
        message: "Approval ID is required.",
        field: "approvalId",
      });
    }
    if (!this.request.payrollRunId?.trim()) {
      errors.push({
        code: "MISSING_PAYROLL_RUN_ID",
        message: "Payroll run ID is required.",
        field: "payrollRunId",
      });
    }
    if (!this.request.approverId?.trim()) {
      errors.push({
        code: "MISSING_APPROVER_ID",
        message: "Approver ID is required.",
        field: "approverId",
      });
    }
    if (!this.request.recipientId?.trim()) {
      errors.push({
        code: "MISSING_RECIPIENT_ID",
        message: "Recipient ID is required.",
        field: "recipientId",
      });
    }
    if (this.request.amount === undefined || this.request.amount <= 0n) {
      errors.push({
        code: "INVALID_AMOUNT",
        message: "Amount must be a positive integer.",
        field: "amount",
      });
    }
    if (!this.request.asset?.trim()) {
      errors.push({
        code: "MISSING_ASSET",
        message: "Asset is required.",
        field: "asset",
      });
    }
    if (
      this.request.expiresAt === undefined ||
      this.request.expiresAt <= Date.now()
    ) {
      errors.push({
        code: "INVALID_EXPIRY",
        message: "Expiry must be a future timestamp.",
        field: "expiresAt",
      });
    }

    if (this.duplicateRecipient) {
      errors.push({
        code: "DUPLICATE_RECIPIENT",
        message: `Recipient "${maskIdentifier(this.duplicateRecipient)}" appears more than once.`,
        field: "recipientId",
      });
    }

    if (this.request.memo && this.request.memo.length > MAX_MEMO_LENGTH) {
      warnings.push({
        code: "LONG_MEMO",
        message: `Memo exceeds recommended length of ${MAX_MEMO_LENGTH} characters.`,
        field: "memo",
      });
    }

    if (
      this.request.metadata &&
      Object.keys(this.request.metadata).length > MAX_METADATA_KEYS
    ) {
      warnings.push({
        code: "TOO_MANY_METADATA_KEYS",
        message: `Metadata has more than ${MAX_METADATA_KEYS} keys.`,
        field: "metadata",
      });
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  build(): PayrollApprovalRequest {
    const result = this.validate();
    if (!result.ok) {
      throw new PayrollApprovalValidationError(result.errors);
    }
    return { ...this.request } as PayrollApprovalRequest;
  }
}
