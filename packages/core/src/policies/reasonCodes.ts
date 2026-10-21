/**
 * Payroll policy reason codes.
 *
 * Every policy failure and advisory carries a stable, machine-readable reason
 * code plus actionable remediation guidance. Codes are grouped by the built-in
 * policy category that produces them so dashboards, CLIs, and integrators can
 * branch on them without parsing human-readable messages.
 *
 * @module
 */

/** Built-in policy categories evaluated by {@link PayrollPolicyEvaluator}. */
export type PayrollPolicyCategory = "amount" | "employee_status" | "asset" | "network" | "custom";

/** Aggregate result of evaluating a payroll request against policy rules. */
export type PayrollPolicyOutcome = "pass" | "warning" | "block";

/** Severity carried by an individual policy issue (never `"pass"`). */
export type PayrollPolicyIssueSeverity = Exclude<PayrollPolicyOutcome, "pass">;

/** Stable reason codes emitted by the built-in payroll policies. */
export const PayrollPolicyReasonCode = {
  // ── Amount policy ────────────────────────────────────────────────────────
  AMOUNT_INVALID: "AMOUNT_INVALID",
  AMOUNT_NOT_POSITIVE: "AMOUNT_NOT_POSITIVE",
  AMOUNT_BELOW_MINIMUM: "AMOUNT_BELOW_MINIMUM",
  AMOUNT_EXCEEDS_MAXIMUM: "AMOUNT_EXCEEDS_MAXIMUM",
  AMOUNT_NEAR_MAXIMUM: "AMOUNT_NEAR_MAXIMUM",
  TOTAL_EXCEEDS_MAXIMUM: "TOTAL_EXCEEDS_MAXIMUM",
  TOTAL_NEAR_MAXIMUM: "TOTAL_NEAR_MAXIMUM",

  // ── Employee status policy ───────────────────────────────────────────────
  EMPLOYEE_ID_MISSING: "EMPLOYEE_ID_MISSING",
  EMPLOYEE_NOT_FOUND: "EMPLOYEE_NOT_FOUND",
  EMPLOYEE_BLOCKED: "EMPLOYEE_BLOCKED",
  EMPLOYEE_LOCKED: "EMPLOYEE_LOCKED",
  EMPLOYEE_INACTIVE: "EMPLOYEE_INACTIVE",
  EMPLOYEE_SUSPENDED: "EMPLOYEE_SUSPENDED",
  EMPLOYEE_TERMINATED: "EMPLOYEE_TERMINATED",
  EMPLOYEE_PENDING: "EMPLOYEE_PENDING",
  EMPLOYEE_STATUS_NOT_ALLOWED: "EMPLOYEE_STATUS_NOT_ALLOWED",
  EMPLOYEE_COMPLIANCE_PENDING: "EMPLOYEE_COMPLIANCE_PENDING",
  EMPLOYEE_COMPLIANCE_FAILED: "EMPLOYEE_COMPLIANCE_FAILED",

  // ── Asset policy ─────────────────────────────────────────────────────────
  ASSET_MISSING: "ASSET_MISSING",
  ASSET_INVALID: "ASSET_INVALID",
  ASSET_NOT_ALLOWED: "ASSET_NOT_ALLOWED",

  // ── Network readiness policy ─────────────────────────────────────────────
  NETWORK_NOT_CONFIGURED: "NETWORK_NOT_CONFIGURED",
  NETWORK_MISMATCH: "NETWORK_MISMATCH",
  NETWORK_NOT_READY: "NETWORK_NOT_READY",
  NETWORK_PAUSED: "NETWORK_PAUSED",
  NETWORK_CAPABILITY_MISSING: "NETWORK_CAPABILITY_MISSING",

  // ── Custom / extensible rules ────────────────────────────────────────────
  CUSTOM_RULE_WARNING: "CUSTOM_RULE_WARNING",
  CUSTOM_RULE_BLOCKED: "CUSTOM_RULE_BLOCKED",
} as const;

/** Union of every built-in {@link PayrollPolicyReasonCode} value. */
export type PayrollPolicyReasonCodeType =
  (typeof PayrollPolicyReasonCode)[keyof typeof PayrollPolicyReasonCode];

/** Metadata describing a single payroll policy reason code. */
export interface PayrollPolicyReasonMetadata {
  /** The stable reason code. */
  code: PayrollPolicyReasonCodeType;
  /** Policy category that emits this code. */
  category: PayrollPolicyCategory;
  /** Privacy-safe explanation of the failure. */
  description: string;
  /** Actionable remediation for the integrator/operator. */
  suggestedAction: string;
  /** Default severity when the policy emits this code. */
  severity: PayrollPolicyIssueSeverity;
  /** Whether re-evaluating after external changes may resolve the issue. */
  retryable: boolean;
}

/**
 * Registry of every built-in payroll policy reason code, its default severity,
 * and the action a caller should take to resolve it.
 */
export const PAYROLL_POLICY_REASON_REGISTRY: Record<
  PayrollPolicyReasonCodeType,
  PayrollPolicyReasonMetadata
> = {
  // ── Amount ───────────────────────────────────────────────────────────────
  [PayrollPolicyReasonCode.AMOUNT_INVALID]: {
    code: PayrollPolicyReasonCode.AMOUNT_INVALID,
    category: "amount",
    description: "A payment amount is not a valid non-negative integer.",
    suggestedAction: "Provide each payment amount as a whole number in the asset's smallest unit.",
    severity: "block",
    retryable: false,
  },
  [PayrollPolicyReasonCode.AMOUNT_NOT_POSITIVE]: {
    code: PayrollPolicyReasonCode.AMOUNT_NOT_POSITIVE,
    category: "amount",
    description: "A payment amount is zero or negative.",
    suggestedAction: "Set a positive payout amount or remove the entry from the payroll request.",
    severity: "block",
    retryable: false,
  },
  [PayrollPolicyReasonCode.AMOUNT_BELOW_MINIMUM]: {
    code: PayrollPolicyReasonCode.AMOUNT_BELOW_MINIMUM,
    category: "amount",
    description: "A payment amount is below the configured minimum.",
    suggestedAction: "Raise the payout to at least the policy minimum or exclude the entry.",
    severity: "block",
    retryable: false,
  },
  [PayrollPolicyReasonCode.AMOUNT_EXCEEDS_MAXIMUM]: {
    code: PayrollPolicyReasonCode.AMOUNT_EXCEEDS_MAXIMUM,
    category: "amount",
    description: "A payment amount exceeds the configured per-payment maximum.",
    suggestedAction: "Split the payout or request a policy limit increase before submitting.",
    severity: "block",
    retryable: false,
  },
  [PayrollPolicyReasonCode.AMOUNT_NEAR_MAXIMUM]: {
    code: PayrollPolicyReasonCode.AMOUNT_NEAR_MAXIMUM,
    category: "amount",
    description: "A payment amount is close to the configured per-payment maximum.",
    suggestedAction: "Review the payout for accuracy before submitting; no change is required.",
    severity: "warning",
    retryable: false,
  },
  [PayrollPolicyReasonCode.TOTAL_EXCEEDS_MAXIMUM]: {
    code: PayrollPolicyReasonCode.TOTAL_EXCEEDS_MAXIMUM,
    category: "amount",
    description: "The combined payroll total exceeds the configured run maximum.",
    suggestedAction: "Split the payroll into smaller runs or request a policy limit increase.",
    severity: "block",
    retryable: false,
  },
  [PayrollPolicyReasonCode.TOTAL_NEAR_MAXIMUM]: {
    code: PayrollPolicyReasonCode.TOTAL_NEAR_MAXIMUM,
    category: "amount",
    description: "The combined payroll total is close to the configured run maximum.",
    suggestedAction: "Confirm the payroll total is correct before submitting.",
    severity: "warning",
    retryable: false,
  },

  // ── Employee status ──────────────────────────────────────────────────────
  [PayrollPolicyReasonCode.EMPLOYEE_ID_MISSING]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_ID_MISSING,
    category: "employee_status",
    description: "A payroll entry does not include an employee identifier.",
    suggestedAction: "Attach the employee identifier so status and compliance policies can run.",
    severity: "warning",
    retryable: false,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_NOT_FOUND]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_NOT_FOUND,
    category: "employee_status",
    description: "No employee record could be resolved for a payroll entry.",
    suggestedAction: "Load the employee record or remove the entry before submitting payroll.",
    severity: "warning",
    retryable: true,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_BLOCKED]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_BLOCKED,
    category: "employee_status",
    description: "The employee is administratively blocked from receiving payouts.",
    suggestedAction: "Resolve the block in the payroll system before processing this payout.",
    severity: "block",
    retryable: true,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_LOCKED]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_LOCKED,
    category: "employee_status",
    description: "The employee's payout is locked pending review.",
    suggestedAction: "Complete the required review or unlock the employee before submitting.",
    severity: "warning",
    retryable: true,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_INACTIVE]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_INACTIVE,
    category: "employee_status",
    description: "The employee is inactive and cannot receive a standard payroll payout.",
    suggestedAction: "Activate the employee or route the payment through an off-cycle workflow.",
    severity: "block",
    retryable: true,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_SUSPENDED]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_SUSPENDED,
    category: "employee_status",
    description: "The employee is currently suspended.",
    suggestedAction: "Resolve the suspension or use the suspension payout workflow.",
    severity: "block",
    retryable: true,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_TERMINATED]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_TERMINATED,
    category: "employee_status",
    description: "The employee is terminated and not eligible for a standard payroll run.",
    suggestedAction: "Process any final settlement through the dedicated termination workflow.",
    severity: "block",
    retryable: false,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_PENDING]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_PENDING,
    category: "employee_status",
    description: "The employee's status is still pending activation.",
    suggestedAction: "Wait for onboarding to complete or confirm the effective date before paying.",
    severity: "warning",
    retryable: true,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_STATUS_NOT_ALLOWED]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_STATUS_NOT_ALLOWED,
    category: "employee_status",
    description: "The employee's status is not permitted by the configured policy.",
    suggestedAction: "Update the employee status or adjust the policy's allowed statuses.",
    severity: "block",
    retryable: true,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_COMPLIANCE_PENDING]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_COMPLIANCE_PENDING,
    category: "employee_status",
    description: "The employee's compliance review is still pending.",
    suggestedAction: "Wait for compliance approval before submitting the payout.",
    severity: "warning",
    retryable: true,
  },
  [PayrollPolicyReasonCode.EMPLOYEE_COMPLIANCE_FAILED]: {
    code: PayrollPolicyReasonCode.EMPLOYEE_COMPLIANCE_FAILED,
    category: "employee_status",
    description: "The employee failed a required compliance check.",
    suggestedAction: "Resolve the compliance failure before submitting the payout.",
    severity: "block",
    retryable: false,
  },

  // ── Asset ────────────────────────────────────────────────────────────────
  [PayrollPolicyReasonCode.ASSET_MISSING]: {
    code: PayrollPolicyReasonCode.ASSET_MISSING,
    category: "asset",
    description: "A payroll entry does not specify a payment asset.",
    suggestedAction: "Specify a supported asset identifier for every payroll entry.",
    severity: "block",
    retryable: false,
  },
  [PayrollPolicyReasonCode.ASSET_INVALID]: {
    code: PayrollPolicyReasonCode.ASSET_INVALID,
    category: "asset",
    description: "A payroll entry references an asset identifier that cannot be normalized.",
    suggestedAction:
      'Use "native", a "CODE:ISSUER" pair, or a valid Soroban token contract address.',
    severity: "block",
    retryable: false,
  },
  [PayrollPolicyReasonCode.ASSET_NOT_ALLOWED]: {
    code: PayrollPolicyReasonCode.ASSET_NOT_ALLOWED,
    category: "asset",
    description: "A payroll entry uses an asset that is not permitted by the policy.",
    suggestedAction: "Switch to an allowlisted asset or update the policy asset allowlist.",
    severity: "block",
    retryable: false,
  },

  // ── Network readiness ────────────────────────────────────────────────────
  [PayrollPolicyReasonCode.NETWORK_NOT_CONFIGURED]: {
    code: PayrollPolicyReasonCode.NETWORK_NOT_CONFIGURED,
    category: "network",
    description: "Network readiness information was required but not supplied.",
    suggestedAction: "Provide a network readiness snapshot before evaluating the payroll request.",
    severity: "block",
    retryable: true,
  },
  [PayrollPolicyReasonCode.NETWORK_MISMATCH]: {
    code: PayrollPolicyReasonCode.NETWORK_MISMATCH,
    category: "network",
    description: "The connected network does not match the policy's required network.",
    suggestedAction: "Switch the wallet or RPC connection to the required network.",
    severity: "block",
    retryable: true,
  },
  [PayrollPolicyReasonCode.NETWORK_NOT_READY]: {
    code: PayrollPolicyReasonCode.NETWORK_NOT_READY,
    category: "network",
    description: "The network is not ready to accept payroll transactions.",
    suggestedAction: "Wait for the network or RPC client to become ready and re-evaluate.",
    severity: "block",
    retryable: true,
  },
  [PayrollPolicyReasonCode.NETWORK_PAUSED]: {
    code: PayrollPolicyReasonCode.NETWORK_PAUSED,
    category: "network",
    description: "The payroll contract or network is currently paused.",
    suggestedAction: "Wait for the pause to be lifted before submitting payroll.",
    severity: "block",
    retryable: true,
  },
  [PayrollPolicyReasonCode.NETWORK_CAPABILITY_MISSING]: {
    code: PayrollPolicyReasonCode.NETWORK_CAPABILITY_MISSING,
    category: "network",
    description: "The runtime is missing a network capability required by the policy.",
    suggestedAction: "Run the SDK in a supported environment or enable the required capability.",
    severity: "block",
    retryable: true,
  },

  // ── Custom ───────────────────────────────────────────────────────────────
  [PayrollPolicyReasonCode.CUSTOM_RULE_WARNING]: {
    code: PayrollPolicyReasonCode.CUSTOM_RULE_WARNING,
    category: "custom",
    description: "A custom payroll policy rule produced a non-blocking warning.",
    suggestedAction: "Review the custom rule guidance before submitting the payroll request.",
    severity: "warning",
    retryable: false,
  },
  [PayrollPolicyReasonCode.CUSTOM_RULE_BLOCKED]: {
    code: PayrollPolicyReasonCode.CUSTOM_RULE_BLOCKED,
    category: "custom",
    description: "A custom payroll policy rule blocked the payroll request.",
    suggestedAction: "Resolve the custom rule failure before submitting the payroll request.",
    severity: "block",
    retryable: false,
  },
};

/**
 * Looks up metadata for a reason code, returning `undefined` for unknown or
 * custom (string) codes.
 */
export function getPayrollPolicyReasonMetadata(
  code: string
): PayrollPolicyReasonMetadata | undefined {
  if (Object.prototype.hasOwnProperty.call(PAYROLL_POLICY_REASON_REGISTRY, code)) {
    return PAYROLL_POLICY_REASON_REGISTRY[code as PayrollPolicyReasonCodeType];
  }
  return undefined;
}

/** Returns `true` when `code` is a built-in {@link PayrollPolicyReasonCode}. */
export function isPayrollPolicyReasonCode(code: string): code is PayrollPolicyReasonCodeType {
  return Object.prototype.hasOwnProperty.call(PAYROLL_POLICY_REASON_REGISTRY, code);
}

/** Returns every built-in reason code belonging to `category`. */
export function getPayrollPolicyReasonCodesByCategory(
  category: PayrollPolicyCategory
): PayrollPolicyReasonCodeType[] {
  return (Object.keys(PAYROLL_POLICY_REASON_REGISTRY) as PayrollPolicyReasonCodeType[]).filter(
    (code) => PAYROLL_POLICY_REASON_REGISTRY[code].category === category
  );
}
