import { CompiledPayrollDraft, InvalidationAnalysisResult } from "../policy/types";
import { comparePayrollDrafts } from "../batches/diff";
import { ApprovalInvalidationReasonCode } from "../payroll/approvalInvalidationReasons";

/**
 * Analyzes whether edits between an approved payroll draft and a modified draft
 * invalidate existing signoff approvals.
 */
export function analyzeApprovalInvalidation(
  originalDraft: CompiledPayrollDraft,
  modifiedDraft: CompiledPayrollDraft
): InvalidationAnalysisResult {
  const diff = comparePayrollDrafts(originalDraft, modifiedDraft);
  const reasons: string[] = [];
  const reasonCodes: ApprovalInvalidationReasonCode[] = [];

  if (diff.changedFields.includes("totalAmount")) {
    reasons.push("The payroll total changed after approval.");
    reasonCodes.push(ApprovalInvalidationReasonCode.TOTAL_AMOUNT_CHANGED);
  }

  if (diff.changedFields.includes("asset")) {
    reasons.push("The payroll asset changed after approval.");
    reasonCodes.push(ApprovalInvalidationReasonCode.ASSET_CHANGED);
  }

  if (diff.changedFields.includes("scheduleTimestamp")) {
    reasons.push("The payroll execution schedule changed after approval.");
    reasonCodes.push(ApprovalInvalidationReasonCode.SCHEDULE_CHANGED);
  }

  if (diff.changedFields.some((f) => f.startsWith("recipient"))) {
    reasons.push("The recipient roster or payout distribution changed after approval.");
    reasonCodes.push(ApprovalInvalidationReasonCode.RECIPIENTS_CHANGED);
  }

  if (diff.changedFields.includes("policy")) {
    reasons.push("The governing payroll policy changed after approval.");
    reasonCodes.push(ApprovalInvalidationReasonCode.POLICY_CHANGED);
  }

  const requiresReapproval = diff.hasDifferences && originalDraft.approvals.length > 0;
  const invalidatedApprovalsCount = requiresReapproval ? originalDraft.approvals.length : 0;

  return {
    requiresReapproval,
    invalidatedApprovalsCount,
    reasons,
    changedFields: diff.changedFields,
    reasonCodes,
  };
}
