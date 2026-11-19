/**
 * Retention Policy Types (#913)
 *
 * Types and interfaces for hardened retention policy lifecycle management,
 * versioned transitions, and tamper-evident audit chains.
 *
 * @module
 */

/**
 * Valid lifecycle states for a retention policy.
 */
export const RETENTION_POLICY_STATUSES = [
  "draft",
  "active",
  "superseded",
  "suspended",
] as const;

export type RetentionPolicyStatus = (typeof RETENTION_POLICY_STATUSES)[number];

/**
 * An immutable, versioned retention policy snapshot.
 */
export interface RetentionPolicy {
  /** Unique identifier of the retention policy (e.g. org or payroll scope). */
  readonly policyId: string;
  /** Monotonically increasing revision number (starts at 1). */
  readonly version: number;
  /** Mandatory retention duration in days. */
  readonly retentionDays: number;
  /** Statutory minimum retention window in days. */
  readonly minimumRetentionDays: number;
  /** Optional maximum retention window in days. */
  readonly maximumRetentionDays?: number;
  /** Flag indicating an active legal hold is in effect. */
  readonly legalHoldActive: boolean;
  /** Current lifecycle status. */
  readonly status: RetentionPolicyStatus;
  /** Effective start time of this revision in epoch milliseconds. */
  readonly effectiveAtMs: number;
  /** When this revision was recorded in epoch milliseconds. */
  readonly updatedAtMs: number;
  /** Operator or compliance officer identity who authorized the update. */
  readonly updatedBy: string;
  /** Audit justification for the update. */
  readonly updateReason: string;
  /** Hash linking this revision to its predecessor. */
  readonly hash: string;
  /** Hash of the previous revision ("000...000" for genesis). */
  readonly previousHash: string;
  /** Optional sanitized configuration metadata. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Input for proposing a retention policy update.
 */
export interface RetentionPolicyUpdateInput {
  /** Target policy identifier. */
  policyId: string;
  /** Expected version for optimistic concurrency control (0 for new policy). */
  expectedVersion: number;
  /** Proposed retention duration in days. */
  retentionDays?: number;
  /** Proposed statutory minimum retention duration in days. */
  minimumRetentionDays?: number;
  /** Proposed maximum retention duration in days. */
  maximumRetentionDays?: number;
  /** Proposed legal hold status. */
  legalHoldActive?: boolean;
  /** Target lifecycle status (e.g. 'active', 'suspended'). */
  status?: RetentionPolicyStatus;
  /** Identity of the actor requesting the update. */
  updatedBy: string;
  /** Mandatory human-readable operational reason. */
  updateReason: string;
  /** Timestamp in epoch ms when the update occurred (defaults to now). */
  timestampMs?: number;
  /** When the policy update becomes effective (defaults to timestampMs). */
  effectiveAtMs?: number;
  /** Optional metadata properties. */
  metadata?: Record<string, unknown>;
}

/**
 * Result of an atomic retention policy transition.
 */
export interface RetentionPolicyTransitionResult {
  readonly success: boolean;
  readonly previousPolicy?: RetentionPolicy;
  readonly updatedPolicy: RetentionPolicy;
  readonly transitionHash: string;
  readonly appliedAtMs: number;
}

/**
 * Options for configuring retention policy validation.
 */
export interface RetentionPolicyValidationOptions {
  /** Statutory floor in days below which retention cannot be reduced (default 2555 = 7 years). */
  statutoryFloorDays?: number;
  /** Allow releasing a legal hold (requires explicit authorization flag). */
  allowLegalHoldRelease?: boolean;
  /** Reference current time in milliseconds. */
  now?: number;
  /** Max clock skew allowed for future timestamps in ms. */
  maxClockSkewMs?: number;
}
