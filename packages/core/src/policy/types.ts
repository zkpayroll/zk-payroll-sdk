export interface PayrollPolicyConfig {
  maxBatchAmount: bigint;
  requiredApprovalsCount: number;
  allowedAsset: string;
}

export interface PayrollDraftRecipient {
  id: string;
  amount: bigint;
  recipientAddress: string;
}

export interface PayrollDraft {
  draftId: string;
  version: number;
  totalAmount: bigint;
  asset: string;
  recipients: PayrollDraftRecipient[];
  scheduleTimestamp: number;
  policy: PayrollPolicyConfig;
  approvals: Array<{
    approver: string;
    signature: string;
    approvedAt: number;
  }>;
}

export interface InvalidationAnalysisResult {
  requiresReapproval: boolean;
  invalidatedApprovalsCount: number;
  reasons: string[];
  changedFields: string[];
}
