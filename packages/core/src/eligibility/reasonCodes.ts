/**
 * Machine-readable typed reason codes for employee payroll eligibility.
 */
export const EligibilityReasonCode = {
  // ── Identity & Address ──────────────────────────────────────────────────
  MISSING_RECIPIENT_ADDRESS: "MISSING_RECIPIENT_ADDRESS",
  INVALID_RECIPIENT_ADDRESS: "INVALID_RECIPIENT_ADDRESS",
  MISSING_EMPLOYEE_ID: "MISSING_EMPLOYEE_ID",
  DUPLICATE_EMPLOYEE_ID: "DUPLICATE_EMPLOYEE_ID",
  DUPLICATE_RECIPIENT_ADDRESS: "DUPLICATE_RECIPIENT_ADDRESS",

  // ── Status & Lifecycle ──────────────────────────────────────────────────
  INACTIVE_EMPLOYEE_STATUS: "INACTIVE_EMPLOYEE_STATUS",
  EMPLOYEE_SUSPENDED: "EMPLOYEE_SUSPENDED",
  EMPLOYEE_TERMINATED: "EMPLOYEE_TERMINATED",
  EFFECTIVE_DATE_FUTURE: "EFFECTIVE_DATE_FUTURE",
  EFFECTIVE_DATE_EXPIRED: "EFFECTIVE_DATE_EXPIRED",

  // ── Compensation & Currency ─────────────────────────────────────────────
  ZERO_OR_NEGATIVE_SALARY: "ZERO_OR_NEGATIVE_SALARY",
  SALARY_EXCEEDS_MAX_LIMIT: "SALARY_EXCEEDS_MAX_LIMIT",
  SALARY_BELOW_MIN_LIMIT: "SALARY_BELOW_MIN_LIMIT",
  MISSING_ASSET_IDENTIFIER: "MISSING_ASSET_IDENTIFIER",
  UNSUPPORTED_ASSET: "UNSUPPORTED_ASSET",

  // ── Compliance & Risk ───────────────────────────────────────────────────
  COMPLIANCE_BLOCKED: "COMPLIANCE_BLOCKED",
  PAYROLL_LOCKED: "PAYROLL_LOCKED",
  SANCTION_LISTED: "SANCTION_LISTED",

  // ── On-Chain Registry Verification ──────────────────────────────────────
  REGISTRY_RECORD_NOT_FOUND: "REGISTRY_RECORD_NOT_FOUND",
  REGISTRY_RECORD_DEACTIVATED: "REGISTRY_RECORD_DEACTIVATED",
  REGISTRY_SALARY_MISMATCH: "REGISTRY_SALARY_MISMATCH",
  REGISTRY_TOKEN_MISMATCH: "REGISTRY_TOKEN_MISMATCH",

  // ── Custom / Extensible ─────────────────────────────────────────────────
  CUSTOM_INELIGIBILITY_RULE: "CUSTOM_INELIGIBILITY_RULE",
} as const;

export type EligibilityReasonCodeType =
  (typeof EligibilityReasonCode)[keyof typeof EligibilityReasonCode];

export type EligibilityReasonCategory =
  "identity" | "status" | "compensation" | "compliance" | "registry" | "custom";

export interface ReasonCodeMetadata {
  code: EligibilityReasonCodeType;
  category: EligibilityReasonCategory;
  description: string;
  suggestedAction: string;
  severity: "error" | "warning";
  retryable: boolean;
}

/**
 * Registry defining metadata, default user-friendly explanations,
 * and suggested remediation actions for every eligibility reason code.
 */
export const ELIGIBILITY_REASON_REGISTRY: Record<EligibilityReasonCodeType, ReasonCodeMetadata> = {
  // Identity & Address
  [EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS]: {
    code: EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS,
    category: "identity",
    description: "Employee record does not have a destination recipient address specified.",
    suggestedAction: "Provide a valid destination Stellar address for the employee.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.INVALID_RECIPIENT_ADDRESS]: {
    code: EligibilityReasonCode.INVALID_RECIPIENT_ADDRESS,
    category: "identity",
    description: "Recipient address format is invalid or malformed.",
    suggestedAction:
      "Verify and correct the public key address format (e.g. valid Stellar G... address).",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.MISSING_EMPLOYEE_ID]: {
    code: EligibilityReasonCode.MISSING_EMPLOYEE_ID,
    category: "identity",
    description: "Employee record is missing an identifier.",
    suggestedAction: "Assign a unique employee ID to the record before resolution.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.DUPLICATE_EMPLOYEE_ID]: {
    code: EligibilityReasonCode.DUPLICATE_EMPLOYEE_ID,
    category: "identity",
    description: "Multiple records in the payroll batch share the same employee ID.",
    suggestedAction: "Deduplicate or merge records for this employee ID in the batch payload.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.DUPLICATE_RECIPIENT_ADDRESS]: {
    code: EligibilityReasonCode.DUPLICATE_RECIPIENT_ADDRESS,
    category: "identity",
    description: "Multiple records in the payroll batch share the same destination address.",
    suggestedAction: "Ensure each recipient address appears only once per payroll batch.",
    severity: "error",
    retryable: false,
  },

  // Status & Lifecycle
  [EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS]: {
    code: EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS,
    category: "status",
    description: "Employee account is flagged as inactive.",
    suggestedAction: "Activate the employee account in the HR/payroll system before processing.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.EMPLOYEE_SUSPENDED]: {
    code: EligibilityReasonCode.EMPLOYEE_SUSPENDED,
    category: "status",
    description: "Employee account is currently suspended.",
    suggestedAction:
      "Resolve the administrative suspension prior to releasing payroll disbursements.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.EMPLOYEE_TERMINATED]: {
    code: EligibilityReasonCode.EMPLOYEE_TERMINATED,
    category: "status",
    description: "Employee is terminated and no longer eligible for standard payroll runs.",
    suggestedAction: "Process any final severance through dedicated settlement workflows.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.EFFECTIVE_DATE_FUTURE]: {
    code: EligibilityReasonCode.EFFECTIVE_DATE_FUTURE,
    category: "status",
    description: "Employee employment or eligibility start date is in the future.",
    suggestedAction:
      "Schedule payroll disbursement for on or after the employee effective start date.",
    severity: "error",
    retryable: true,
  },
  [EligibilityReasonCode.EFFECTIVE_DATE_EXPIRED]: {
    code: EligibilityReasonCode.EFFECTIVE_DATE_EXPIRED,
    category: "status",
    description: "Employee contract or eligibility period has ended prior to this payroll cycle.",
    suggestedAction: "Renew the employee contract or adjust payroll cycle boundaries.",
    severity: "error",
    retryable: false,
  },

  // Compensation & Currency
  [EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY]: {
    code: EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY,
    category: "compensation",
    description: "Configured salary or payment amount is zero or negative.",
    suggestedAction: "Set a positive non-zero payout amount for the recipient.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.SALARY_EXCEEDS_MAX_LIMIT]: {
    code: EligibilityReasonCode.SALARY_EXCEEDS_MAX_LIMIT,
    category: "compensation",
    description: "Configured salary exceeds the maximum allowable single-payout ceiling.",
    suggestedAction: "Split the transaction or request executive limit elevation approval.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.SALARY_BELOW_MIN_LIMIT]: {
    code: EligibilityReasonCode.SALARY_BELOW_MIN_LIMIT,
    category: "compensation",
    description: "Configured salary is below the minimum threshold required for payout resolution.",
    suggestedAction: "Verify salary amount meets the minimum threshold or combine into next cycle.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.MISSING_ASSET_IDENTIFIER]: {
    code: EligibilityReasonCode.MISSING_ASSET_IDENTIFIER,
    category: "compensation",
    description: "Asset or token identifier is not specified.",
    suggestedAction: "Provide a valid token contract address or native asset identifier.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.UNSUPPORTED_ASSET]: {
    code: EligibilityReasonCode.UNSUPPORTED_ASSET,
    category: "compensation",
    description: "The requested asset is not permitted in this payroll configuration.",
    suggestedAction: "Use an approved asset token supported by the payroll contract configuration.",
    severity: "error",
    retryable: false,
  },

  // Compliance & Risk
  [EligibilityReasonCode.COMPLIANCE_BLOCKED]: {
    code: EligibilityReasonCode.COMPLIANCE_BLOCKED,
    category: "compliance",
    description: "Employee record failed KYC, AML, or compliance verification policy.",
    suggestedAction: "Review compliance documentation and complete required identity verification.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.PAYROLL_LOCKED]: {
    code: EligibilityReasonCode.PAYROLL_LOCKED,
    category: "compliance",
    description: "Employee payout is temporarily locked due to an administrative or security hold.",
    suggestedAction: "Release the administrative lock in the payroll dashboard.",
    severity: "error",
    retryable: true,
  },
  [EligibilityReasonCode.SANCTION_LISTED]: {
    code: EligibilityReasonCode.SANCTION_LISTED,
    category: "compliance",
    description: "Recipient address matches a prohibited sanctions screening filter.",
    suggestedAction: "Escalate to the legal and compliance team for review.",
    severity: "error",
    retryable: false,
  },

  // On-Chain Registry Verification
  [EligibilityReasonCode.REGISTRY_RECORD_NOT_FOUND]: {
    code: EligibilityReasonCode.REGISTRY_RECORD_NOT_FOUND,
    category: "registry",
    description: "No registered employer-employee registry entry exists on-chain.",
    suggestedAction:
      "Register the employee with the payroll smart contract before initiating payment.",
    severity: "error",
    retryable: true,
  },
  [EligibilityReasonCode.REGISTRY_RECORD_DEACTIVATED]: {
    code: EligibilityReasonCode.REGISTRY_RECORD_DEACTIVATED,
    category: "registry",
    description: "The on-chain employer-employee registry entry is marked as deactivated.",
    suggestedAction: "Reactivate the registry entry on-chain or register a new relationship.",
    severity: "error",
    retryable: true,
  },
  [EligibilityReasonCode.REGISTRY_SALARY_MISMATCH]: {
    code: EligibilityReasonCode.REGISTRY_SALARY_MISMATCH,
    category: "registry",
    description:
      "The resolution salary does not match the registered salary in the on-chain registry.",
    suggestedAction: "Update the registry salary on-chain to match the resolved payment amount.",
    severity: "error",
    retryable: false,
  },
  [EligibilityReasonCode.REGISTRY_TOKEN_MISMATCH]: {
    code: EligibilityReasonCode.REGISTRY_TOKEN_MISMATCH,
    category: "registry",
    description:
      "The payment token asset does not match the asset registered in the smart contract.",
    suggestedAction: "Use the registered token address or update contract registry configuration.",
    severity: "error",
    retryable: false,
  },

  // Custom / Extensible
  [EligibilityReasonCode.CUSTOM_INELIGIBILITY_RULE]: {
    code: EligibilityReasonCode.CUSTOM_INELIGIBILITY_RULE,
    category: "custom",
    description: "A custom user-defined eligibility rule failed for this employee.",
    suggestedAction: "Review custom policy criteria for additional details.",
    severity: "error",
    retryable: false,
  },
};

/**
 * Look up registered metadata for a given eligibility reason code.
 */
export function getReasonCodeMetadata(code: string): ReasonCodeMetadata | undefined {
  if (code in ELIGIBILITY_REASON_REGISTRY) {
    return ELIGIBILITY_REASON_REGISTRY[code as EligibilityReasonCodeType];
  }
  return undefined;
}

/**
 * Returns a human-friendly description for the reason code.
 */
export function getReasonCodeDescription(code: string): string {
  const meta = getReasonCodeMetadata(code);
  return meta?.description ?? `Employee record is ineligible due to reason code: ${code}`;
}

/**
 * Returns suggested remediation action for the reason code.
 */
export function getReasonCodeAction(code: string): string {
  const meta = getReasonCodeMetadata(code);
  return meta?.suggestedAction ?? "Review employee record parameters and re-evaluate eligibility.";
}

/**
 * Check if a code string is a recognized `EligibilityReasonCodeType`.
 */
export function isEligibilityReasonCode(code: string): code is EligibilityReasonCodeType {
  return Object.values(EligibilityReasonCode).includes(code as EligibilityReasonCodeType);
}

/**
 * Returns all reason codes belonging to a specific category.
 */
export function getReasonCodesByCategory(
  category: EligibilityReasonCategory
): EligibilityReasonCodeType[] {
  return (Object.keys(ELIGIBILITY_REASON_REGISTRY) as EligibilityReasonCodeType[]).filter(
    (code) => ELIGIBILITY_REASON_REGISTRY[code].category === category
  );
}
