/**
 * Employee Suspension Payout Evaluator
 *
 * Determines whether a suspended employee qualifies for a payout (accrued wages,
 * final settlement, or no payout) based on suspension context and policy rules.
 *
 * ## Privacy & Security Guarantees
 * - Salary amounts and employee identifiers are never included in user-facing messages.
 * - Redacted identifiers are used by default in all result messages.
 */

import { EmployeeEligibilityRecord } from "../eligibility/types";

/** Payout disposition for a suspended employee */
export type SuspensionPayoutDisposition =
  "accrued_payout" | "final_settlement" | "no_payout" | "review_required";

/** Reason codes for payout decisions */
export type SuspensionPayoutReasonCode =
  | "ACCRUED_WAGES_DUE"
  | "FINAL_SETTLEMENT_DUE"
  | "NOT_SUSPENDED"
  | "ACCOUNT_BLOCKED"
  | "COMPLIANCE_FAILED"
  | "NO_SALARY_CONFIGURED"
  | "ACCOUNT_LOCKED"
  | "PENDING_REVIEW";

/** Options for evaluation */
export interface SuspensionPayoutEvaluatorOptions {
  /** Whether to allow accrued payouts for blocked accounts. Defaults to false. */
  allowBlockedPayout?: boolean;
  /** Whether compliance-failed employees can receive final settlement. Defaults to false. */
  allowComplianceFailedSettlement?: boolean;
  /** Redact employee identifiers in result messages. Defaults to true. */
  redact?: boolean;
  /** Reference timestamp for evaluation. Defaults to Date.now(). */
  referenceTime?: number | Date;
}

/** Structured evaluation result */
export interface SuspensionPayoutEvaluation {
  /** The employee identifier */
  employeeId: string;
  /** Redacted employee identifier */
  redactedEmployeeId: string;
  /** The payout disposition */
  disposition: SuspensionPayoutDisposition;
  /** Whether a payout should be processed */
  shouldPayout: boolean;
  /** Machine-readable reason code */
  reasonCode: SuspensionPayoutReasonCode;
  /** Human-readable reason (may contain identifiers for internal logging) */
  reason: string;
  /** Redacted reason safe for UI and external logs */
  redactedReason: string;
  /** Suggested action for the operator */
  suggestedAction?: string;
  /** Evaluation timestamp */
  evaluatedAt: number;
}

/** Batch evaluation result */
export interface SuspensionPayoutBatchResult {
  totalEvaluated: number;
  payoutCount: number;
  noPayoutCount: number;
  reviewRequiredCount: number;
  results: SuspensionPayoutEvaluation[];
  dispositionSummary: Record<SuspensionPayoutDisposition, number>;
}

/**
 * Redact an employee identifier for privacy-safe logs.
 */
function redactEmpId(id?: string): string {
  if (!id || id.trim().length === 0) return "[ANONYMOUS_EMPLOYEE]";
  const clean = id.trim();
  if (clean.length <= 4) return "[REDACTED_EMPLOYEE]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Evaluate suspension payout eligibility for a single employee.
 */
export function evaluateSuspensionPayout(
  employee: EmployeeEligibilityRecord,
  options: SuspensionPayoutEvaluatorOptions = {}
): SuspensionPayoutEvaluation {
  const {
    allowBlockedPayout = false,
    allowComplianceFailedSettlement = false,
    redact = true,
    referenceTime,
  } = options;

  const refMs =
    referenceTime instanceof Date ? referenceTime.getTime() : (referenceTime ?? Date.now());

  const empId = employee.employeeId || "";
  const redactedId = redactEmpId(empId);
  const idDisplay = redact ? redactedId : empId;

  // Not suspended -> not applicable
  if (employee.status !== "suspended") {
    return {
      employeeId: empId,
      redactedEmployeeId: redactedId,
      disposition: "no_payout",
      shouldPayout: false,
      reasonCode: "NOT_SUSPENDED",
      reason: `Employee ${empId} is not suspended (status: ${employee.status ?? "unknown"}).`,
      redactedReason: `Employee ${idDisplay} is not suspended.`,
      evaluatedAt: refMs,
    };
  }

  // Blocked account
  if (employee.isBlocked && !allowBlockedPayout) {
    return {
      employeeId: empId,
      redactedEmployeeId: redactedId,
      disposition: "no_payout",
      shouldPayout: false,
      reasonCode: "ACCOUNT_BLOCKED",
      reason: `Employee ${empId} account is blocked; payout withheld.`,
      redactedReason: `Employee ${idDisplay} account is blocked; payout withheld.`,
      suggestedAction: "Review account block status before processing any payout.",
      evaluatedAt: refMs,
    };
  }

  // Locked account -> review required
  if (employee.isLocked) {
    return {
      employeeId: empId,
      redactedEmployeeId: redactedId,
      disposition: "review_required",
      shouldPayout: false,
      reasonCode: "ACCOUNT_LOCKED",
      reason: `Employee ${empId} account is locked; manual review required.`,
      redactedReason: `Employee ${idDisplay} account is locked; manual review required.`,
      suggestedAction: "Unlock the account or escalate to administration before payout.",
      evaluatedAt: refMs,
    };
  }

  // Compliance check
  if (employee.complianceStatus === "failed" && !allowComplianceFailedSettlement) {
    return {
      employeeId: empId,
      redactedEmployeeId: redactedId,
      disposition: "no_payout",
      shouldPayout: false,
      reasonCode: "COMPLIANCE_FAILED",
      reason: `Employee ${empId} has failed compliance checks; payout withheld.`,
      redactedReason: `Employee ${idDisplay} has failed compliance checks; payout withheld.`,
      suggestedAction: "Resolve compliance issues before processing payout.",
      evaluatedAt: refMs,
    };
  }

  // No salary configured
  const salary = employee.salary ?? employee.amount;
  if (salary === undefined || salary === null) {
    return {
      employeeId: empId,
      redactedEmployeeId: redactedId,
      disposition: "review_required",
      shouldPayout: false,
      reasonCode: "NO_SALARY_CONFIGURED",
      reason: `Employee ${empId} has no salary or amount configured.`,
      redactedReason: `Employee ${idDisplay} has no salary or amount configured.`,
      suggestedAction: "Configure salary or payout amount before processing.",
      evaluatedAt: refMs,
    };
  }

  // Compliance pending -> review required
  if (employee.complianceStatus === "pending") {
    return {
      employeeId: empId,
      redactedEmployeeId: redactedId,
      disposition: "review_required",
      shouldPayout: false,
      reasonCode: "PENDING_REVIEW",
      reason: `Employee ${empId} has pending compliance review.`,
      redactedReason: `Employee ${idDisplay} has pending compliance review.`,
      suggestedAction: "Wait for compliance review to complete before processing payout.",
      evaluatedAt: refMs,
    };
  }

  // Check if there's an expiry date that has passed -> final settlement
  if (employee.expiryDate !== undefined && employee.expiryDate !== null) {
    let expiryMs: number;
    if (typeof employee.expiryDate === "number") {
      expiryMs = employee.expiryDate;
    } else if (employee.expiryDate instanceof Date) {
      expiryMs = employee.expiryDate.getTime();
    } else {
      expiryMs = Date.parse(String(employee.expiryDate));
    }

    if (!isNaN(expiryMs) && expiryMs <= refMs) {
      return {
        employeeId: empId,
        redactedEmployeeId: redactedId,
        disposition: "final_settlement",
        shouldPayout: true,
        reasonCode: "FINAL_SETTLEMENT_DUE",
        reason: `Employee ${empId} contract has expired; final settlement is due.`,
        redactedReason: `Employee ${idDisplay} contract has expired; final settlement is due.`,
        suggestedAction: "Process final settlement payout and close the employee record.",
        evaluatedAt: refMs,
      };
    }
  }

  // Default: accrued payout
  return {
    employeeId: empId,
    redactedEmployeeId: redactedId,
    disposition: "accrued_payout",
    shouldPayout: true,
    reasonCode: "ACCRUED_WAGES_DUE",
    reason: `Employee ${empId} is suspended with accrued wages due.`,
    redactedReason: `Employee ${idDisplay} is suspended with accrued wages due.`,
    suggestedAction: "Process accrued wage payout per suspension policy.",
    evaluatedAt: refMs,
  };
}

/**
 * Evaluate suspension payout eligibility for a batch of employees.
 * Only evaluates employees with status "suspended".
 */
export function evaluateSuspensionPayoutBatch(
  employees: EmployeeEligibilityRecord[],
  options: SuspensionPayoutEvaluatorOptions = {}
): SuspensionPayoutBatchResult {
  const results: SuspensionPayoutEvaluation[] = [];
  let payoutCount = 0;
  let noPayoutCount = 0;
  let reviewRequiredCount = 0;
  const dispositionSummary: Record<SuspensionPayoutDisposition, number> = {
    accrued_payout: 0,
    final_settlement: 0,
    no_payout: 0,
    review_required: 0,
  };

  for (const employee of employees) {
    const result = evaluateSuspensionPayout(employee, options);
    results.push(result);
    dispositionSummary[result.disposition]++;

    if (result.shouldPayout) {
      payoutCount++;
    } else if (result.disposition === "review_required") {
      reviewRequiredCount++;
    } else {
      noPayoutCount++;
    }
  }

  return {
    totalEvaluated: employees.length,
    payoutCount,
    noPayoutCount,
    reviewRequiredCount,
    results,
    dispositionSummary,
  };
}
