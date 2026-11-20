/**
 * Typed Validation for Payout Batch Retries (#899)
 *
 * Retry payloads are assembled by operators, recovery tooling, and dashboards,
 * often from values that are *almost* valid: a numeric version as a string, a
 * duplicated payout id, a settled item accidentally left in the retry list, or
 * a persisted snapshot whose hash no longer matches its contents.
 *
 * This module adds a non-throwing validation layer over the hardened retry
 * state machine:
 *
 * - {@link validatePayoutBatchRetryUpdate} validates a proposed transition and
 *   returns either the resulting immutable state or a typed issue.
 * - {@link validatePayoutBatchRetryState} checks a persisted snapshot and
 *   accumulates every structural, lifecycle, item-set, and hash problem.
 * - `assert*` variants throw the existing {@link PayoutBatchRetryStateError}
 *   for callers that prefer exceptions.
 *
 * Messages never echo payout amounts, recipients, or free-text failure notes.
 *
 * @module
 */

import {
  PAYOUT_BATCH_RETRY_STATUSES,
  PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES,
  PayoutBatchRetryStateError,
  PayoutBatchRetryStateErrorCode,
  applyPayoutBatchRetryUpdate,
  computePayoutBatchRetryStateHash,
} from "./retryState";
import type {
  PayoutBatchRetryState,
  PayoutBatchRetryTransitionResult,
  PayoutBatchRetryUpdateInput,
  PayoutBatchRetryValidationOptions,
} from "./retryState";

/** Maximum accepted length of a batch or item identifier. */
const MAX_IDENTIFIER_LENGTH = 200;

/** Machine-readable failure code: uppercase letters, digits, `_`, `:`, `-`. */
const ERROR_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_:-]{0,63}$/;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** A single structured validation issue for a payout batch retry. */
export interface PayoutBatchRetryValidationIssue {
  /** Stable machine-readable code. */
  readonly code: PayoutBatchRetryStateErrorCode;
  /** Field path that failed validation. */
  readonly field: string;
  /** Safe, human-readable explanation. */
  readonly message: string;
  /** Optional structured context (never contains payroll values). */
  readonly context?: Readonly<Record<string, unknown>>;
}

/** Result of validating a proposed retry-state transition. */
export interface PayoutBatchRetryUpdateValidationResult {
  /** Whether the transition is valid. */
  readonly isValid: boolean;
  /** Accumulated issues (empty when valid). */
  readonly issues: readonly PayoutBatchRetryValidationIssue[];
  /** The applied transition, present only when valid. */
  readonly transition?: PayoutBatchRetryTransitionResult;
  /** The resulting state, present only when valid. */
  readonly state?: PayoutBatchRetryState;
}

/** Result of validating a persisted retry-state snapshot. */
export interface PayoutBatchRetryStateValidationResult {
  /** Whether the snapshot is valid. */
  readonly isValid: boolean;
  /** Accumulated issues (empty when valid). */
  readonly issues: readonly PayoutBatchRetryValidationIssue[];
}

function issue(
  code: PayoutBatchRetryStateErrorCode,
  field: string,
  message?: string,
  context?: Record<string, unknown>
): PayoutBatchRetryValidationIssue {
  return Object.freeze({
    code,
    field,
    message: message ?? PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[code],
    ...(context !== undefined ? { context: Object.freeze({ ...context }) } : {}),
  });
}

function issueFromError(error: PayoutBatchRetryStateError): PayoutBatchRetryValidationIssue {
  const field =
    typeof error.context.field === "string" && error.context.field.length > 0
      ? error.context.field
      : "input";
  return issue(error.retryCode, field, error.message, error.context);
}

function isValidIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_IDENTIFIER_LENGTH
  );
}

function collectItemIds(
  value: unknown,
  field: string,
  issues: PayoutBatchRetryValidationIssue[]
): string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET, field));
    return undefined;
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  let valid = true;

  for (const raw of value) {
    if (!isValidIdentifier(raw)) {
      issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET, field));
      valid = false;
      continue;
    }
    const id = raw.trim();
    if (seen.has(id)) {
      issues.push(
        issue(
          PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET,
          field,
          `Payout batch retry field "${field}" contains a duplicate payout item id.`
        )
      );
      valid = false;
      continue;
    }
    seen.add(id);
    ids.push(id);
  }

  return valid ? ids.sort() : undefined;
}

function collectUpdateInputIssues(
  input: PayoutBatchRetryUpdateInput,
  issues: PayoutBatchRetryValidationIssue[]
): void {
  const candidate = input as unknown;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED, "input"));
    return;
  }

  const value = candidate as Record<string, unknown>;

  if (typeof value.batchId !== "string" || value.batchId.trim().length === 0) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED, "batchId"));
  } else if (value.batchId.trim().length > MAX_IDENTIFIER_LENGTH) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET, "batchId"));
  }

  if (typeof value.updatedBy !== "string" || value.updatedBy.trim().length === 0) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.ACTOR_REQUIRED, "updatedBy"));
  }

  if (!Number.isSafeInteger(value.expectedVersion) || (value.expectedVersion as number) < 0) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.VERSION_MISMATCH, "expectedVersion"));
  }

  if (!PAYOUT_BATCH_RETRY_STATUSES.includes(value.targetStatus as never)) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_STATUS, "targetStatus"));
  }

  if (
    value.maxAttempts !== undefined &&
    (!Number.isSafeInteger(value.maxAttempts) || (value.maxAttempts as number) <= 0)
  ) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_MAX_ATTEMPTS, "maxAttempts"));
  }

  if (value.settledItemIds !== undefined) {
    collectItemIds(value.settledItemIds, "settledItemIds", issues);
  }

  if (value.outstandingItemIds !== undefined) {
    collectItemIds(value.outstandingItemIds, "outstandingItemIds", issues);
  }

  const lastErrorCode = value.lastErrorCode;
  if (
    lastErrorCode !== undefined &&
    (typeof lastErrorCode !== "string" || !ERROR_CODE_PATTERN.test(lastErrorCode))
  ) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE, "lastErrorCode"));
  }

  if (
    value.timestampMs !== undefined &&
    (typeof value.timestampMs !== "number" ||
      !Number.isFinite(value.timestampMs) ||
      value.timestampMs <= 0)
  ) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP, "timestampMs"));
  }
}

/**
 * Validate a proposed retry-state transition without throwing.
 *
 * The transition is validated with the same rules as
 * {@link applyPayoutBatchRetryUpdate}; on success the resulting immutable state
 * is returned alongside the transition. On failure the typed error is converted
 * into a structured issue instead of escaping to the caller.
 *
 * @param current - Current retry state, or `null`/`undefined` when creating a batch.
 * @param input - Proposed transition.
 * @param options - Clock and clock-skew options.
 */
export function validatePayoutBatchRetryUpdate(
  current: PayoutBatchRetryState | null | undefined,
  input: PayoutBatchRetryUpdateInput,
  options: PayoutBatchRetryValidationOptions = {}
): PayoutBatchRetryUpdateValidationResult {
  const issues: PayoutBatchRetryValidationIssue[] = [];
  collectUpdateInputIssues(input, issues);

  if (issues.length > 0) {
    return Object.freeze({
      isValid: false as const,
      issues: Object.freeze([...issues]),
    });
  }

  try {
    const transition = applyPayoutBatchRetryUpdate(current, input, options);
    return Object.freeze({
      isValid: true as const,
      issues: Object.freeze([]) as readonly PayoutBatchRetryValidationIssue[],
      transition,
      state: transition.state,
    });
  } catch (error) {
    if (error instanceof PayoutBatchRetryStateError) {
      return Object.freeze({
        isValid: false as const,
        issues: Object.freeze([issueFromError(error)]),
      });
    }
    throw error;
  }
}

/**
 * Validate a proposed retry-state transition and return the applied result.
 *
 * @throws {PayoutBatchRetryStateError} when the transition is invalid.
 */
export function assertValidPayoutBatchRetryUpdate(
  current: PayoutBatchRetryState | null | undefined,
  input: PayoutBatchRetryUpdateInput,
  options: PayoutBatchRetryValidationOptions = {}
): PayoutBatchRetryTransitionResult {
  const result = validatePayoutBatchRetryUpdate(current, input, options);
  if (!result.isValid || !result.transition) {
    const first = result.issues[0];
    throw new PayoutBatchRetryStateError(
      first?.message ??
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
          PayoutBatchRetryStateErrorCode.INVALID_STATE_TRANSITION
        ],
      first?.code ?? PayoutBatchRetryStateErrorCode.INVALID_STATE_TRANSITION,
      first?.context ?? {}
    );
  }
  return result.transition;
}

/**
 * Validate a persisted payout batch retry-state snapshot.
 *
 * Every problem is accumulated so recovery tooling can report all invalid
 * fields at once. When the structural checks pass, the revision hash is
 * recomputed and compared with the stored `hash`.
 */
export function validatePayoutBatchRetryState(
  state: PayoutBatchRetryState
): PayoutBatchRetryStateValidationResult {
  const candidate = state as unknown;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return Object.freeze({
      isValid: false as const,
      issues: Object.freeze([issue(PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED, "input")]),
    });
  }

  const value = candidate as Record<string, unknown>;
  const issues: PayoutBatchRetryValidationIssue[] = [];

  if (!isValidIdentifier(value.batchId)) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED, "batchId"));
  }

  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.VERSION_MISMATCH, "version"));
  }

  if (!PAYOUT_BATCH_RETRY_STATUSES.includes(value.status as never)) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_STATUS, "status"));
  }

  const attemptValid = Number.isSafeInteger(value.attempt) && (value.attempt as number) >= 0;
  if (!attemptValid) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_MAX_ATTEMPTS, "attempt"));
  }

  const maxAttemptsValid =
    Number.isSafeInteger(value.maxAttempts) && (value.maxAttempts as number) > 0;
  if (!maxAttemptsValid) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_MAX_ATTEMPTS, "maxAttempts"));
  }

  if (
    attemptValid &&
    maxAttemptsValid &&
    (value.attempt as number) > (value.maxAttempts as number)
  ) {
    issues.push(
      issue(PayoutBatchRetryStateErrorCode.ATTEMPTS_EXHAUSTED, "attempt", undefined, {
        attempt: value.attempt,
        maxAttempts: value.maxAttempts,
      })
    );
  }

  const outstanding = collectItemIds(value.outstandingItemIds, "outstandingItemIds", issues);
  const settled = collectItemIds(value.settledItemIds, "settledItemIds", issues);

  if (outstanding && settled) {
    const settledSet = new Set(settled);
    for (const id of outstanding) {
      if (settledSet.has(id)) {
        issues.push(
          issue(
            PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED,
            "outstandingItemIds",
            undefined,
            { itemId: id }
          )
        );
      }
    }
  }

  const lastErrorCode = value.lastErrorCode;
  if (
    lastErrorCode !== undefined &&
    (typeof lastErrorCode !== "string" || !ERROR_CODE_PATTERN.test(lastErrorCode))
  ) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE, "lastErrorCode"));
  }

  if (
    typeof value.updatedAtMs !== "number" ||
    !Number.isFinite(value.updatedAtMs) ||
    value.updatedAtMs <= 0
  ) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP, "updatedAtMs"));
  }

  if (!isValidIdentifier(value.updatedBy)) {
    issues.push(issue(PayoutBatchRetryStateErrorCode.ACTOR_REQUIRED, "updatedBy"));
  }

  if (issues.length === 0) {
    if (typeof value.hash !== "string" || !HASH_PATTERN.test(value.hash)) {
      issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_HASH, "hash"));
    }
    if (typeof value.previousHash !== "string" || !HASH_PATTERN.test(value.previousHash)) {
      issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_HASH, "previousHash"));
    }

    if (issues.length === 0) {
      const { hash, ...rest } = value;
      const recomputed = computePayoutBatchRetryStateHash(
        rest as unknown as Omit<PayoutBatchRetryState, "hash">
      );
      if (recomputed !== hash) {
        issues.push(issue(PayoutBatchRetryStateErrorCode.INVALID_HASH, "hash"));
      }
    }
  }

  return Object.freeze({
    isValid: issues.length === 0,
    issues: Object.freeze([...issues]),
  });
}

/**
 * Validate a persisted retry-state snapshot and return it when valid.
 *
 * @throws {PayoutBatchRetryStateError} when the snapshot is invalid.
 */
export function assertValidPayoutBatchRetryState(
  state: PayoutBatchRetryState
): PayoutBatchRetryState {
  const result = validatePayoutBatchRetryState(state);
  if (!result.isValid) {
    const first = result.issues[0];
    throw new PayoutBatchRetryStateError(
      first?.message ??
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
          PayoutBatchRetryStateErrorCode.INVALID_STATE_TRANSITION
        ],
      first?.code ?? PayoutBatchRetryStateErrorCode.INVALID_STATE_TRANSITION,
      first?.context ?? {}
    );
  }
  return state;
}
