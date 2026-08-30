import type { EligibilityReasonCodeType } from "./reasonCodes";

/**
 * Standard representation of an employee record evaluated for payroll eligibility.
 */
export interface EmployeeEligibilityRecord {
  /** Unique employee identifier */
  employeeId: string;
  /** Destination Stellar recipient address */
  recipient: string;
  /** Compensation payout amount in stroops/subunits */
  salary?: bigint;
  /** Alias for salary if using generic payment structures */
  amount?: bigint;
  /** Asset identifier or token contract address (e.g. "native" or Soroban contract ID) */
  asset?: string;
  /** Alias for asset */
  token?: string;
  /** Optional human-readable employee name */
  name?: string;
  /** Optional department or team identifier */
  department?: string;
  /** Employment lifecycle status (e.g. "active", "inactive", "suspended", "terminated") */
  status?: "active" | "inactive" | "suspended" | "terminated" | "pending" | string;
  /** Effective employment/eligibility start date (timestamp in ms, ISO string, or Date) */
  effectiveDate?: number | string | Date;
  /** Contract/eligibility expiry or end date (timestamp in ms, ISO string, or Date) */
  expiryDate?: number | string | Date;
  /** Whether the account is explicitly blocked by administration */
  isBlocked?: boolean;
  /** Whether the payout is locked by security or review controls */
  isLocked?: boolean;
  /** KYC / AML / compliance verification status */
  complianceStatus?: "passed" | "pending" | "failed" | "blocked" | string;
  /** Optional non-sensitive metadata for downstream integrations */
  metadata?: Record<string, unknown>;
}

export type EligibilityStatus = "eligible" | "ineligible" | "conditional";

export type EligibilitySeverity = "error" | "warning";

/**
 * Structured reason describing why an employee record is ineligible or has warnings.
 */
export interface EligibilityReason {
  /** Machine-readable typed reason code */
  code: EligibilityReasonCodeType | string;
  /** Human-readable explanation suitable for dashboards and backends */
  message: string;
  /** Field name associated with the condition (e.g. "recipient", "salary", "status") */
  field?: string;
  /** Severity level ("error" causes ineligibility, "warning" is advisory) */
  severity?: EligibilitySeverity;
  /** Suggested remediation action */
  action?: string;
  /** Non-sensitive details for explanation (never contains raw salaries or keys) */
  details?: Record<string, unknown>;
}

/**
 * Structured evaluation result for a single employee record.
 */
export interface EmployeeEligibilityResult {
  /** The employee identifier */
  employeeId: string;
  /** Destination recipient address */
  recipient: string;
  /** Whether the employee passed all eligibility checks */
  isEligible: boolean;
  /** Overall categorical status */
  status: EligibilityStatus;
  /** List of all ineligibility reasons or warnings */
  reasons: EligibilityReason[];
  /** Primary blocker reason code if ineligible */
  primaryReasonCode?: EligibilityReasonCodeType | string;
  /** Epoch timestamp in milliseconds when evaluation occurred */
  evaluatedAt: number;
}

/**
 * Context provided to eligibility rule evaluators.
 */
export interface EligibilityRuleContext {
  /** Timestamp in milliseconds to treat as "now" for date boundary checks */
  referenceTimestamp: number;
  /** Active evaluation configuration options */
  options: EligibilityEvaluationOptions;
  /** Full batch records array when evaluating a batch */
  batchRecords?: EmployeeEligibilityRecord[];
  /** Zero-based index of the current record within the batch */
  index?: number;
}

/**
 * Function interface for custom eligibility rules.
 */
export type EligibilityRuleFn = (
  record: EmployeeEligibilityRecord,
  context: EligibilityRuleContext
) =>
  | EligibilityReason
  | EligibilityReason[]
  | null
  | undefined
  | Promise<EligibilityReason | EligibilityReason[] | null | undefined>;

/**
 * Configuration options for employee eligibility evaluation.
 */
export interface EligibilityEvaluationOptions {
  /** Reference timestamp (ms or Date) for time-bound checks. Defaults to Date.now(). */
  referenceTimestamp?: number | Date;
  /** Whitelist of acceptable asset identifiers (e.g. ["native", "CD..."]). */
  allowedAssets?: string[];
  /** Minimum acceptable salary amount in stroops. */
  minSalary?: bigint;
  /** Maximum acceptable salary amount in stroops. */
  maxSalary?: bigint;
  /** Whether to strictly enforce Stellar G-address public key format. Defaults to true. */
  requireValidStellarAddress?: boolean;
  /** Allowed employment statuses. Defaults to ["active"]. */
  allowedStatuses?: string[];
  /** Enforce strict compliance checks (reject pending/failed). Defaults to true. */
  strictCompliance?: boolean;
  /** Check for duplicate employee IDs or recipients in batches. Defaults to true. */
  checkDuplicates?: boolean;
  /** Additional custom evaluation rule functions. */
  customRules?: EligibilityRuleFn[];
  /** Optional on-chain Soroban registry integration options for live verification. */
  onChainRegistry?: {
    client: {
      getRegistry(
        employer: string,
        employee: string,
        signer?: unknown,
        network?: string
      ): Promise<
        | { active: boolean; salary: bigint; token: string; [key: string]: unknown }
        | null
        | undefined
      >;
      registryExists?(
        employer: string,
        employee: string,
        signer?: unknown,
        network?: string
      ): Promise<boolean>;
    };
    employer: string;
    signer?: unknown;
    network?: string;
    verifySalaryMatch?: boolean;
    verifyTokenMatch?: boolean;
  };
}

/**
 * Aggregated eligibility result for a batch of employee records.
 */
export interface BatchEligibilityResult {
  /** Total number of records evaluated */
  totalRecords: number;
  /** Count of records deemed eligible */
  eligibleCount: number;
  /** Count of records deemed ineligible */
  ineligibleCount: number;
  /** List of eligible employee records */
  eligibleRecords: EmployeeEligibilityRecord[];
  /** Ineligible employee records paired with their specific result */
  ineligibleRecords: Array<{
    record: EmployeeEligibilityRecord;
    result: EmployeeEligibilityResult;
  }>;
  /** All evaluation results in original batch order */
  results: EmployeeEligibilityResult[];
  /** Frequency count of each reason code encountered across the batch */
  reasonCodeSummary: Record<EligibilityReasonCodeType | string, number>;
  /** Timestamp when evaluation completed */
  evaluatedAt: number;
}

/**
 * Configuration options for generating exported eligibility reports.
 */
export interface EligibilityReportOptions {
  /** Redact sensitive payroll values (salaries/keys). Defaults to true. */
  redactSensitive?: boolean;
  /** Placeholder text for redacted values. Defaults to "[redacted]". */
  placeholder?: string;
  /** Include detailed remediation actions. Defaults to true. */
  includeActions?: boolean;
  /** Include custom details dictionary. Defaults to false. */
  includeDetails?: boolean;
}

/**
 * Exported diagnostic report structure suitable for dashboards and logging.
 */
export interface EligibilityDiagnosticReport {
  timestamp: number;
  totalEvaluated: number;
  eligibleCount: number;
  ineligibleCount: number;
  reasonSummary: Record<string, number>;
  blockedEmployees: Array<{
    employeeId: string;
    recipient: string;
    reasons: Array<{
      code: string;
      message: string;
      action?: string;
    }>;
  }>;
}
