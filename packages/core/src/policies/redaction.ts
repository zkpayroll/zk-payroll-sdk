/**
 * Privacy-safe serialization for payroll policy evaluation results.
 *
 * Evaluation issues are already free of raw amounts, recipient addresses, and
 * employee identifiers. `toSafePolicyLog` applies a second, allowlist-based
 * projection so new fields cannot leak into logs or telemetry by accident.
 *
 * @module
 */

import type {
  PayrollPolicyCategory,
  PayrollPolicyIssueSeverity,
  PayrollPolicyOutcome,
  PayrollPolicyReasonCodeType,
} from "./reasonCodes";
import type { PayrollPolicyEvaluationResult, PayrollPolicyEvaluationSummary } from "./types";

/** Allowlisted, privacy-safe representation of a single policy issue. */
export interface PayrollPolicySafeLogIssue {
  policyId: string;
  category: PayrollPolicyCategory;
  code: PayrollPolicyReasonCodeType | string;
  severity: PayrollPolicyIssueSeverity;
  message: string;
  action: string;
  field?: string;
  entryIndex?: number;
}

/** Allowlisted, privacy-safe representation of a policy evaluation result. */
export interface PayrollPolicySafeLog {
  outcome: PayrollPolicyOutcome;
  passed: boolean;
  blocked: boolean;
  reasonCodes: string[];
  summary: PayrollPolicyEvaluationSummary;
  evaluatedAt: number;
  issues: PayrollPolicySafeLogIssue[];
}

/**
 * Projects an evaluation result onto a strict allowlist suitable for logs,
 * telemetry, and error reports.
 *
 * @param result - Result returned by the policy evaluator.
 * @returns A copy containing only non-sensitive policy metadata.
 */
export function toSafePolicyLog(result: PayrollPolicyEvaluationResult): PayrollPolicySafeLog {
  return {
    outcome: result.outcome,
    passed: result.passed,
    blocked: result.blocked,
    reasonCodes: [...result.reasonCodes],
    summary: {
      ...result.summary,
      issuesByCategory: { ...result.summary.issuesByCategory },
    },
    evaluatedAt: result.evaluatedAt,
    issues: result.issues.map((issue) => ({
      policyId: issue.policyId,
      category: issue.category,
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      action: issue.action,
      ...(issue.field !== undefined ? { field: issue.field } : {}),
      ...(issue.entryIndex !== undefined ? { entryIndex: issue.entryIndex } : {}),
    })),
  };
}

/**
 * Returns a single-line, privacy-safe summary for console/CI output.
 */
export function formatPayrollPolicySummary(result: PayrollPolicyEvaluationResult): string {
  const { summary } = result;
  return (
    `Payroll policy ${result.outcome}: ${summary.blockerCount} blocker(s), ` +
    `${summary.warningCount} warning(s) across ${summary.totalEntries} entr` +
    `${summary.totalEntries === 1 ? "y" : "ies"}` +
    (result.reasonCodes.length > 0 ? ` [${result.reasonCodes.join(", ")}]` : "")
  );
}
