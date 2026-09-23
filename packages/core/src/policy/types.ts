/**
 * Type definitions for the payroll policy compiler.
 *
 * The compiler turns a human-readable payroll policy configuration —
 * settlement windows in familiar units, capacity limits, reserve
 * requirements, and audit settings — into a validated, contract-call-ready
 * payload. Admins should never need to hand-format low-level policy structs.
 *
 * @module
 */

/** Machine-readable error codes for policy compilation failures. */
export enum PolicyCompileErrorCode {
  /** A required field is missing from the policy input. */
  MISSING_FIELD = "MISSING_FIELD",
  /** A settlement window value is invalid (non-positive, non-finite, or min > max). */
  INVALID_SETTLEMENT_WINDOW = "INVALID_SETTLEMENT_WINDOW",
  /** A capacity limit is invalid (negative, non-finite, or min > max). */
  INVALID_CAPACITY_LIMIT = "INVALID_CAPACITY_LIMIT",
  /** A reserve requirement is invalid (negative or exceeds the maximum capacity). */
  INVALID_RESERVE = "INVALID_RESERVE",
  /** Audit settings are inconsistent (e.g. retention shorter than required minimum). */
  INVALID_AUDIT_SETTINGS = "INVALID_AUDIT_SETTINGS",
  /** The asset identifier could not be normalized (delegates to `assetIdentity`). */
  INVALID_ASSET = "INVALID_ASSET",
}

/**
 * Structured error thrown when policy compilation fails.
 *
 * Carries a machine-readable `code`, the offending `field`, and optional
 * `context` so admins/dashboards can highlight exactly what to fix without
 * string-matching the message.
 */
export class PolicyCompileError extends Error {
  constructor(
    message: string,
    public readonly code: PolicyCompileErrorCode,
    public readonly field: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "PolicyCompileError";
  }
}

// ── Human-readable policy input ──────────────────────────────────────────────

/**
 * Settlement window configuration, expressed in whole seconds.
 *
 * The compiler converts these into the ledger-relative bounds the contract
 * expects; callers never need to reason about ledger sequence numbers.
 */
export interface SettlementWindowInput {
  /** Minimum time (seconds) that must elapse before a payroll run may settle. */
  minDelaySeconds: number;
  /** Maximum time (seconds) a payroll run may remain open before it expires. */
  maxOpenSeconds: number;
}

/** Capacity limits for a single payroll run. */
export interface CapacityLimitsInput {
  /** Maximum number of employee payments allowed in a single batch. */
  maxBatchSize: number;
  /** Maximum total payout amount per run, in the policy asset's smallest unit. */
  maxTotalPayout: bigint;
  /** Maximum payout to any single recipient, in the policy asset's smallest unit. */
  maxPerRecipientPayout: bigint;
}

/** Treasury reserve requirements enforced before a run may execute. */
export interface ReserveRequirementsInput {
  /** Minimum treasury balance that must remain after the run settles. */
  minReserveBalance: bigint;
  /** Whether the reserve check is enforced strictly (blocking) or advisory (warning only). */
  strict?: boolean;
}

/** Audit trail configuration for compiled policy runs. */
export interface AuditSettingsInput {
  /** Whether audit logging is required for runs under this policy. */
  auditRequired: boolean;
  /** Minimum number of days audit records must be retained. */
  retentionDays: number;
  /** Roles permitted to access the audit trail for this policy. */
  allowedViewerRoles?: string[];
}

/**
 * Human-readable payroll policy configuration, as an admin would author it.
 */
export interface PayrollPolicyInput {
  /** Stable identifier for this policy (e.g. `"default"`, `"contractors-eu"`). */
  policyId: string;
  /** Asset this policy governs — a loose identifier normalized via `normalizeAssetIdentity`. */
  asset: string;
  settlementWindow: SettlementWindowInput;
  capacityLimits: CapacityLimitsInput;
  reserveRequirements: ReserveRequirementsInput;
  auditSettings: AuditSettingsInput;
}

// ── Compiled contract-call payload ───────────────────────────────────────────

/**
 * Deterministic, validated payload ready to pass to a Soroban contract call
 * that provisions or updates a payroll policy.
 *
 * Field names and shapes are intentionally explicit (not 1:1 with
 * {@link PayrollPolicyInput}) so the compiled output is stable regardless of
 * how the human-readable input evolves.
 */
export interface CompiledPayrollPolicy {
  policyId: string;
  /** Canonical asset id, as produced by `normalizeAssetIdentity` (e.g. `"native"` or `"CODE:ISSUER"`). */
  assetId: string;
  settlement: {
    minDelaySeconds: number;
    maxOpenSeconds: number;
  };
  capacity: {
    maxBatchSize: number;
    maxTotalPayout: string;
    maxPerRecipientPayout: string;
  };
  reserve: {
    minReserveBalance: string;
    strict: boolean;
  };
  audit: {
    auditRequired: boolean;
    retentionDays: number;
    allowedViewerRoles: string[];
  };
  /** Compiler schema version — bump if the compiled shape changes incompatibly. */
  schemaVersion: 1;
}

/** Result of {@link compilePayrollPolicy}. */
export type CompilePolicyResult =
  { ok: true; value: CompiledPayrollPolicy } | { ok: false; errors: PolicyCompileError[] };
// ── Payroll Drafts ────────────────────────────────────────────────────────────

/** A single approval/signoff recorded against a payroll draft. */
export interface PayrollDraftApproval {
  approverId: string;
  approvedAt: string;
  signature?: string;
}

/** A single recipient line item within a payroll draft. */
export interface PayrollDraftRecipient {
  recipientId: string;
  amount: string;
}

/**
 * A payroll run in draft form — editable, comparable, and subject to
 * approval invalidation when its contents change after signoff.
 */
export interface PayrollDraft {
  draftId: string;
  totalAmount: string;
  asset: string;
  scheduleTimestamp: string;
  recipients: PayrollDraftRecipient[];
  policy: CompiledPayrollPolicy;
  approvals: PayrollDraftApproval[];
}

/** Result of comparing two {@link PayrollDraft} versions (see `batches/diff.ts`). */
export interface DraftComparisonResult {
  hasDifferences: boolean;
  changedFields: string[];
}

/** Result of {@link analyzeApprovalInvalidation} — whether prior approvals still hold. */
export interface InvalidationAnalysisResult {
  requiresReapproval: boolean;
  invalidatedApprovalsCount: number;
  reasons: string[];
  changedFields: string[];
}
