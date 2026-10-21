/**
 * Type definitions for the SDK payroll policy evaluator.
 *
 * A policy evaluation sits between a built payroll request and transaction
 * construction. It answers one question for integrators: *may this request
 * proceed, should it be reviewed, or must it be stopped?* — without touching
 * wallets, Soroban RPC, or the proof pipeline.
 *
 * Inputs intentionally contain only what the built-in policies need. Outputs
 * are privacy-safe by construction: issues never carry raw payroll amounts,
 * recipient addresses, employee identifiers, or notes.
 *
 * @module
 */

import type {
  PayrollPolicyCategory,
  PayrollPolicyIssueSeverity,
  PayrollPolicyOutcome,
  PayrollPolicyReasonCodeType,
} from "./reasonCodes";

/** Amounts accepted at the evaluator boundary. */
export type PayrollPolicyAmount = bigint | number | string;

/**
 * One payment line in a payroll request.
 *
 * Only `amount` is required. `employeeId` enables employee-status and
 * compliance policies; `recipient` is accepted for API familiarity but is
 * intentionally never echoed back in evaluation results or logs.
 */
export interface PayrollPolicyEntry {
  /** Stable employee identifier used to resolve status/compliance rules. */
  employeeId?: string;
  /** Destination address. Accepted but never included in results or logs. */
  recipient?: string;
  /** Payout amount in the asset's smallest unit. */
  amount: PayrollPolicyAmount;
  /** Asset identifier (e.g. `"native"`, `"USDC:ISSUER"`, or a contract id). */
  asset?: string;
}

/** Minimal employee snapshot needed by the built-in status policy. */
export interface PayrollPolicyEmployeeRecord {
  employeeId: string;
  status?: string;
  isBlocked?: boolean;
  isLocked?: boolean;
  complianceStatus?: string;
}

/** Employee records may be supplied as an array or an id-keyed record. */
export type PayrollPolicyEmployeeSource =
  readonly PayrollPolicyEmployeeRecord[] | Readonly<Record<string, PayrollPolicyEmployeeRecord>>;

/**
 * Network readiness snapshot supplied by the caller.
 *
 * The evaluator never queries the network itself; callers pass the result of
 * their existing RPC/wallet readiness checks.
 */
export interface PayrollPolicyNetworkReadiness {
  /** Connected network identifier (e.g. `"testnet"`, `"mainnet"`, `"futurenet"`). */
  network?: string;
  /** Whether the network/RPC client is ready to accept transactions. */
  ready?: boolean;
  /** Whether the payroll contract (or network) is paused. */
  paused?: boolean;
  /** Capabilities available in the current runtime (e.g. `"fetch"`, `"rpc_call"`). */
  capabilities?: readonly string[];
}

/** Complete input to a payroll policy evaluation. */
export interface PayrollPolicyEvaluationInput {
  entries: readonly PayrollPolicyEntry[];
  employees?: PayrollPolicyEmployeeSource;
  network?: PayrollPolicyNetworkReadiness;
}

/** Configurable rules for the per-payment and aggregate amount policy. */
export interface PayrollAmountPolicyRules {
  /** Minimum allowed amount per payment (inclusive). */
  minAmount?: PayrollPolicyAmount;
  /** Maximum allowed amount per payment (inclusive). */
  maxAmount?: PayrollPolicyAmount;
  /** Maximum allowed combined amount across all payments (inclusive). */
  maxTotalAmount?: PayrollPolicyAmount;
  /**
   * Percentage of a maximum at which a non-blocking warning is emitted.
   * Defaults to `90`. Set to `0` to disable near-limit warnings.
   */
  nearLimitWarningPercent?: number;
  /** Whether zero-amount entries are permitted. Defaults to `false`. */
  allowZero?: boolean;
}

/** Configurable rules for employee status and compliance checks. */
export interface PayrollEmployeeStatusPolicyRules {
  /** Statuses considered payable. Defaults to `["active"]`. */
  allowedStatuses?: readonly string[];
  /** Statuses that always block. Defaults to inactive/suspended/terminated. */
  blockedStatuses?: readonly string[];
  /** Statuses that emit a warning instead of blocking. Defaults to `["pending"]`. */
  warningStatuses?: readonly string[];
  /** Whether an entry without an employee id should block. Defaults to `false` (warning). */
  requireEmployeeId?: boolean;
  /** Whether a missing employee record should block. Defaults to `false` (warning). */
  requireEmployeeRecord?: boolean;
  /** Whether a locked employee payout blocks instead of warning. Defaults to `false`. */
  blockLockedEmployees?: boolean;
}

/** Configurable rules for the payment asset policy. */
export interface PayrollAssetPolicyRules {
  /** Canonical or loose asset identifiers permitted for this payroll. */
  allowedAssets?: readonly string[];
  /** Validate/normalize every entry's asset identifier. Defaults to `true`. */
  validateAssetIdentity?: boolean;
}

/** Configurable rules for network readiness. */
export interface PayrollNetworkPolicyRules {
  /** Network the payroll must be submitted on (e.g. `"testnet"`). */
  requiredNetwork?: string;
  /** Whether the network must report `ready: true`. Defaults to `false`. */
  requireReady?: boolean;
  /** Runtime capabilities that must be present. */
  requireCapabilities?: readonly string[];
  /** Whether `network.paused === true` blocks. Defaults to `true`. */
  blockWhenPaused?: boolean;
}

/**
 * Finding returned by a custom policy rule.
 *
 * Custom findings deliberately cannot carry arbitrary payloads — only the
 * fields below — so a custom rule cannot accidentally leak sensitive payroll
 * data into policy logs.
 */
export interface PayrollPolicyCustomFinding {
  /** `"warning"` for non-blocking review, `"block"` to stop submission. */
  outcome: PayrollPolicyIssueSeverity;
  /** Stable custom reason code (may use any string identifier). */
  code: string;
  /** Privacy-safe explanation. */
  message: string;
  /** Optional actionable remediation. */
  action?: string;
  /** Zero-based entry index this finding applies to, when applicable. */
  entryIndex?: number;
  /** Safe field/path reference (e.g. `"entries[0].employeeId"`). */
  field?: string;
}

/** A custom policy rule evaluated after the built-in policies. */
export interface PayrollPolicyCustomRule {
  /** Stable rule identifier, surfaced as `policyId` on emitted issues. */
  id: string;
  /** Category override; defaults to `"custom"`. */
  category?: PayrollPolicyCategory;
  /** Pure, synchronous evaluation. Return `null`/`undefined` for no finding. */
  evaluate(
    context: PayrollPolicyEvaluationContext
  ): PayrollPolicyCustomFinding | readonly PayrollPolicyCustomFinding[] | null | undefined;
}

/** Read-only context passed to custom policy rules. */
export interface PayrollPolicyEvaluationContext {
  entries: readonly PayrollPolicyEntry[];
  employees: ReadonlyMap<string, PayrollPolicyEmployeeRecord>;
  network?: PayrollPolicyNetworkReadiness;
  rules: PayrollPolicyRules;
  /** Epoch milliseconds used for deterministic evaluation. */
  referenceTime: number;
}

/** Complete set of configurable payroll policy rules. */
export interface PayrollPolicyRules {
  amount?: PayrollAmountPolicyRules;
  employeeStatus?: PayrollEmployeeStatusPolicyRules;
  asset?: PayrollAssetPolicyRules;
  network?: PayrollNetworkPolicyRules;
  custom?: readonly PayrollPolicyCustomRule[];
}

/** Options controlling an evaluation run. */
export interface PayrollPolicyEvaluationOptions {
  /** Subset of built-in policy categories to run. Defaults to all built-ins. */
  enabledPolicies?: readonly PayrollPolicyCategory[];
  /** Deterministic reference time (epoch ms, ISO string, or `Date`). */
  referenceTime?: number | string | Date;
}

/** A single policy issue. Contains no sensitive payroll values. */
export interface PayrollPolicyIssue {
  /** Identifier of the policy/rule that emitted the issue. */
  policyId: string;
  category: PayrollPolicyCategory;
  code: PayrollPolicyReasonCodeType | string;
  severity: PayrollPolicyIssueSeverity;
  /** Privacy-safe explanation (never includes amounts, addresses, or employee ids). */
  message: string;
  /** Actionable remediation guidance. */
  action: string;
  /** Safe field/path reference. */
  field?: string;
  /** Zero-based entry index the issue applies to, when applicable. */
  entryIndex?: number;
}

/** Counts summarising an evaluation run. */
export interface PayrollPolicyEvaluationSummary {
  totalEntries: number;
  totalIssues: number;
  warningCount: number;
  blockerCount: number;
  issuesByCategory: Record<PayrollPolicyCategory, number>;
}

/** Result of evaluating a payroll request against policy rules. */
export interface PayrollPolicyEvaluationResult {
  /** Aggregate outcome: `"pass"` when clean, `"warning"` for advisories, `"block"` for blockers. */
  outcome: PayrollPolicyOutcome;
  /** `true` when no blocking issue exists (warnings still pass). */
  passed: boolean;
  /** Convenience mirror of `outcome === "block"`. */
  blocked: boolean;
  /** All issues in deterministic policy order. */
  issues: PayrollPolicyIssue[];
  /** Non-blocking advisories only. */
  warnings: PayrollPolicyIssue[];
  /** Blocking issues only. */
  blockers: PayrollPolicyIssue[];
  /** Unique reason codes in first-emitted order. */
  reasonCodes: string[];
  summary: PayrollPolicyEvaluationSummary;
  /** Epoch milliseconds when the evaluation completed. */
  evaluatedAt: number;
}
