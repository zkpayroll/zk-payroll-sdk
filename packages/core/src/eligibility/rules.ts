import { StrKey } from "@stellar/stellar-sdk";
import {
  EligibilityReasonCode,
  getReasonCodeAction,
  getReasonCodeDescription,
} from "./reasonCodes";
import type { EligibilityReason, EligibilityRuleContext, EmployeeEligibilityRecord } from "./types";

/**
 * Validates the recipient address for presence and valid Stellar format.
 */
export function validateRecipientRule(
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const recipient = record.recipient;

  if (!recipient || typeof recipient !== "string" || recipient.trim() === "") {
    reasons.push({
      code: EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS,
      message: getReasonCodeDescription(EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS),
      field: "recipient",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS),
    });
    return reasons;
  }

  const trimmed = recipient.trim();
  const requireValidStellar = context.options.requireValidStellarAddress !== false;

  if (requireValidStellar) {
    let isValid = false;
    try {
      if (typeof StrKey?.isValidEd25519PublicKey === "function") {
        isValid =
          StrKey.isValidEd25519PublicKey(trimmed) ||
          (typeof StrKey.isValidContract === "function" && StrKey.isValidContract(trimmed));
      } else {
        // Fallback pattern for G-address or C-address (56 chars, base32)
        isValid = /^[GC][A-Z2-7]{55}$/.test(trimmed);
      }
    } catch {
      isValid = /^[GC][A-Z2-7]{55}$/.test(trimmed);
    }

    if (!isValid) {
      reasons.push({
        code: EligibilityReasonCode.INVALID_RECIPIENT_ADDRESS,
        message: getReasonCodeDescription(EligibilityReasonCode.INVALID_RECIPIENT_ADDRESS),
        field: "recipient",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.INVALID_RECIPIENT_ADDRESS),
      });
    }
  }

  return reasons;
}

/**
 * Validates employee identifier presence.
 */
export function validateEmployeeIdRule(record: EmployeeEligibilityRecord): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const empId = record.employeeId;

  if (!empId || typeof empId !== "string" || empId.trim() === "") {
    reasons.push({
      code: EligibilityReasonCode.MISSING_EMPLOYEE_ID,
      message: getReasonCodeDescription(EligibilityReasonCode.MISSING_EMPLOYEE_ID),
      field: "employeeId",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.MISSING_EMPLOYEE_ID),
    });
  }

  return reasons;
}

/**
 * Validates salary / payment amount bounds without leaking private salary values.
 */
export function validateSalaryRule(
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const rawAmount = record.salary ?? record.amount;

  if (
    rawAmount === undefined ||
    rawAmount === null ||
    typeof rawAmount !== "bigint" ||
    rawAmount <= 0n
  ) {
    reasons.push({
      code: EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY,
      message: getReasonCodeDescription(EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY),
      field: "salary",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY),
    });
    return reasons;
  }

  const { minSalary, maxSalary } = context.options;

  if (minSalary !== undefined && rawAmount < minSalary) {
    reasons.push({
      code: EligibilityReasonCode.SALARY_BELOW_MIN_LIMIT,
      message: getReasonCodeDescription(EligibilityReasonCode.SALARY_BELOW_MIN_LIMIT),
      field: "salary",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.SALARY_BELOW_MIN_LIMIT),
    });
  }

  if (maxSalary !== undefined && rawAmount > maxSalary) {
    reasons.push({
      code: EligibilityReasonCode.SALARY_EXCEEDS_MAX_LIMIT,
      message: getReasonCodeDescription(EligibilityReasonCode.SALARY_EXCEEDS_MAX_LIMIT),
      field: "salary",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.SALARY_EXCEEDS_MAX_LIMIT),
    });
  }

  return reasons;
}

/**
 * Validates asset presence and asset whitelist adherence.
 */
export function validateAssetRule(
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const asset = record.asset ?? record.token;

  if (!asset || typeof asset !== "string" || asset.trim() === "") {
    reasons.push({
      code: EligibilityReasonCode.MISSING_ASSET_IDENTIFIER,
      message: getReasonCodeDescription(EligibilityReasonCode.MISSING_ASSET_IDENTIFIER),
      field: "asset",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.MISSING_ASSET_IDENTIFIER),
    });
    return reasons;
  }

  const allowed = context.options.allowedAssets;
  if (allowed && allowed.length > 0) {
    const trimmed = asset.trim();
    if (!allowed.includes(trimmed)) {
      reasons.push({
        code: EligibilityReasonCode.UNSUPPORTED_ASSET,
        message: `${getReasonCodeDescription(EligibilityReasonCode.UNSUPPORTED_ASSET)} (configured: ${trimmed})`,
        field: "asset",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.UNSUPPORTED_ASSET),
      });
    }
  }

  return reasons;
}

/**
 * Validates employee status against employment lifecycle states.
 */
export function validateStatusRule(
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const rawStatus = (record.status ?? "active").toLowerCase().trim();

  if (rawStatus === "inactive") {
    reasons.push({
      code: EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS,
      message: getReasonCodeDescription(EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS),
      field: "status",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS),
    });
    return reasons;
  }

  if (rawStatus === "suspended") {
    reasons.push({
      code: EligibilityReasonCode.EMPLOYEE_SUSPENDED,
      message: getReasonCodeDescription(EligibilityReasonCode.EMPLOYEE_SUSPENDED),
      field: "status",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.EMPLOYEE_SUSPENDED),
    });
    return reasons;
  }

  if (rawStatus === "terminated" || rawStatus === "offboarded") {
    reasons.push({
      code: EligibilityReasonCode.EMPLOYEE_TERMINATED,
      message: getReasonCodeDescription(EligibilityReasonCode.EMPLOYEE_TERMINATED),
      field: "status",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.EMPLOYEE_TERMINATED),
    });
    return reasons;
  }

  const allowedStatuses = context.options.allowedStatuses;
  if (allowedStatuses && allowedStatuses.length > 0) {
    const normalizedAllowed = allowedStatuses.map((s) => s.toLowerCase().trim());
    if (!normalizedAllowed.includes(rawStatus)) {
      reasons.push({
        code: EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS,
        message: `Employee status '${rawStatus}' is not in allowed statuses (${normalizedAllowed.join(", ")})`,
        field: "status",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS),
      });
    }
  }

  return reasons;
}

function parseDateToTimestamp(val: number | string | Date | undefined): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Validates effective start and expiry dates relative to the evaluation reference timestamp.
 */
export function validateLifecycleDatesRule(
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const refTime = context.referenceTimestamp;

  const effTs = parseDateToTimestamp(record.effectiveDate);
  if (effTs !== undefined && effTs > refTime) {
    reasons.push({
      code: EligibilityReasonCode.EFFECTIVE_DATE_FUTURE,
      message: getReasonCodeDescription(EligibilityReasonCode.EFFECTIVE_DATE_FUTURE),
      field: "effectiveDate",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.EFFECTIVE_DATE_FUTURE),
      details: { effectiveDate: new Date(effTs).toISOString() },
    });
  }

  const expTs = parseDateToTimestamp(record.expiryDate);
  if (expTs !== undefined && expTs < refTime) {
    reasons.push({
      code: EligibilityReasonCode.EFFECTIVE_DATE_EXPIRED,
      message: getReasonCodeDescription(EligibilityReasonCode.EFFECTIVE_DATE_EXPIRED),
      field: "expiryDate",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.EFFECTIVE_DATE_EXPIRED),
      details: { expiryDate: new Date(expTs).toISOString() },
    });
  }

  return reasons;
}

/**
 * Validates compliance holds, administrative locks, and sanctions flags.
 */
export function validateComplianceRule(
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];

  if (record.isBlocked === true) {
    reasons.push({
      code: EligibilityReasonCode.COMPLIANCE_BLOCKED,
      message: getReasonCodeDescription(EligibilityReasonCode.COMPLIANCE_BLOCKED),
      field: "isBlocked",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.COMPLIANCE_BLOCKED),
    });
  }

  if (record.isLocked === true) {
    reasons.push({
      code: EligibilityReasonCode.PAYROLL_LOCKED,
      message: getReasonCodeDescription(EligibilityReasonCode.PAYROLL_LOCKED),
      field: "isLocked",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.PAYROLL_LOCKED),
    });
  }

  if (record.complianceStatus) {
    const status = record.complianceStatus.toLowerCase().trim();
    if (status === "sanctioned") {
      reasons.push({
        code: EligibilityReasonCode.SANCTION_LISTED,
        message: getReasonCodeDescription(EligibilityReasonCode.SANCTION_LISTED),
        field: "complianceStatus",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.SANCTION_LISTED),
      });
    } else if (status === "failed" || status === "blocked") {
      reasons.push({
        code: EligibilityReasonCode.COMPLIANCE_BLOCKED,
        message: getReasonCodeDescription(EligibilityReasonCode.COMPLIANCE_BLOCKED),
        field: "complianceStatus",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.COMPLIANCE_BLOCKED),
      });
    } else if (status === "pending" && context.options.strictCompliance !== false) {
      reasons.push({
        code: EligibilityReasonCode.COMPLIANCE_BLOCKED,
        message: "Employee compliance verification is still pending.",
        field: "complianceStatus",
        severity: "error",
        action: "Complete KYC/AML verification prior to releasing payroll disbursements.",
      });
    }
  }

  return reasons;
}

/**
 * Validates batch uniqueness for employee IDs and recipient addresses.
 */
export function validateBatchDuplicatesRule(
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  if (
    context.options.checkDuplicates === false ||
    !context.batchRecords ||
    context.index === undefined
  ) {
    return reasons;
  }

  const currentIndex = context.index;
  const batch = context.batchRecords;

  for (let i = 0; i < currentIndex; i++) {
    const prior = batch[i];
    if (
      record.employeeId &&
      prior.employeeId &&
      record.employeeId.trim() !== "" &&
      record.employeeId.trim() === prior.employeeId.trim()
    ) {
      reasons.push({
        code: EligibilityReasonCode.DUPLICATE_EMPLOYEE_ID,
        message: `${getReasonCodeDescription(EligibilityReasonCode.DUPLICATE_EMPLOYEE_ID)} (duplicates record at index ${i})`,
        field: "employeeId",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.DUPLICATE_EMPLOYEE_ID),
      });
      break;
    }
  }

  for (let i = 0; i < currentIndex; i++) {
    const prior = batch[i];
    if (
      record.recipient &&
      prior.recipient &&
      record.recipient.trim() !== "" &&
      record.recipient.trim() === prior.recipient.trim()
    ) {
      reasons.push({
        code: EligibilityReasonCode.DUPLICATE_RECIPIENT_ADDRESS,
        message: `${getReasonCodeDescription(EligibilityReasonCode.DUPLICATE_RECIPIENT_ADDRESS)} (duplicates record at index ${i})`,
        field: "recipient",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.DUPLICATE_RECIPIENT_ADDRESS),
      });
      break;
    }
  }

  return reasons;
}

/**
 * Validates an employee record against an on-chain Soroban registry contract.
 */
export async function validateOnChainRegistryRule(
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
): Promise<EligibilityReason[]> {
  const reasons: EligibilityReason[] = [];
  const registryConfig = context.options.onChainRegistry;
  if (!registryConfig || !record.recipient) {
    return reasons;
  }

  const { client, employer, signer, network, verifySalaryMatch, verifyTokenMatch } = registryConfig;

  try {
    const entry = await client.getRegistry(employer, record.recipient, signer, network);
    if (!entry) {
      reasons.push({
        code: EligibilityReasonCode.REGISTRY_RECORD_NOT_FOUND,
        message: getReasonCodeDescription(EligibilityReasonCode.REGISTRY_RECORD_NOT_FOUND),
        field: "registry",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.REGISTRY_RECORD_NOT_FOUND),
      });
      return reasons;
    }

    if (!entry.active) {
      reasons.push({
        code: EligibilityReasonCode.REGISTRY_RECORD_DEACTIVATED,
        message: getReasonCodeDescription(EligibilityReasonCode.REGISTRY_RECORD_DEACTIVATED),
        field: "registry.active",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.REGISTRY_RECORD_DEACTIVATED),
      });
    }

    const recSalary = record.salary ?? record.amount;
    if (verifySalaryMatch && recSalary !== undefined && entry.salary !== recSalary) {
      reasons.push({
        code: EligibilityReasonCode.REGISTRY_SALARY_MISMATCH,
        message: getReasonCodeDescription(EligibilityReasonCode.REGISTRY_SALARY_MISMATCH),
        field: "salary",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.REGISTRY_SALARY_MISMATCH),
      });
    }

    const recToken = record.asset ?? record.token;
    if (verifyTokenMatch && recToken !== undefined && entry.token !== recToken) {
      reasons.push({
        code: EligibilityReasonCode.REGISTRY_TOKEN_MISMATCH,
        message: getReasonCodeDescription(EligibilityReasonCode.REGISTRY_TOKEN_MISMATCH),
        field: "asset",
        severity: "error",
        action: getReasonCodeAction(EligibilityReasonCode.REGISTRY_TOKEN_MISMATCH),
      });
    }
  } catch (error) {
    reasons.push({
      code: EligibilityReasonCode.REGISTRY_RECORD_NOT_FOUND,
      message: `On-chain registry query failed or record was not found: ${error instanceof Error ? error.message : String(error)}`,
      field: "registry",
      severity: "error",
      action: getReasonCodeAction(EligibilityReasonCode.REGISTRY_RECORD_NOT_FOUND),
    });
  }

  return reasons;
}
