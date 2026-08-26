/**
 * Offline Payroll Draft Validation Types
 *
 * Defines types for validating payroll drafts without network access.
 * Separates blockers (must fix) from warnings (should review).
 */

/**
 * A single payroll record in a draft.
 */
export interface PayrollDraftRecord {
  /** Employee/recipient identifier (e.g., Stellar address or employee ID) */
  employeeId: string;

  /** Employee name (may be redacted in logs) */
  employeeName?: string;

  /** Amount to pay (in stroops or smallest unit of asset) */
  amount: bigint;

  /** Asset to use for payment (e.g., "native" or token contract ID) */
  asset: string;

  /** Payment period (e.g., "2024-01" for January 2024) */
  period: string;

  /** Optional department or cost center */
  department?: string;

  /** Optional notes (may be redacted) */
  notes?: string;

  /** Whether this record requires explicit approval */
  requiresApproval?: boolean;

  /** Whether this record has been approved */
  isApproved?: boolean;

  /** Optional approval metadata (approver name, timestamp, etc.) */
  approvalMetadata?: Record<string, unknown>;
}

/**
 * A payroll draft ready for validation and processing.
 */
export interface PayrollDraftData {
  /** Unique identifier for this draft */
  draftId: string;

  /** Employer/payer identifier (Stellar address) */
  employer: string;

  /** Creation timestamp (epoch milliseconds) */
  createdAt: number;

  /** Last modified timestamp (epoch milliseconds) */
  lastModifiedAt: number;

  /** Payment period covered by this draft (e.g., "2024-01") */
  period: string;

  /** Array of payroll records */
  records: PayrollDraftRecord[];

  /** Redaction policy for sensitive fields */
  redactionPolicy?: RedactionPolicy;

  /** Optional metadata about the draft */
  metadata?: {
    source?: string; // Where the draft came from (e.g., "csv_import", "manual")
    version?: string; // Draft format version
    notes?: string; // Draft-level notes
  };
}

/**
 * Redaction policy for sensitive data in logs and outputs.
 */
export interface RedactionPolicy {
  /** Whether to redact employee names */
  redactEmployeeNames: boolean;

  /** Whether to redact specific amounts */
  redactAmounts: boolean;

  /** Whether to redact employee IDs */
  redactEmployeeIds: boolean;

  /** Whether to redact notes/comments */
  redactNotes: boolean;

  /** Custom fields to redact */
  redactCustomFields?: string[];
}

/**
 * A single validation issue (blocker or warning).
 */
export interface ValidationIssue {
  /** Issue type: blocker (must fix) or warning (should review) */
  severity: "blocker" | "warning";

  /** Category of the issue */
  category: ValidationIssueCategory;

  /** Human-readable message */
  message: string;

  /** Optional row index if related to a specific record */
  recordIndex?: number;

  /** Optional field name if related to a specific field */
  field?: string;

  /** Optional suggested fix */
  suggestedFix?: string;

  /** Related record data (may be redacted) */
  relatedData?: Record<string, unknown>;

  /** Unique code for programmatic handling */
  code: string;
}

/**
 * Category of validation issue.
 */
export type ValidationIssueCategory =
  | "employee_data"
  | "asset_format"
  | "amount"
  | "period"
  | "duplicate"
  | "redaction"
  | "approval"
  | "structure"
  | "policy"
  | "other";

/**
 * Result of validating a payroll draft.
 */
export interface DraftValidationResult {
  /** Whether validation succeeded (no blockers) */
  isValid: boolean;

  /** Whether draft is ready to submit (no blockers or critical warnings) */
  isReadyToSubmit: boolean;

  /** Blocker issues that must be fixed */
  blockers: ValidationIssue[];

  /** Warning issues that should be reviewed */
  warnings: ValidationIssue[];

  /** Summary statistics */
  summary: {
    totalRecords: number;
    validRecords: number;
    recordsWithIssues: number;
    totalBlockers: number;
    totalWarnings: number;
  };

  /** When validation was performed */
  validatedAt: number;

  /** Validation duration in milliseconds */
  validationDurationMs: number;
}

/**
 * Configuration for offline validation.
 */
export interface ValidationConfig {
  /** Validate employee data format */
  validateEmployeeData?: boolean;

  /** Validate asset format */
  validateAssetFormat?: boolean;

  /** Validate payment amounts */
  validateAmounts?: boolean;

  /** Validate period format */
  validatePeriod?: boolean;

  /** Check for duplicate records */
  checkDuplicates?: boolean;

  /** Validate against redaction policy */
  validateRedaction?: boolean;

  /** Validate approval status */
  validateApprovals?: boolean;

  /** Minimum amount allowed (in stroops) */
  minAmount?: bigint;

  /** Maximum amount allowed (in stroops) */
  maxAmount?: bigint;

  /** Whether to allow zero amounts */
  allowZeroAmounts?: boolean;

  /** Maximum number of records per draft */
  maxRecordsPerDraft?: number;

  /** Whether to allow missing approvals */
  allowMissingApprovals?: boolean;

  /** Custom validators to run */
  customValidators?: Array<(draft: PayrollDraftData) => ValidationIssue[]>;
}

/**
 * Preset validation configurations.
 */
export const ValidationPresets = {
  /** Strict validation - catches all potential issues */
  strict: {
    validateEmployeeData: true,
    validateAssetFormat: true,
    validateAmounts: true,
    validatePeriod: true,
    checkDuplicates: true,
    validateRedaction: true,
    validateApprovals: true,
    minAmount: 10000000n, // Disallow zero and below-minimum amounts
    maxAmount: 100000000000n,
    maxRecordsPerDraft: 10000,
    allowMissingApprovals: false,
  } as ValidationConfig,

  /** Standard validation - catches obvious issues */
  standard: {
    validateEmployeeData: true,
    validateAssetFormat: true,
    validateAmounts: true,
    validatePeriod: true,
    checkDuplicates: true,
    validateRedaction: false,
    validateApprovals: false,
    minAmount: 0n,
    maxRecordsPerDraft: 100000,
    allowMissingApprovals: true,
  } as ValidationConfig,

  /** Lenient validation - catches only critical issues */
  lenient: {
    validateEmployeeData: true,
    validateAssetFormat: true,
    validateAmounts: true,
    validatePeriod: false,
    checkDuplicates: false,
    validateRedaction: false,
    validateApprovals: false,
    minAmount: 0n,
    maxRecordsPerDraft: 1000000,
    allowMissingApprovals: true,
  } as ValidationConfig,
};

/**
 * Default validation configuration.
 */
export const DefaultValidationConfig: ValidationConfig = ValidationPresets.standard;

/**
 * Validation error codes for programmatic handling.
 */
export const ValidationErrorCodes = {
  // Employee data issues
  INVALID_EMPLOYEE_ID: "ERR_INVALID_EMPLOYEE_ID",
  MISSING_EMPLOYEE_ID: "ERR_MISSING_EMPLOYEE_ID",
  INVALID_EMPLOYEE_NAME: "ERR_INVALID_EMPLOYEE_NAME",

  // Asset issues
  INVALID_ASSET_FORMAT: "ERR_INVALID_ASSET_FORMAT",
  UNSUPPORTED_ASSET: "ERR_UNSUPPORTED_ASSET",
  MISSING_ASSET: "ERR_MISSING_ASSET",

  // Amount issues
  INVALID_AMOUNT: "ERR_INVALID_AMOUNT",
  AMOUNT_EXCEEDS_MAX: "ERR_AMOUNT_EXCEEDS_MAX",
  AMOUNT_BELOW_MIN: "ERR_AMOUNT_BELOW_MIN",
  ZERO_AMOUNT_NOT_ALLOWED: "ERR_ZERO_AMOUNT_NOT_ALLOWED",
  NEGATIVE_AMOUNT: "ERR_NEGATIVE_AMOUNT",

  // Period issues
  INVALID_PERIOD_FORMAT: "ERR_INVALID_PERIOD_FORMAT",
  MISSING_PERIOD: "ERR_MISSING_PERIOD",

  // Duplicate issues
  DUPLICATE_RECORD: "ERR_DUPLICATE_RECORD",
  DUPLICATE_EMPLOYEE_IN_PERIOD: "ERR_DUPLICATE_EMPLOYEE_IN_PERIOD",

  // Redaction issues
  SENSITIVE_DATA_NOT_REDACTED: "ERR_SENSITIVE_DATA_NOT_REDACTED",
  REDACTION_POLICY_VIOLATION: "ERR_REDACTION_POLICY_VIOLATION",

  // Approval issues
  MISSING_REQUIRED_APPROVAL: "ERR_MISSING_REQUIRED_APPROVAL",
  INVALID_APPROVAL_METADATA: "ERR_INVALID_APPROVAL_METADATA",

  // Structure issues
  EMPTY_DRAFT: "ERR_EMPTY_DRAFT",
  TOO_MANY_RECORDS: "ERR_TOO_MANY_RECORDS",
  MISSING_DRAFT_ID: "ERR_MISSING_DRAFT_ID",
  MISSING_EMPLOYER: "ERR_MISSING_EMPLOYER",

  // Other issues
  INTERNAL_VALIDATION_ERROR: "ERR_INTERNAL_VALIDATION_ERROR",
};

/**
 * Summary of validation statistics.
 */
export interface ValidationStatistics {
  totalRecords: number;
  validRecords: number;
  recordsWithBlockers: number;
  recordsWithWarnings: number;
  totalBlockers: number;
  totalWarnings: number;
  blockersByCategory: Record<ValidationIssueCategory, number>;
  warningsByCategory: Record<ValidationIssueCategory, number>;
}
