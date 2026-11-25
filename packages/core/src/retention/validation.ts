/**
 * Typed Validation for Retention Policy Updates (#909, #910)
 *
 * Non-throwing and throwing validation helpers for retention policy updates
 * and persisted policy snapshots. Validation accumulates structural issues and
 * never exposes sensitive payroll data in messages or contexts.
 *
 * @module
 */

import {
  applyRetentionPolicyUpdate,
  computeRetentionPolicyHash,
  DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS,
  RETENTION_GENESIS_PREVIOUS_HASH,
} from "./stateManager";
import {
  formatRetentionPolicyError,
  RetentionPolicyError,
  RetentionPolicyErrorCode,
  RETENTION_POLICY_ERROR_MESSAGES,
  redactPolicyActorId,
} from "./errors";
import {
  RETENTION_POLICY_STATUSES,
  RetentionPolicy,
  RetentionPolicyStatus,
  RetentionPolicyTransitionResult,
  RetentionPolicyUpdateInput,
  RetentionPolicyValidationOptions,
} from "./types";

export const MAX_RETENTION_POLICY_ID_LENGTH = 200;
export const MAX_RETENTION_ACTOR_LENGTH = 200;
export const MAX_RETENTION_REASON_LENGTH = 1000;
export const MAX_RETENTION_DAYS = 365000; // ~1000 years, sanity upper bound

const SENSITIVE_KEYWORD_REGEX = /(salary|wage|balance|ssn|secret|private[_-]?key|password)/i;

export interface RetentionPolicyValidationIssue {
  readonly code: RetentionPolicyErrorCode;
  readonly field: string;
  readonly message: string;
  readonly suggestedFix?: string;
}

export interface RetentionPolicyUpdateValidationResult {
  readonly isValid: boolean;
  readonly issues: readonly RetentionPolicyValidationIssue[];
  readonly transition?: RetentionPolicyTransitionResult;
  readonly policy?: RetentionPolicy;
}

export interface RetentionPolicyStateValidationResult {
  readonly isValid: boolean;
  readonly issues: readonly RetentionPolicyValidationIssue[];
  readonly policy?: RetentionPolicy;
}

function issue(
  code: RetentionPolicyErrorCode,
  field: string,
  message = RETENTION_POLICY_ERROR_MESSAGES[code],
  suggestedFix?: string
): RetentionPolicyValidationIssue {
  return Object.freeze({ code, field, message, suggestedFix });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function containsSensitiveString(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === "string") return SENSITIVE_KEYWORD_REGEX.test(value);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((v) => containsSensitiveString(v, seen));
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYWORD_REGEX.test(k)) return true;
    if (containsSensitiveString(v, seen)) return true;
  }
  return false;
}

function validateIdentifier(
  value: unknown,
  field: string,
  code: RetentionPolicyErrorCode,
  maxLength: number
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return undefined;
  return trimmed;
}

function addIdIssue(
  issues: RetentionPolicyValidationIssue[],
  value: unknown,
  field: string,
  code: RetentionPolicyErrorCode,
  maxLength: number,
  suggestedFix: string
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue(code, field, RETENTION_POLICY_ERROR_MESSAGES[code], suggestedFix));
    return;
  }
  if (value.trim().length > maxLength) {
    issues.push(
      issue(
        code,
        field,
        `${field} must be at most ${maxLength} characters.`,
        `Provide a ${field} value with ${maxLength} characters or fewer.`
      )
    );
  }
}

function validateRetentionDaysValue(
  value: unknown,
  field: string,
  issues: RetentionPolicyValidationIssue[],
  required: boolean
): number | undefined {
  if (value === undefined) {
    if (required) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
          field,
          RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.INVALID_RETENTION_DAYS],
          `Provide ${field} as a positive integer.`
        )
      );
    }
    return undefined;
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAX_RETENTION_DAYS
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
        field,
        `${field} must be a positive integer within allowed bounds.`,
        `Provide ${field} as an integer between 1 and ${MAX_RETENTION_DAYS}.`
      )
    );
    return undefined;
  }
  return value as number;
}

export function validateRetentionPolicyUpdate(
  current: RetentionPolicy | null | undefined,
  input: unknown,
  options: RetentionPolicyValidationOptions = {}
): RetentionPolicyUpdateValidationResult {
  const issues: RetentionPolicyValidationIssue[] = [];

  if (!isPlainObject(input)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
        "input",
        "Retention policy update input must be a non-null object.",
        "Provide a retention policy update object."
      )
    );
    return Object.freeze({ isValid: false, issues: Object.freeze(issues) });
  }

  const raw = input as Record<string, unknown>;
  const update = raw as unknown as RetentionPolicyUpdateInput;

  addIdIssue(
    issues,
    raw.policyId,
    "policyId",
    RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
    MAX_RETENTION_POLICY_ID_LENGTH,
    "Provide a non-empty retention policy identifier."
  );
  addIdIssue(
    issues,
    raw.updatedBy,
    "updatedBy",
    RetentionPolicyErrorCode.ACTOR_REQUIRED,
    MAX_RETENTION_ACTOR_LENGTH,
    "Provide the operator identity responsible for the change."
  );
  addIdIssue(
    issues,
    raw.updateReason,
    "updateReason",
    RetentionPolicyErrorCode.REASON_REQUIRED,
    MAX_RETENTION_REASON_LENGTH,
    "Provide an operational justification for the policy change."
  );

  const policyId = validateIdentifier(
    raw.policyId,
    "policyId",
    RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
    MAX_RETENTION_POLICY_ID_LENGTH
  );
  const updatedBy = validateIdentifier(
    raw.updatedBy,
    "updatedBy",
    RetentionPolicyErrorCode.ACTOR_REQUIRED,
    MAX_RETENTION_ACTOR_LENGTH
  );
  const updateReason = validateIdentifier(
    raw.updateReason,
    "updateReason",
    RetentionPolicyErrorCode.REASON_REQUIRED,
    MAX_RETENTION_REASON_LENGTH
  );

  if (updateReason && SENSITIVE_KEYWORD_REGEX.test(updateReason)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED,
        "updateReason",
        RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED],
        "Remove sensitive payroll or credential terminology from the justification."
      )
    );
  }
  if (updatedBy && SENSITIVE_KEYWORD_REGEX.test(updatedBy)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED,
        "updatedBy",
        "Actor identity contains prohibited sensitive terminology.",
        "Use an opaque operator identifier without sensitive payroll terms."
      )
    );
  }
  if (raw.metadata !== undefined) {
    if (!isPlainObject(raw.metadata)) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED,
          "metadata",
          "Retention policy metadata must be a plain object when provided.",
          "Provide metadata as a plain object with non-sensitive keys and values."
        )
      );
    } else if (containsSensitiveString(raw.metadata)) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED,
          "metadata",
          RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED],
          "Remove sensitive payroll or credential terminology from metadata."
        )
      );
    }
  }

  const expectedVersion = raw.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.VERSION_MISMATCH,
        "expectedVersion",
        "Expected version must be a non-negative integer.",
        "Provide the current policy version, or 0 when creating a new policy."
      )
    );
  }

  if (current) {
    if (policyId && current.policyId !== policyId) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
          "policyId",
          "Policy identifier does not match the current retention policy.",
          "Use the existing policy identifier for updates."
        )
      );
    }
    if (Number.isSafeInteger(expectedVersion) && current.version !== expectedVersion) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.VERSION_MISMATCH,
          "expectedVersion",
          `Version conflict: expected ${expectedVersion}, current ${current.version}.`,
          `Reload the latest policy and retry with expectedVersion ${current.version}.`
        )
      );
    }
    if (current.status === "superseded") {
      issues.push(
        issue(
          RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
          "status",
          "Cannot update a superseded retention policy. Superseded policies are immutable.",
          "Create or update the active successor policy instead."
        )
      );
    }
  } else if (expectedVersion !== undefined && expectedVersion !== 0) {
    if (Number.isSafeInteger(expectedVersion)) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.VERSION_MISMATCH,
          "expectedVersion",
          "Initial retention policy creation must use expectedVersion 0.",
          "Set expectedVersion to 0 for a new policy."
        )
      );
    }
  }

  const currentStatus: RetentionPolicyStatus = current ? current.status : "draft";
  const targetStatus = (raw.status ??
    (current ? current.status : "active")) as RetentionPolicyStatus;
  if (!RETENTION_POLICY_STATUSES.includes(targetStatus)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
        "status",
        `Target status "${String(raw.status)}" is not a recognized retention policy status.`,
        `Use one of: ${RETENTION_POLICY_STATUSES.join(", ")}.`
      )
    );
  } else if (current && targetStatus !== currentStatus) {
    const allowed =
      (currentStatus === "draft" && ["active", "suspended"]) ||
      (currentStatus === "active" && ["active", "superseded", "suspended"]) ||
      (currentStatus === "suspended" && ["active", "superseded"]) ||
      [];
    if (!allowed.includes(targetStatus)) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
          "status",
          `Invalid status transition from "${currentStatus}" to "${targetStatus}".`,
          `Allowed transitions from ${currentStatus}: ${
            (
              (
                {
                  draft: ["active", "suspended"],
                  active: ["active", "superseded", "suspended"],
                  suspended: ["active", "superseded"],
                  superseded: [],
                } as Record<string, string[]>
              )[currentStatus] || []
            ).join(", ") || "none"
          }.`
        )
      );
    }
  }

  const now = options.now ?? Date.now();
  const maxClockSkew = options.maxClockSkewMs ?? 5000;
  const timestampMs = (raw.timestampMs ?? now) as number;
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_TIMESTAMP,
        "timestampMs",
        RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.INVALID_TIMESTAMP],
        "Provide a positive epoch-millisecond timestamp."
      )
    );
  } else {
    if (timestampMs > now + maxClockSkew) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.INVALID_TIMESTAMP,
          "timestampMs",
          "Update timestamp cannot be in the future beyond allowed clock skew.",
          `Use a timestamp <= now + ${maxClockSkew}ms.`
        )
      );
    }
    if (current && timestampMs < current.updatedAtMs) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.VERSION_REGRESSION,
          "timestampMs",
          "Update timestamp cannot regress before the current policy update timestamp.",
          `Use a timestamp >= ${current.updatedAtMs}.`
        )
      );
    }
  }

  const effectiveAtMs = (raw.effectiveAtMs ?? timestampMs) as number;
  if (raw.effectiveAtMs !== undefined && (!Number.isFinite(effectiveAtMs) || effectiveAtMs <= 0)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_TIMESTAMP,
        "effectiveAtMs",
        "Effective timestamp must be a valid positive epoch millisecond timestamp.",
        "Provide a positive epoch-millisecond effectiveAtMs or omit it."
      )
    );
  }

  const statutoryFloor = options.statutoryFloorDays ?? DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS;
  const retentionDays = validateRetentionDaysValue(
    raw.retentionDays ?? (current ? current.retentionDays : undefined),
    "retentionDays",
    issues,
    !current
  );
  const minimumRetentionDays = validateRetentionDaysValue(
    raw.minimumRetentionDays ?? (current ? current.minimumRetentionDays : statutoryFloor),
    "minimumRetentionDays",
    issues,
    !current && raw.minimumRetentionDays !== undefined
  );
  const maximumRetentionDays =
    raw.maximumRetentionDays === undefined
      ? current
        ? current.maximumRetentionDays
        : undefined
      : validateRetentionDaysValue(raw.maximumRetentionDays, "maximumRetentionDays", issues, true);

  if (retentionDays !== undefined && retentionDays < statutoryFloor) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.STATUTORY_MINIMUM_VIOLATION,
        "retentionDays",
        `Proposed retention duration (${retentionDays} days) violates statutory minimum floor of ${statutoryFloor} days.`,
        `Set retentionDays to at least ${statutoryFloor}.`
      )
    );
  }
  if (
    retentionDays !== undefined &&
    minimumRetentionDays !== undefined &&
    retentionDays < minimumRetentionDays
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
        "retentionDays",
        `Retention duration (${retentionDays} days) cannot be less than minimumRetentionDays (${minimumRetentionDays} days).`,
        "Increase retentionDays or lower minimumRetentionDays within statutory bounds."
      )
    );
  }
  if (
    retentionDays !== undefined &&
    maximumRetentionDays !== undefined &&
    maximumRetentionDays < retentionDays
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
        "maximumRetentionDays",
        `Maximum retention duration (${maximumRetentionDays} days) must be >= retentionDays (${retentionDays} days).`,
        "Increase maximumRetentionDays or reduce retentionDays."
      )
    );
  }

  const currentLegalHold = current ? current.legalHoldActive : false;
  const targetLegalHold =
    raw.legalHoldActive !== undefined ? Boolean(raw.legalHoldActive) : currentLegalHold;
  if (
    currentLegalHold &&
    retentionDays !== undefined &&
    current &&
    retentionDays < current.retentionDays
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT,
        "retentionDays",
        RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT],
        "Do not reduce retentionDays while legal hold is active."
      )
    );
  }
  if (currentLegalHold && !targetLegalHold && !options.allowLegalHoldRelease) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT,
        "legalHoldActive",
        "Releasing an active legal hold requires explicit authorization flag (allowLegalHoldRelease).",
        "Set options.allowLegalHoldRelease to true only with explicit authorization."
      )
    );
  }

  if (current) {
    const isNoOp =
      (raw.retentionDays === undefined || raw.retentionDays === current.retentionDays) &&
      (raw.minimumRetentionDays === undefined ||
        raw.minimumRetentionDays === current.minimumRetentionDays) &&
      (raw.maximumRetentionDays === undefined ||
        raw.maximumRetentionDays === current.maximumRetentionDays) &&
      (raw.legalHoldActive === undefined ||
        Boolean(raw.legalHoldActive) === current.legalHoldActive) &&
      (raw.status === undefined || raw.status === current.status) &&
      raw.metadata === undefined;
    if (isNoOp && issues.length === 0) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.NO_OP_UPDATE,
          "policy",
          RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.NO_OP_UPDATE],
          "Change at least one retention policy field before submitting an update."
        )
      );
    }
  }

  // If there are structural issues, do not attempt transition.
  if (issues.length > 0) {
    return Object.freeze({ isValid: false, issues: Object.freeze(issues) });
  }

  try {
    const transition = applyRetentionPolicyUpdate(current, update, options);
    return Object.freeze({
      isValid: true,
      issues: Object.freeze([]),
      transition,
      policy: transition.updatedPolicy,
    });
  } catch (error) {
    const err =
      error instanceof RetentionPolicyError
        ? error
        : new RetentionPolicyError(
            getSafeRetentionValidationMessage(error),
            RetentionPolicyErrorCode.INVALID_STATE_TRANSITION
          );
    const fallback = issue(err.retentionCode, "policy", err.message);
    return Object.freeze({ isValid: false, issues: Object.freeze([fallback]) });
  }
}

function getSafeRetentionValidationMessage(error: unknown): string {
  if (error instanceof RetentionPolicyError) return formatRetentionPolicyError(error);
  if (error instanceof Error) return "Retention policy update validation failed.";
  return RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.INVALID_STATE_TRANSITION];
}

export function assertValidRetentionPolicyUpdate(
  current: RetentionPolicy | null | undefined,
  input: unknown,
  options: RetentionPolicyValidationOptions = {}
): RetentionPolicyTransitionResult {
  const result = validateRetentionPolicyUpdate(current, input, options);
  if (!result.isValid || !result.transition) {
    const primary = result.issues[0];
    throw new RetentionPolicyError(
      formatRetentionPolicyError(result.issues),
      primary?.code ?? RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
      {
        field: primary?.field,
        issueCount: result.issues.length,
        actor: isPlainObject(input) ? redactPolicyActorId((input as any).updatedBy) : undefined,
      },
      undefined,
      result.issues
    );
  }
  return result.transition;
}

export function validateRetentionPolicyState(
  policy: unknown,
  options: RetentionPolicyValidationOptions = {}
): RetentionPolicyStateValidationResult {
  const issues: RetentionPolicyValidationIssue[] = [];
  if (!isPlainObject(policy)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
        "policy",
        "Retention policy snapshot must be a non-null object.",
        "Provide a persisted retention policy snapshot."
      )
    );
    return Object.freeze({ isValid: false, issues: Object.freeze(issues) });
  }

  const p = policy as Record<string, unknown>;
  const policyId = validateIdentifier(
    p.policyId,
    "policyId",
    RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
    MAX_RETENTION_POLICY_ID_LENGTH
  );
  if (!policyId)
    addIdIssue(
      issues,
      p.policyId,
      "policyId",
      RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
      MAX_RETENTION_POLICY_ID_LENGTH,
      "Provide a valid policyId."
    );
  if (!Number.isSafeInteger(p.version) || (p.version as number) <= 0) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.VERSION_MISMATCH,
        "version",
        "Retention policy version must be a positive integer.",
        "Persist a positive version number."
      )
    );
  }
  const retentionDays = validateRetentionDaysValue(p.retentionDays, "retentionDays", issues, true);
  const minimumRetentionDays = validateRetentionDaysValue(
    p.minimumRetentionDays,
    "minimumRetentionDays",
    issues,
    true
  );
  const maximumRetentionDays =
    p.maximumRetentionDays === undefined
      ? undefined
      : validateRetentionDaysValue(p.maximumRetentionDays, "maximumRetentionDays", issues, true);
  const statutoryFloor = options.statutoryFloorDays ?? DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS;
  if (retentionDays !== undefined && retentionDays < statutoryFloor) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.STATUTORY_MINIMUM_VIOLATION,
        "retentionDays",
        `Retention duration (${retentionDays} days) violates statutory minimum floor of ${statutoryFloor} days.`,
        `Set retentionDays to at least ${statutoryFloor}.`
      )
    );
  }
  if (
    retentionDays !== undefined &&
    minimumRetentionDays !== undefined &&
    retentionDays < minimumRetentionDays
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
        "retentionDays",
        "Retention duration cannot be less than minimumRetentionDays.",
        "Ensure retentionDays >= minimumRetentionDays."
      )
    );
  }
  if (
    retentionDays !== undefined &&
    maximumRetentionDays !== undefined &&
    maximumRetentionDays < retentionDays
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
        "maximumRetentionDays",
        "Maximum retention duration must be >= retentionDays.",
        "Ensure maximumRetentionDays >= retentionDays."
      )
    );
  }
  if (typeof p.legalHoldActive !== "boolean") {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
        "legalHoldActive",
        "legalHoldActive must be a boolean.",
        "Persist legalHoldActive as true or false."
      )
    );
  }
  if (!RETENTION_POLICY_STATUSES.includes(p.status as RetentionPolicyStatus)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
        "status",
        "Retention policy status is invalid.",
        `Use one of: ${RETENTION_POLICY_STATUSES.join(", ")}.`
      )
    );
  }
  if (!Number.isFinite(p.effectiveAtMs) || (p.effectiveAtMs as number) <= 0) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_TIMESTAMP,
        "effectiveAtMs",
        "effectiveAtMs must be a positive epoch millisecond timestamp.",
        "Persist a valid effectiveAtMs."
      )
    );
  }
  if (!Number.isFinite(p.updatedAtMs) || (p.updatedAtMs as number) <= 0) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_TIMESTAMP,
        "updatedAtMs",
        "updatedAtMs must be a positive epoch millisecond timestamp.",
        "Persist a valid updatedAtMs."
      )
    );
  }
  addIdIssue(
    issues,
    p.updatedBy,
    "updatedBy",
    RetentionPolicyErrorCode.ACTOR_REQUIRED,
    MAX_RETENTION_ACTOR_LENGTH,
    "Persist the actor identity."
  );
  addIdIssue(
    issues,
    p.updateReason,
    "updateReason",
    RetentionPolicyErrorCode.REASON_REQUIRED,
    MAX_RETENTION_REASON_LENGTH,
    "Persist the update justification."
  );
  if (typeof p.updateReason === "string" && SENSITIVE_KEYWORD_REGEX.test(p.updateReason)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED,
        "updateReason",
        RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED],
        "Remove sensitive terminology from the justification."
      )
    );
  }
  if (
    p.metadata !== undefined &&
    (!isPlainObject(p.metadata) || containsSensitiveString(p.metadata))
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED,
        "metadata",
        RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED],
        "Persist metadata without sensitive payroll terminology."
      )
    );
  }

  const hash = typeof p.hash === "string" ? p.hash : "";
  const previousHash = typeof p.previousHash === "string" ? p.previousHash : "";
  if (!/^([a-f0-9]{64})$/i.test(hash)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_HASH,
        "hash",
        "Retention policy hash must be a 64-character SHA-256 hex digest.",
        "Recompute and persist the policy hash."
      )
    );
  }
  if (!/^([a-f0-9]{64})$/i.test(previousHash)) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_HASH,
        "previousHash",
        "Retention policy previousHash must be a 64-character SHA-256 hex digest.",
        "Persist a valid previousHash chain link."
      )
    );
  }
  if (
    (p.version as number) === 1 &&
    previousHash &&
    previousHash !== RETENTION_GENESIS_PREVIOUS_HASH
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_HASH,
        "previousHash",
        "Genesis retention policy revision must use the genesis previousHash.",
        `Set previousHash to ${RETENTION_GENESIS_PREVIOUS_HASH}.`
      )
    );
  }

  // Revision references (#983): every later revision must link to a real
  // predecessor. Pointing back at the genesis sentinel would silently detach
  // it from the chain, and a self-reference can never be a valid predecessor.
  if (
    typeof p.version === "number" &&
    Number.isSafeInteger(p.version) &&
    p.version > 1 &&
    previousHash === RETENTION_GENESIS_PREVIOUS_HASH
  ) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_HASH,
        "previousHash",
        "Non-genesis retention policy revision must reference the previous revision hash.",
        "Set previousHash to the hash of the revision immediately before this one."
      )
    );
  }
  if (hash && previousHash && hash.toLowerCase() === previousHash.toLowerCase()) {
    issues.push(
      issue(
        RetentionPolicyErrorCode.INVALID_HASH,
        "previousHash",
        "Retention policy revision cannot reference its own hash as the previous revision.",
        "Persist the hash of the preceding revision as previousHash."
      )
    );
  }

  if (issues.length === 0) {
    const snapshot = policy as unknown as RetentionPolicy;
    const recomputed = computeRetentionPolicyHash({
      policyId: snapshot.policyId,
      version: snapshot.version,
      retentionDays: snapshot.retentionDays,
      minimumRetentionDays: snapshot.minimumRetentionDays,
      ...(snapshot.maximumRetentionDays !== undefined
        ? { maximumRetentionDays: snapshot.maximumRetentionDays }
        : {}),
      legalHoldActive: snapshot.legalHoldActive,
      status: snapshot.status,
      effectiveAtMs: snapshot.effectiveAtMs,
      updatedAtMs: snapshot.updatedAtMs,
      updatedBy: snapshot.updatedBy,
      updateReason: snapshot.updateReason,
      previousHash: snapshot.previousHash,
      ...(snapshot.metadata ? { metadata: snapshot.metadata as Record<string, unknown> } : {}),
    });
    if (recomputed !== snapshot.hash) {
      issues.push(
        issue(
          RetentionPolicyErrorCode.INVALID_HASH,
          "hash",
          "Retention policy hash does not match the snapshot content.",
          "Recompute the hash from the canonical policy fields."
        )
      );
    }
  }

  if (issues.length > 0) {
    return Object.freeze({ isValid: false, issues: Object.freeze(issues) });
  }
  return Object.freeze({
    isValid: true,
    issues: Object.freeze([]),
    policy: Object.freeze({ ...(policy as unknown as RetentionPolicy) }),
  });
}

export function assertValidRetentionPolicyState(
  policy: unknown,
  options: RetentionPolicyValidationOptions = {}
): RetentionPolicy {
  const result = validateRetentionPolicyState(policy, options);
  if (!result.isValid || !result.policy) {
    const primary = result.issues[0];
    throw new RetentionPolicyError(
      formatRetentionPolicyError(result.issues),
      primary?.code ?? RetentionPolicyErrorCode.INVALID_HASH,
      { field: primary?.field, issueCount: result.issues.length },
      undefined,
      result.issues
    );
  }
  return result.policy;
}
