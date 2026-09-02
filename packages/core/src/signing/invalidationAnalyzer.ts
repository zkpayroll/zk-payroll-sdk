import { PayrollDraft, InvalidationAnalysisResult } from '../policy/types';
import { comparePayrollDrafts } from '../batches/diff';

/**
 * Analyzes whether edits between an approved payroll draft and a modified draft
 * invalidate existing signoff approvals.
 */
export function analyzeApprovalInvalidation(
  originalDraft: PayrollDraft,
  modifiedDraft: PayrollDraft
): InvalidationAnalysisResult {
  const diff = comparePayrollDrafts(originalDraft, modifiedDraft);
  const reasons: string[] = [];

  if (diff.changedFields.includes('totalAmount')) {
    reasons.push(`Total payment amount changed from ${originalDraft.totalAmount} to ${modifiedDraft.totalAmount}`);
  }

  if (diff.changedFields.includes('asset')) {
    reasons.push(`Asset type changed from ${originalDraft.asset} to ${modifiedDraft.asset}`);
  }

  if (diff.changedFields.includes('scheduleTimestamp')) {
    reasons.push(`Execution schedule timestamp modified`);
  }

  if (diff.changedFields.some((f) => f.startsWith('recipient'))) {
    reasons.push(`Recipient roster or individual payout amounts modified`);
  }

  if (diff.changedFields.includes('policy')) {
    reasons.push(`Underlying policy configuration updated`);
  }

  const requiresReapproval = diff.hasDifferences && originalDraft.approvals.length > 0;
  const invalidatedApprovalsCount = requiresReapproval ? originalDraft.approvals.length : 0;

  return {
    requiresReapproval,
    invalidatedApprovalsCount,
    reasons,
    changedFields: diff.changedFields,
  };
}
