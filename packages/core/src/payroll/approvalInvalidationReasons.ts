export const ApprovalInvalidationReasonCode = {
  DRAFT_MODIFIED: "APPROVAL_INVALIDATED_MODIFICATION",
  QUORUM_CHANGED: "APPROVAL_INVALIDATED_QUORUM",
  APPROVAL_EXPIRED: "APPROVAL_INVALIDATED_EXPIRED",
  REVISION_SUPERSEDED: "APPROVAL_INVALIDATED_SUPERSEDED",
  TOTAL_AMOUNT_CHANGED: "APPROVAL_INVALIDATED_TOTAL_AMOUNT_CHANGED",
  ASSET_CHANGED: "APPROVAL_INVALIDATED_ASSET_CHANGED",
  SCHEDULE_CHANGED: "APPROVAL_INVALIDATED_SCHEDULE_CHANGED",
  RECIPIENTS_CHANGED: "APPROVAL_INVALIDATED_RECIPIENTS_CHANGED",
  POLICY_CHANGED: "APPROVAL_INVALIDATED_POLICY_CHANGED",
  UNKNOWN: "APPROVAL_INVALDATION_UNKNOWN",
} as const;

export type ApprovalInvalidationReasonCode =
  (typeof ApprovalInvalidationReasonCode)[keyof typeof ApprovalInvalidationReasonCode];

export interface ApprovalInvalidationReason {
  code: ApprovalInvalidationReasonCode;
  description: string;
  field?: string;
}

export const APPROVAL_INVALIDATION_REASON_REGISTRY: Readonly<
  Record<ApprovalInvalidationReasonCode, ApprovalInvalidationReason>
> = Object.freeze({
  [ApprovalInvalidationReasonCode.DRAFT_MODIFIED]: {
    code: ApprovalInvalidationReasonCode.DRAFT_MODIFIED,
    description: "The payroll draft changed after approval.",
  },
  [ApprovalInvalidationReasonCode.QUORUM_CHANGED]: {
    code: ApprovalInvalidationReasonCode.QUORUM_CHANGED,
    description: "The approval quorum requirements changed.",
  },
  [ApprovalInvalidationReasonCode.APPROVAL_EXPIRED]: {
    code: ApprovalInvalidationReasonCode.APPROVAL_EXPIRED,
    description: "The approval validity window elapsed.",
  },
  [ApprovalInvalidationReasonCode.REVISION_SUPERSEDED]: {
    code: ApprovalInvalidationReasonCode.REVISION_SUPERSEDED,
    description: "A later payroll revision superseded the approval.",
  },
  [ApprovalInvalidationReasonCode.TOTAL_AMOUNT_CHANGED]: {
    code: ApprovalInvalidationReasonCode.TOTAL_AMOUNT_CHANGED,
    description: "The payroll total changed after approval.",
    field: "totalAmount",
  },
  [ApprovalInvalidationReasonCode.ASSET_CHANGED]: {
    code: ApprovalInvalidationReasonCode.ASSET_CHANGED,
    description: "The payroll asset changed after approval.",
    field: "asset",
  },
  [ApprovalInvalidationReasonCode.SCHEDULE_CHANGED]: {
    code: ApprovalInvalidationReasonCode.SCHEDULE_CHANGED,
    description: "The payroll execution schedule changed after approval.",
    field: "scheduleTimestamp",
  },
  [ApprovalInvalidationReasonCode.RECIPIENTS_CHANGED]: {
    code: ApprovalInvalidationReasonCode.RECIPIENTS_CHANGED,
    description: "The recipient roster or payout distribution changed after approval.",
    field: "recipients",
  },
  [ApprovalInvalidationReasonCode.POLICY_CHANGED]: {
    code: ApprovalInvalidationReasonCode.POLICY_CHANGED,
    description: "The governing payroll policy changed after approval.",
    field: "policy",
  },
  [ApprovalInvalidationReasonCode.UNKNOWN]: {
    code: ApprovalInvalidationReasonCode.UNKNOWN,
    description: "The payroll approval was invalidated for an unknown reason.",
  },
});

export function getApprovalInvalidationReason(
  code: string
): ApprovalInvalidationReason {
  return (
    APPROVAL_INVALIDATION_REASON_REGISTRY[
      code as ApprovalInvalidationReasonCode
    ] ?? APPROVAL_INVALIDATION_REASON_REGISTRY[ApprovalInvalidationReasonCode.UNKNOWN]
  );
}
