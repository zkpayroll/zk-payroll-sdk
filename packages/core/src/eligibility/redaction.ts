import type {
  BatchEligibilityResult,
  EligibilityDiagnosticReport,
  EligibilityReportOptions,
  EmployeeEligibilityRecord,
  EmployeeEligibilityResult,
} from "./types";

const DEFAULT_SENSITIVE_ELIGIBILITY_FIELDS = new Set([
  "salary",
  "amount",
  "privateKey",
  "adminKey",
  "secret",
  "password",
  "signingKey",
]);

/**
 * Sanitizes an employee record by redacting sensitive salary or key fields.
 */
export function redactEmployeeRecord(
  record: EmployeeEligibilityRecord,
  options: EligibilityReportOptions = {}
): Record<string, unknown> {
  const shouldRedact = options.redactSensitive !== false;
  const placeholder = options.placeholder ?? "[redacted]";

  const out: Record<string, unknown> = {
    employeeId: record.employeeId,
    recipient: record.recipient,
  };

  if (record.name !== undefined) out.name = record.name;
  if (record.department !== undefined) out.department = record.department;
  if (record.status !== undefined) out.status = record.status;
  if (record.asset !== undefined) out.asset = record.asset;
  if (record.token !== undefined) out.token = record.token;
  if (record.effectiveDate !== undefined) out.effectiveDate = record.effectiveDate;
  if (record.expiryDate !== undefined) out.expiryDate = record.expiryDate;
  if (record.isBlocked !== undefined) out.isBlocked = record.isBlocked;
  if (record.isLocked !== undefined) out.isLocked = record.isLocked;
  if (record.complianceStatus !== undefined) out.complianceStatus = record.complianceStatus;

  if (shouldRedact) {
    if (record.salary !== undefined) out.salary = placeholder;
    if (record.amount !== undefined) out.amount = placeholder;
  } else {
    if (record.salary !== undefined) out.salary = record.salary.toString();
    if (record.amount !== undefined) out.amount = record.amount.toString();
  }

  if (record.metadata !== undefined) {
    const meta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record.metadata)) {
      if (shouldRedact && DEFAULT_SENSITIVE_ELIGIBILITY_FIELDS.has(k)) {
        meta[k] = placeholder;
      } else {
        meta[k] = v;
      }
    }
    out.metadata = meta;
  }

  return out;
}

/**
 * Sanitizes an eligibility evaluation result for telemetry or dashboard transmission.
 */
export function redactEligibilityResult(
  result: EmployeeEligibilityResult,
  options: EligibilityReportOptions = {}
): EmployeeEligibilityResult {
  const shouldRedact = options.redactSensitive !== false;
  const placeholder = options.placeholder ?? "[redacted]";

  return {
    employeeId: result.employeeId,
    recipient: result.recipient,
    isEligible: result.isEligible,
    status: result.status,
    primaryReasonCode: result.primaryReasonCode,
    evaluatedAt: result.evaluatedAt,
    reasons: result.reasons.map((r) => {
      const reasonCopy = { ...r };
      if (options.includeActions === false) {
        delete reasonCopy.action;
      }
      if (!options.includeDetails) {
        delete reasonCopy.details;
      } else if (shouldRedact && reasonCopy.details) {
        const cleanedDetails: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(reasonCopy.details)) {
          if (DEFAULT_SENSITIVE_ELIGIBILITY_FIELDS.has(k)) {
            cleanedDetails[k] = placeholder;
          } else {
            cleanedDetails[k] = v;
          }
        }
        reasonCopy.details = cleanedDetails;
      }
      return reasonCopy;
    }),
  };
}

/**
 * Redacts a full batch eligibility result for external reporting.
 */
export function redactBatchEligibilityResult(
  batch: BatchEligibilityResult,
  options: EligibilityReportOptions = {}
): BatchEligibilityResult {
  return {
    totalRecords: batch.totalRecords,
    eligibleCount: batch.eligibleCount,
    ineligibleCount: batch.ineligibleCount,
    evaluatedAt: batch.evaluatedAt,
    reasonCodeSummary: { ...batch.reasonCodeSummary },
    eligibleRecords: batch.eligibleRecords.map((r) =>
      redactEmployeeRecord(r, options)
    ) as unknown as EmployeeEligibilityRecord[],
    ineligibleRecords: batch.ineligibleRecords.map((item) => ({
      record: redactEmployeeRecord(item.record, options) as unknown as EmployeeEligibilityRecord,
      result: redactEligibilityResult(item.result, options),
    })),
    results: batch.results.map((res) => redactEligibilityResult(res, options)),
  };
}

/**
 * Formats a clean, high-level diagnostic report suitable for UI dashboards and compliance logs.
 */
export function formatEligibilityReport(
  batch: BatchEligibilityResult,
  options: EligibilityReportOptions = {}
): EligibilityDiagnosticReport {
  const includeActions = options.includeActions !== false;

  return {
    timestamp: batch.evaluatedAt,
    totalEvaluated: batch.totalRecords,
    eligibleCount: batch.eligibleCount,
    ineligibleCount: batch.ineligibleCount,
    reasonSummary: { ...batch.reasonCodeSummary },
    blockedEmployees: batch.ineligibleRecords.map((item) => ({
      employeeId: item.record.employeeId,
      recipient: item.record.recipient,
      reasons: item.result.reasons.map((r) => ({
        code: r.code,
        message: r.message,
        ...(includeActions && r.action ? { action: r.action } : {}),
      })),
    })),
  };
}
