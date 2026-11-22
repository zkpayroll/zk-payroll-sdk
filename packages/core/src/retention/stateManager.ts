/**
 * Hardened Retention Policy State Handling (#913)
 *
 * Implements hardened lifecycle transitions, optimistic concurrency control,
 * statutory compliance checks, and hash-chained audit histories for retention
 * policy updates.
 *
 * @module
 */

import { createHash } from "crypto";
import {
  RetentionPolicy,
  RetentionPolicyStatus,
  RetentionPolicyUpdateInput,
  RetentionPolicyTransitionResult,
  RetentionPolicyValidationOptions,
  RETENTION_POLICY_STATUSES,
} from "./types";
import {
  RetentionPolicyError,
  RetentionPolicyErrorCode,
  RETENTION_POLICY_ERROR_MESSAGES,
} from "./errors";

// ── Constants ────────────────────────────────────────────────────────────────

export const RETENTION_GENESIS_PREVIOUS_HASH = "0".repeat(64);

/** Statutory retention floor: 7 years (2555 days). */
export const DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS = 2555;

export const ALLOWED_RETENTION_STATUS_TRANSITIONS: Readonly<
  Record<RetentionPolicyStatus, readonly RetentionPolicyStatus[]>
> = Object.freeze({
  draft: ["active", "suspended"],
  active: ["active", "superseded", "suspended"],
  suspended: ["active", "superseded"],
  superseded: [],
});

const SENSITIVE_KEYWORD_REGEX = /\b(salary|wage|balance|ssn|secret|private[_-]?key|password)\b/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function computeRetentionPolicyHash(policy: Omit<RetentionPolicy, "hash">): string {
  const parts = [
    "zkpayroll:retention-policy:v1",
    policy.policyId,
    String(policy.version),
    String(policy.retentionDays),
    String(policy.minimumRetentionDays),
    String(policy.maximumRetentionDays ?? ""),
    String(policy.legalHoldActive),
    policy.status,
    String(policy.effectiveAtMs),
    String(policy.updatedAtMs),
    policy.updatedBy,
    policy.updateReason,
    policy.previousHash,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v === "function" || typeof v === "symbol") continue;
    clean[k] = v;
  }
  return Object.keys(clean).length > 0 ? Object.freeze(clean) : undefined;
}

// ── State Validation & Transition Functions ──────────────────────────────────

/**
 * Validates and applies a state transition update to a retention policy.
 * Throws a typed {@link RetentionPolicyError} if any invariant is violated.
 *
 * @param current - Current active retention policy, or undefined when creating a new policy.
 * @param input - Proposed update inputs.
 * @param options - Configuration options for statutory checks and clock skew.
 * @returns The resulting transition result with the new frozen policy.
 */
export function applyRetentionPolicyUpdate(
  current: RetentionPolicy | null | undefined,
  input: RetentionPolicyUpdateInput,
  options: RetentionPolicyValidationOptions = {}
): RetentionPolicyTransitionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RetentionPolicyError(
      "Retention policy update input must be a non-null object.",
      RetentionPolicyErrorCode.POLICY_ID_REQUIRED
    );
  }

  // 1. Validate policyId
  if (typeof input.policyId !== "string" || input.policyId.trim().length === 0) {
    throw new RetentionPolicyError(
      RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.POLICY_ID_REQUIRED],
      RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
      { field: "policyId" }
    );
  }
  const policyId = input.policyId.trim();

  // 2. Validate actor
  if (typeof input.updatedBy !== "string" || input.updatedBy.trim().length === 0) {
    throw new RetentionPolicyError(
      RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.ACTOR_REQUIRED],
      RetentionPolicyErrorCode.ACTOR_REQUIRED,
      { field: "updatedBy" }
    );
  }
  const updatedBy = input.updatedBy.trim();

  // 3. Validate justification
  if (typeof input.updateReason !== "string" || input.updateReason.trim().length === 0) {
    throw new RetentionPolicyError(
      RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.REASON_REQUIRED],
      RetentionPolicyErrorCode.REASON_REQUIRED,
      { field: "updateReason" }
    );
  }
  const updateReason = input.updateReason.trim();

  // Check privacy on justification
  if (SENSITIVE_KEYWORD_REGEX.test(updateReason)) {
    throw new RetentionPolicyError(
      RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED],
      RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED,
      { field: "updateReason" }
    );
  }

  // 4. Concurrency & Version Check
  const expectedVersion = input.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new RetentionPolicyError(
      "Expected version must be a non-negative integer.",
      RetentionPolicyErrorCode.VERSION_MISMATCH,
      { expectedVersion }
    );
  }

  if (current) {
    if (current.policyId !== policyId) {
      throw new RetentionPolicyError(
        `Policy ID mismatch: current is "${current.policyId}", input targets "${policyId}".`,
        RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
        { currentPolicyId: current.policyId, targetPolicyId: policyId }
      );
    }
    if (current.version !== expectedVersion) {
      throw new RetentionPolicyError(
        `Version conflict: expected version ${expectedVersion}, but policy is currently at version ${current.version}.`,
        RetentionPolicyErrorCode.VERSION_MISMATCH,
        { expectedVersion, currentVersion: current.version }
      );
    }
    if (current.status === "superseded") {
      throw new RetentionPolicyError(
        "Cannot update a superseded retention policy. Superseded policies are immutable.",
        RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
        { currentStatus: current.status }
      );
    }
  } else {
    if (expectedVersion !== 0) {
      throw new RetentionPolicyError(
        `Cannot create initial policy with expectedVersion ${expectedVersion}; must be 0.`,
        RetentionPolicyErrorCode.VERSION_MISMATCH,
        { expectedVersion }
      );
    }
  }

  // 5. Lifecycle Status Transition
  const currentStatus: RetentionPolicyStatus = current ? current.status : "draft";
  const targetStatus: RetentionPolicyStatus = input.status ?? (current ? current.status : "active");

  if (!RETENTION_POLICY_STATUSES.includes(targetStatus)) {
    throw new RetentionPolicyError(
      `Target status "${targetStatus}" is not a recognized retention policy status.`,
      RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
      { targetStatus }
    );
  }

  if (current && targetStatus !== currentStatus) {
    const allowed = ALLOWED_RETENTION_STATUS_TRANSITIONS[currentStatus];
    if (!allowed.includes(targetStatus)) {
      throw new RetentionPolicyError(
        `Invalid status transition from "${currentStatus}" to "${targetStatus}".`,
        RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
        { from: currentStatus, to: targetStatus, allowed }
      );
    }
  }

  // 6. Timestamps & Clock Skew
  const now = options.now ?? Date.now();
  const maxClockSkew = options.maxClockSkewMs ?? 5000;
  const timestampMs = input.timestampMs ?? now;

  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    throw new RetentionPolicyError(
      RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.INVALID_TIMESTAMP],
      RetentionPolicyErrorCode.INVALID_TIMESTAMP,
      { timestampMs }
    );
  }

  if (timestampMs > now + maxClockSkew) {
    throw new RetentionPolicyError(
      "Update timestamp cannot be in the future beyond allowed clock skew.",
      RetentionPolicyErrorCode.INVALID_TIMESTAMP,
      { timestampMs, now }
    );
  }

  if (current && timestampMs < current.updatedAtMs) {
    throw new RetentionPolicyError(
      `Update timestamp (${timestampMs}) cannot regress before current update time (${current.updatedAtMs}).`,
      RetentionPolicyErrorCode.VERSION_REGRESSION,
      { timestampMs, currentUpdatedAtMs: current.updatedAtMs }
    );
  }

  const effectiveAtMs = input.effectiveAtMs ?? timestampMs;
  if (!Number.isFinite(effectiveAtMs) || effectiveAtMs <= 0) {
    throw new RetentionPolicyError(
      "Effective timestamp must be a valid positive epoch millisecond timestamp.",
      RetentionPolicyErrorCode.INVALID_TIMESTAMP,
      { effectiveAtMs }
    );
  }

  // 7. Retention Days & Statutory Bounds
  const statutoryFloor = options.statutoryFloorDays ?? DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS;

  const defaultDays = current ? current.retentionDays : statutoryFloor;
  const retentionDays = input.retentionDays ?? defaultDays;

  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
    throw new RetentionPolicyError(
      RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.INVALID_RETENTION_DAYS],
      RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
      { retentionDays }
    );
  }

  if (retentionDays < statutoryFloor) {
    throw new RetentionPolicyError(
      `Proposed retention duration (${retentionDays} days) violates statutory minimum floor of ${statutoryFloor} days.`,
      RetentionPolicyErrorCode.STATUTORY_MINIMUM_VIOLATION,
      { retentionDays, statutoryFloor }
    );
  }

  const minimumRetentionDays =
    input.minimumRetentionDays ?? (current ? current.minimumRetentionDays : statutoryFloor);
  if (!Number.isSafeInteger(minimumRetentionDays) || minimumRetentionDays <= 0) {
    throw new RetentionPolicyError(
      "Minimum retention days must be a positive integer.",
      RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
      { minimumRetentionDays }
    );
  }

  if (retentionDays < minimumRetentionDays) {
    throw new RetentionPolicyError(
      `Retention duration (${retentionDays} days) cannot be less than configured minimum retention window (${minimumRetentionDays} days).`,
      RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
      { retentionDays, minimumRetentionDays }
    );
  }

  const maximumRetentionDays =
    input.maximumRetentionDays ?? (current ? current.maximumRetentionDays : undefined);
  if (maximumRetentionDays !== undefined) {
    if (!Number.isSafeInteger(maximumRetentionDays) || maximumRetentionDays < retentionDays) {
      throw new RetentionPolicyError(
        `Maximum retention duration (${maximumRetentionDays} days) must be greater than or equal to retention duration (${retentionDays} days).`,
        RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
        { retentionDays, maximumRetentionDays }
      );
    }
  }

  // 8. Legal Hold Invariant Protection
  const currentLegalHold = current ? current.legalHoldActive : false;
  const targetLegalHold =
    input.legalHoldActive !== undefined ? Boolean(input.legalHoldActive) : currentLegalHold;

  if (currentLegalHold) {
    if (retentionDays < current!.retentionDays) {
      throw new RetentionPolicyError(
        RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT],
        RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT,
        { proposedDays: retentionDays, currentDays: current!.retentionDays }
      );
    }
    if (!targetLegalHold && !options.allowLegalHoldRelease) {
      throw new RetentionPolicyError(
        "Releasing an active legal hold requires explicit authorization flag (allowLegalHoldRelease).",
        RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT,
        { legalHoldActive: currentLegalHold }
      );
    }
  }

  // 9. No-op Detection
  if (current) {
    const isNoOp =
      current.retentionDays === retentionDays &&
      current.minimumRetentionDays === minimumRetentionDays &&
      current.maximumRetentionDays === maximumRetentionDays &&
      current.legalHoldActive === targetLegalHold &&
      current.status === targetStatus &&
      input.metadata === undefined;

    if (isNoOp) {
      throw new RetentionPolicyError(
        RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.NO_OP_UPDATE],
        RetentionPolicyErrorCode.NO_OP_UPDATE,
        { policyId }
      );
    }
  }

  // 10. Build New Immutable Version
  const nextVersion = current ? current.version + 1 : 1;
  const previousHash = current ? current.hash : RETENTION_GENESIS_PREVIOUS_HASH;

  const policyWithoutHash: Omit<RetentionPolicy, "hash"> = {
    policyId,
    version: nextVersion,
    retentionDays,
    minimumRetentionDays,
    ...(maximumRetentionDays !== undefined ? { maximumRetentionDays } : {}),
    legalHoldActive: targetLegalHold,
    status: targetStatus,
    effectiveAtMs,
    updatedAtMs: timestampMs,
    updatedBy,
    updateReason,
    previousHash,
    ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
  };

  const hash = computeRetentionPolicyHash(policyWithoutHash);
  const updatedPolicy: RetentionPolicy = Object.freeze({
    ...policyWithoutHash,
    hash,
  });

  return Object.freeze({
    success: true,
    previousPolicy: current ?? undefined,
    updatedPolicy,
    transitionHash: hash,
    appliedAtMs: timestampMs,
  });
}

/**
 * State manager maintaining policy versions and hash chains.
 */
export class RetentionPolicyStateManager {
  private readonly policies = new Map<string, RetentionPolicy>();
  private readonly history = new Map<string, RetentionPolicy[]>();

  constructor(initialPolicies: readonly RetentionPolicy[] = []) {
    for (const p of initialPolicies) {
      this.registerPolicy(p);
    }
  }

  public registerPolicy(policy: RetentionPolicy): void {
    this.policies.set(policy.policyId, Object.freeze(policy));
    const hist = this.history.get(policy.policyId) ?? [];
    hist.push(Object.freeze(policy));
    this.history.set(policy.policyId, hist);
  }

  public getPolicy(policyId: string): RetentionPolicy | undefined {
    return this.policies.get(policyId);
  }

  public async updatePolicy(
    input: RetentionPolicyUpdateInput,
    options: RetentionPolicyValidationOptions = {}
  ): Promise<RetentionPolicyTransitionResult> {
    const current = this.policies.get(input.policyId);
    if (!current && input.expectedVersion !== 0) {
      throw new RetentionPolicyError(
        `Policy "${input.policyId}" not found for update.`,
        RetentionPolicyErrorCode.POLICY_NOT_FOUND,
        { policyId: input.policyId }
      );
    }

    const result = applyRetentionPolicyUpdate(current, input, options);
    this.registerPolicy(result.updatedPolicy);
    return result;
  }

  public getHistory(policyId: string): readonly RetentionPolicy[] {
    return Object.freeze([...(this.history.get(policyId) ?? [])]);
  }

  public verifyHistoryIntegrity(policyId: string): {
    valid: boolean;
    brokenAt?: number;
    reason?: string;
  } {
    const hist = this.history.get(policyId);
    if (!hist || hist.length === 0) {
      return { valid: true };
    }

    for (let i = 0; i < hist.length; i++) {
      const entry = hist[i];
      const expectedPrev = i === 0 ? RETENTION_GENESIS_PREVIOUS_HASH : hist[i - 1].hash;

      if (entry.previousHash !== expectedPrev) {
        return {
          valid: false,
          brokenAt: i + 1,
          reason: `Hash link broken at revision ${entry.version}: expected previousHash ${expectedPrev}, found ${entry.previousHash}.`,
        };
      }

      const { hash, ...rest } = entry;
      const recomputed = computeRetentionPolicyHash(rest);
      if (recomputed !== hash) {
        return {
          valid: false,
          brokenAt: i + 1,
          reason: `Integrity check failed at revision ${entry.version}: hash mismatch.`,
        };
      }
    }

    return { valid: true };
  }
}
