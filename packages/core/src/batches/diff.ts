import { PayrollDraft } from '../policy/types';

export interface BatchDiffResult {
  hasDifferences: boolean;
  changedFields: string[];
}

export function comparePayrollDrafts(original: PayrollDraft, modified: PayrollDraft): BatchDiffResult {
  const changedFields: string[] = [];

  if (original.totalAmount !== modified.totalAmount) {
    changedFields.push('totalAmount');
  }

  if (original.asset !== modified.asset) {
    changedFields.push('asset');
  }

  if (original.scheduleTimestamp !== modified.scheduleTimestamp) {
    changedFields.push('scheduleTimestamp');
  }

  if (original.recipients.length !== modified.recipients.length) {
    changedFields.push('recipientsCount');
  } else {
    for (let i = 0; i < original.recipients.length; i++) {
      const origR = original.recipients[i];
      const modR = modified.recipients[i];
      if (origR.id !== modR.id || origR.amount !== modR.amount || origR.recipientAddress !== modR.recipientAddress) {
        changedFields.push(`recipient_${i}`);
        break;
      }
    }
  }

  if (
    original.policy.maxBatchAmount !== modified.policy.maxBatchAmount ||
    original.policy.requiredApprovalsCount !== modified.policy.requiredApprovalsCount ||
    original.policy.allowedAsset !== modified.policy.allowedAsset
  ) {
    changedFields.push('policy');
  }

  return {
    hasDifferences: changedFields.length > 0,
    changedFields,
  };
}
