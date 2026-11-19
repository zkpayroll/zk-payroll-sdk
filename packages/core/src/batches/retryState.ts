/**
 * Hardened Payout Batch Retry State Handling (#903)
 *
 * Failed payout batches are retried item-by-item, usually by different
 * operators and sometimes hours apart. That makes the retry state itself the
 * most dangerous part of the flow: a stale write can resurrect an already
 * settled payout, and "just retry everything" can pay an employee twice.
 *
 * This module hardens that state machine:
 *
 * - **Optimistic concurrency** — every update names the `expectedVersion` it
 *   was derived from; a concurrent write is rejected instead of overwritten.
 * - **Explicit transitions** — only the documented lifecycle moves are allowed
 *   and terminal batches are immutable.
 * - **Attempt accounting** — retries are counted against a bounded
 *   `maxAttempts`; once exhausted the batch can only be closed.
 * - **Settled-item immutability** — a settled payout id can never leave the
 *   settled set, so a retry payload that still contains it is rejected.
 * - **Tamper-evident history** — revisions are SHA-256 hash-chained and can be
 *   verified with {@link PayoutBatchRetryStateManager.verifyHistoryIntegrity}.
 *
 * Privacy: the state holds payout item identifiers and machine error codes
 * only. No amounts, recipients, employee records, or free-text failure reasons
 * are accepted — validating this keeps salary data out of retry ledgers.
 *
 * @module
 */

import { createHash } from "crypto";
import { ZkPayrollError } from "../core/errors";

// ── Types ────────────────────────────────────────────────────────────────────

/** Lifecycle states a payout batch retry can be in. */
export const PAYOUT_BATCH_RETRY_STATUSES = [
  "pending",
  "failed",
  "retrying",
  "completed",
  "exhausted",
] as const;

export type PayoutBatchRetryStatus = (typeof PAYOUT_BATCH_RETRY_STATUSES)[number];

/** States from which no further retry transition is possible. */
export const TERMINAL_PAYOUT_BATCH_RETRY_STATUSES: readonly PayoutBatchRetryStatus[] =
  Object.freeze(["completed", "exhausted"]);

/** Allowed lifecycle transitions for a payout batch retry. */
export const ALLOWED_PAYOUT_BATCH_RETRY_TRANSITIONS: Readonly<
  Record<PayoutBatchRetryStatus, readonly PayoutBatchRetryStatus[]>
> = Object.freeze({
  pending: ["failed", "retrying", "completed", "exhausted"],
  failed: ["retrying", "exhausted"],
  retrying: ["retrying", "failed", "completed", "exhausted"],
  completed: [],
  exhausted: [],
});

/** Default number of retry attempts allowed for a batch. */
export const DEFAULT_PAYOUT_BATCH_MAX_RETRY_ATTEMPTS = 3;

/** Default tolerance for timestamps slightly ahead of the local clock. */
export const DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS = 5_000;

/** Hash used as `previousHash` for the first revision of a batch. */
export const PAYOUT_BATCH_RETRY_GENESIS_HASH = "0".repeat(64);

/** Maximum accepted length of a batch or item identifier. */
const MAX_IDENTIFIER_LENGTH = 200;

/**
 * Immutable, versioned snapshot of a payout batch's retry state.
 */
export interface PayoutBatchRetryState {
  /** Stable payout batch identifier. */
  readonly batchId: string;
  /** Monotonically increasing revision number (starts at 1). */
  readonly version: number;
  /** Current lifecycle status. */
  readonly status: PayoutBatchRetryStatus;
  /** Number of retry attempts already consumed. */
  readonly attempt: number;
  /** Upper bound on retry attempts for this batch. */
  readonly maxAttempts: number;
  /** Payout item ids that have not settled yet and may still be retried. */
  readonly outstandingItemIds: readonly string[];
  /** Payout item ids that have settled; these are final and never retried. */
  readonly settledItemIds: readonly string[];
  /** Optional machine-readable code of the last failure (never free text). */
  readonly lastErrorCode?: string;
  /** When this revision was recorded, in epoch milliseconds. */
  readonly updatedAtMs: number;
  /** Operator identity that authorized the transition. */
  readonly updatedBy: string;
  /** SHA-256 hash of this revision's contents. */
  readonly hash: string;
  /** Hash of the previous revision (genesis hash for the first revision). */
  readonly previousHash: string;
}

/**
 * Input for applying one retry-state transition.
 */
export interface PayoutBatchRetryUpdateInput {
  /** Target payout batch identifier. */
  batchId: string;
  /** Revision the caller derived this update from (0 when creating a batch). */
  expectedVersion: number;
  /** Target lifecycle status. */
  targetStatus: PayoutBatchRetryStatus;
  /** Identity of the operator authorizing the transition. */
  updatedBy: string;
  /**
   * Payout item ids that settled during this transition. Must be a subset of
   * the currently outstanding items; a settled id may never be retried.
   */
  settledItemIds?: readonly string[];
  /**
   * Payout item ids still outstanding after this transition. Must be a subset
   * of the current outstanding items — retries can only shrink the set.
   */
  outstandingItemIds?: readonly string[];
  /** Optional machine-readable failure code for the transition. */
  lastErrorCode?: string;
  /** Timestamp of the transition in epoch milliseconds (defaults to now). */
  timestampMs?: number;
  /** Retry attempt limit; only meaningful when creating a batch. */
  maxAttempts?: number;
}

/** Result of an atomic retry-state transition. */
export interface PayoutBatchRetryTransitionResult {
  readonly success: true;
  readonly previousState?: PayoutBatchRetryState;
  readonly state: PayoutBatchRetryState;
  readonly appliedAtMs: number;
}

/** Options controlling retry-state validation. */
export interface PayoutBatchRetryValidationOptions {
  /** Reference current time in milliseconds. */
  now?: number;
  /** Clock skew tolerance for future timestamps, in milliseconds. */
  maxClockSkewMs?: number;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Stable error codes for payout batch retry state failures. */
export const PayoutBatchRetryStateErrorCode = {
  BATCH_ID_REQUIRED: "PAYOUT_BATCH_RETRY_BATCH_ID_REQUIRED",
  ACTOR_REQUIRED: "PAYOUT_BATCH_RETRY_ACTOR_REQUIRED",
  BATCH_NOT_FOUND: "PAYOUT_BATCH_RETRY_NOT_FOUND",
  VERSION_MISMATCH: "PAYOUT_BATCH_RETRY_VERSION_MISMATCH",
  INVALID_STATUS: "PAYOUT_BATCH_RETRY_INVALID_STATUS",
  INVALID_STATE_TRANSITION: "PAYOUT_BATCH_RETRY_INVALID_STATE_TRANSITION",
  TERMINAL_STATE: "PAYOUT_BATCH_RETRY_TERMINAL_STATE",
  ATTEMPTS_EXHAUSTED: "PAYOUT_BATCH_RETRY_ATTEMPTS_EXHAUSTED",
  INVALID_MAX_ATTEMPTS: "PAYOUT_BATCH_RETRY_INVALID_MAX_ATTEMPTS",
  INVALID_ITEM_SET: "PAYOUT_BATCH_RETRY_INVALID_ITEM_SET",
  ITEM_ALREADY_SETTLED: "PAYOUT_BATCH_RETRY_ITEM_ALREADY_SETTLED",
  UNKNOWN_OUTSTANDING_ITEM: "PAYOUT_BATCH_RETRY_UNKNOWN_OUTSTANDING_ITEM",
  OUTSTANDING_ITEMS_REMAIN: "PAYOUT_BATCH_RETRY_OUTSTANDING_ITEMS_REMAIN",
  INVALID_ERROR_CODE: "PAYOUT_BATCH_RETRY_INVALID_ERROR_CODE",
  INVALID_TIMESTAMP: "PAYOUT_BATCH_RETRY_INVALID_TIMESTAMP",
  TIMESTAMP_REGRESSION: "PAYOUT_BATCH_RETRY_TIMESTAMP_REGRESSION",
  NO_OP_UPDATE: "PAYOUT_BATCH_RETRY_NO_OP_UPDATE",
} as const;

export type PayoutBatchRetryStateErrorCode =
  (typeof PayoutBatchRetryStateErrorCode)[keyof typeof PayoutBatchRetryStateErrorCode];

/** Safe, actionable messages keyed by retry-state error code. */
export const PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES: Record<
  PayoutBatchRetryStateErrorCode,
  string
> = {
  [PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED]:
    "A payout batch identifier is required.",
  [PayoutBatchRetryStateErrorCode.ACTOR_REQUIRED]:
    "An operator identity is required to record a retry-state change.",
  [PayoutBatchRetryStateErrorCode.BATCH_NOT_FOUND]:
    "The payout batch retry state was not found. Initialize the batch first.",
  [PayoutBatchRetryStateErrorCode.VERSION_MISMATCH]:
    "Payout batch retry state changed since it was read. Refresh the batch and retry.",
  [PayoutBatchRetryStateErrorCode.INVALID_STATUS]:
    "The requested payout batch retry status is not recognized.",
  [PayoutBatchRetryStateErrorCode.INVALID_STATE_TRANSITION]:
    "The requested payout batch retry state transition is not permitted.",
  [PayoutBatchRetryStateErrorCode.TERMINAL_STATE]:
    "This payout batch retry is already closed and cannot be modified.",
  [PayoutBatchRetryStateErrorCode.ATTEMPTS_EXHAUSTED]:
    "The retry attempt limit for this payout batch has been reached. Close the batch and escalate the remaining failures.",
  [PayoutBatchRetryStateErrorCode.INVALID_MAX_ATTEMPTS]:
    "The retry attempt limit must be a positive integer.",
  [PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET]:
    "Payout item identifiers must be unique, non-empty strings.",
  [PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED]:
    "A settled payout cannot be retried; remove it from the retry payload to avoid paying it twice.",
  [PayoutBatchRetryStateErrorCode.UNKNOWN_OUTSTANDING_ITEM]:
    "A retry payload referenced a payout that is not outstanding in this batch.",
  [PayoutBatchRetryStateErrorCode.OUTSTANDING_ITEMS_REMAIN]:
    "The batch still has outstanding payouts and cannot be marked complete.",
  [PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE]:
    "Failure codes must be short machine-readable identifiers, not free text.",
  [PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP]:
    "The retry-state timestamp must be a valid, non-future epoch millisecond value.",
  [PayoutBatchRetryStateErrorCode.TIMESTAMP_REGRESSION]:
    "The retry-state timestamp cannot move backwards.",
  [PayoutBatchRetryStateErrorCode.NO_OP_UPDATE]:
    "No retry-state changes were detected in the proposed update.",
};

/**
 * Safe error thrown for invalid payout batch retry state operations.
 * Extends {@link ZkPayrollError} so SDK consumers can catch it centrally.
 */
export class PayoutBatchRetryStateError extends ZkPayrollError {
  public readonly retryCode: PayoutBatchRetryStateErrorCode;

  constructor(
    message: string,
    code: PayoutBatchRetryStateErrorCode = PayoutBatchRetryStateErrorCode.INVALID_STATE_TRANSITION,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
    this.name = "PayoutBatchRetryStateError";
    this.retryCode = code;
  }
}

/** Type guard for {@link PayoutBatchRetryStateError}. */
export function isPayoutBatchRetryStateError(error: unknown): boolean {
  return error instanceof PayoutBatchRetryStateError;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Machine-readable failure code: uppercase letters, digits, `_`, `:`, `-`. */
const ERROR_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_:-]{0,63}$/;

function assertIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PayoutBatchRetryStateError(
      `Payout batch retry field "${field}" must be a non-empty string.`,
      PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET,
      { field }
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    throw new PayoutBatchRetryStateError(
      `Payout batch retry field "${field}" exceeds the maximum identifier length.`,
      PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET,
      { field, maxLength: MAX_IDENTIFIER_LENGTH }
    );
  }
  return trimmed;
}

function normalizeItemIds(value: readonly string[] | undefined, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new PayoutBatchRetryStateError(
      `Payout batch retry field "${field}" must be an array of payout item ids.`,
      PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET,
      { field }
    );
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    const id = assertIdentifier(raw, field);
    if (seen.has(id)) {
      throw new PayoutBatchRetryStateError(
        `Payout batch retry field "${field}" contains a duplicate payout item id.`,
        PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET,
        { field }
      );
    }
    seen.add(id);
    result.push(id);
  }
  return result.sort();
}

function normalizeMaxAttempts(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
        PayoutBatchRetryStateErrorCode.INVALID_MAX_ATTEMPTS
      ],
      PayoutBatchRetryStateErrorCode.INVALID_MAX_ATTEMPTS,
      { maxAttempts: value }
    );
  }
  return value;
}

function resolveTimestamp(timestampMs: number | undefined, options: PayoutBatchRetryValidationOptions): number {
  const now = options.now ?? Date.now();
  const maxClockSkew = options.maxClockSkewMs ?? DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS;
  const resolved = timestampMs ?? now;

  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP],
      PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP,
      { timestampMs }
    );
  }
  if (resolved > now + maxClockSkew) {
    throw new PayoutBatchRetryStateError(
      "Retry-state timestamp cannot be in the future beyond allowed clock skew.",
      PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP,
      { timestampMs: resolved, now }
    );
  }
  return resolved;
}

function computeStateHash(state: Omit<PayoutBatchRetryState, "hash">): string {
  const parts = [
    "zkpayroll:payout-batch-retry:v1",
    state.batchId,
    String(state.version),
    state.status,
    String(state.attempt),
    String(state.maxAttempts),
    state.outstandingItemIds.join(","),
    state.settledItemIds.join(","),
    state.lastErrorCode ?? "",
    String(state.updatedAtMs),
    state.updatedBy,
    state.previousHash,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function sameItemSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildState(base: Omit<PayoutBatchRetryState, "hash">): PayoutBatchRetryState {
  const hash = computeStateHash(base);
  return Object.freeze({
    ...base,
    outstandingItemIds: Object.freeze([...base.outstandingItemIds]),
    settledItemIds: Object.freeze([...base.settledItemIds]),
    hash,
  });
}

// ── Transition function ──────────────────────────────────────────────────────

/**
 * Validates and applies one payout batch retry-state transition.
 *
 * @param current - Current retry state, or `null`/`undefined` when creating a batch.
 * @param input - Proposed transition.
 * @param options - Clock and clock-skew options.
 * @returns The resulting transition with a frozen, hash-chained state.
 * @throws {PayoutBatchRetryStateError} when any invariant is violated.
 */
export function applyPayoutBatchRetryUpdate(
  current: PayoutBatchRetryState | null | undefined,
  input: PayoutBatchRetryUpdateInput,
  options: PayoutBatchRetryValidationOptions = {}
): PayoutBatchRetryTransitionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PayoutBatchRetryStateError(
      "Payout batch retry update must be a non-null object.",
      PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED
    );
  }

  // 1. Identity & actor
  if (typeof input.batchId !== "string" || input.batchId.trim().length === 0) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
        PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED
      ],
      PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED,
      { field: "batchId" }
    );
  }
  const batchId = assertIdentifier(input.batchId, "batchId");

  if (typeof input.updatedBy !== "string" || input.updatedBy.trim().length === 0) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
        PayoutBatchRetryStateErrorCode.ACTOR_REQUIRED
      ],
      PayoutBatchRetryStateErrorCode.ACTOR_REQUIRED,
      { field: "updatedBy" }
    );
  }
  const updatedBy = input.updatedBy.trim();

  // 2. Optimistic concurrency
  const expectedVersion = input.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new PayoutBatchRetryStateError(
      "Expected version must be a non-negative integer.",
      PayoutBatchRetryStateErrorCode.VERSION_MISMATCH,
      { expectedVersion }
    );
  }

  if (current) {
    if (current.batchId !== batchId) {
      throw new PayoutBatchRetryStateError(
        "Retry state belongs to a different payout batch.",
        PayoutBatchRetryStateErrorCode.BATCH_NOT_FOUND,
        { currentBatchId: current.batchId, targetBatchId: batchId }
      );
    }
    if (current.version !== expectedVersion) {
      throw new PayoutBatchRetryStateError(
        `Version conflict: expected version ${expectedVersion}, but the batch is at version ${current.version}.`,
        PayoutBatchRetryStateErrorCode.VERSION_MISMATCH,
        { expectedVersion, currentVersion: current.version }
      );
    }
  } else if (expectedVersion !== 0) {
    throw new PayoutBatchRetryStateError(
      `Cannot create a payout batch retry state with expectedVersion ${expectedVersion}; must be 0.`,
      PayoutBatchRetryStateErrorCode.VERSION_MISMATCH,
      { expectedVersion }
    );
  }

  // 3. Lifecycle status & transitions
  const targetStatus = input.targetStatus;
  if (!PAYOUT_BATCH_RETRY_STATUSES.includes(targetStatus)) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
        PayoutBatchRetryStateErrorCode.INVALID_STATUS
      ],
      PayoutBatchRetryStateErrorCode.INVALID_STATUS,
      { targetStatus }
    );
  }

  const currentStatus: PayoutBatchRetryStatus = current ? current.status : "pending";

  if (current && TERMINAL_PAYOUT_BATCH_RETRY_STATUSES.includes(currentStatus)) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[PayoutBatchRetryStateErrorCode.TERMINAL_STATE],
      PayoutBatchRetryStateErrorCode.TERMINAL_STATE,
      { status: currentStatus }
    );
  }

  if (current && targetStatus !== currentStatus) {
    const allowed = ALLOWED_PAYOUT_BATCH_RETRY_TRANSITIONS[currentStatus];
    if (!allowed.includes(targetStatus)) {
      throw new PayoutBatchRetryStateError(
        `Invalid retry-state transition from "${currentStatus}" to "${targetStatus}".`,
        PayoutBatchRetryStateErrorCode.INVALID_STATE_TRANSITION,
        { from: currentStatus, to: targetStatus, allowed }
      );
    }
  }

  // 4. Attempt accounting
  const maxAttempts = normalizeMaxAttempts(
    input.maxAttempts ?? current?.maxAttempts,
    DEFAULT_PAYOUT_BATCH_MAX_RETRY_ATTEMPTS
  );

  if (current && input.maxAttempts !== undefined && maxAttempts !== current.maxAttempts) {
    throw new PayoutBatchRetryStateError(
      "The retry attempt limit cannot be changed after a batch is initialized.",
      PayoutBatchRetryStateErrorCode.INVALID_MAX_ATTEMPTS,
      { currentMaxAttempts: current.maxAttempts, requestedMaxAttempts: maxAttempts }
    );
  }

  const startingRetry =
    (currentStatus === "failed" || currentStatus === "pending") && targetStatus === "retrying";
  const attempt = (current?.attempt ?? 0) + (startingRetry ? 1 : 0);

  if (startingRetry && attempt > maxAttempts) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
        PayoutBatchRetryStateErrorCode.ATTEMPTS_EXHAUSTED
      ],
      PayoutBatchRetryStateErrorCode.ATTEMPTS_EXHAUSTED,
      { attempt, maxAttempts }
    );
  }

  // 5. Item sets
  const previousSettled = current ? current.settledItemIds : [];
  const previousOutstanding = current ? current.outstandingItemIds : [];
  const newlySettled = normalizeItemIds(input.settledItemIds, "settledItemIds");

  const settledSet = new Set(previousSettled);
  for (const id of newlySettled) {
    if (settledSet.has(id)) {
      throw new PayoutBatchRetryStateError(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
          PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED
        ],
        PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED,
        { itemId: id }
      );
    }
    settledSet.add(id);
  }

  const settledItemIds = [...settledSet].sort();
  const outstandingSource = input.outstandingItemIds;
  let outstandingItemIds: string[];

  if (outstandingSource === undefined) {
    outstandingItemIds = previousOutstanding.filter((id) => !settledSet.has(id));
  } else {
    outstandingItemIds = normalizeItemIds(outstandingSource, "outstandingItemIds");
  }

  const previousOutstandingSet = new Set(previousOutstanding);
  for (const id of newlySettled) {
    if (current && !previousOutstandingSet.has(id)) {
      throw new PayoutBatchRetryStateError(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
          PayoutBatchRetryStateErrorCode.UNKNOWN_OUTSTANDING_ITEM
        ],
        PayoutBatchRetryStateErrorCode.UNKNOWN_OUTSTANDING_ITEM,
        { itemId: id }
      );
    }
  }

  for (const id of outstandingItemIds) {
    if (settledSet.has(id)) {
      throw new PayoutBatchRetryStateError(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
          PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED
        ],
        PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED,
        { itemId: id }
      );
    }
    if (current && !previousOutstandingSet.has(id)) {
      throw new PayoutBatchRetryStateError(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
          PayoutBatchRetryStateErrorCode.UNKNOWN_OUTSTANDING_ITEM
        ],
        PayoutBatchRetryStateErrorCode.UNKNOWN_OUTSTANDING_ITEM,
        { itemId: id }
      );
    }
  }

  if (targetStatus === "completed" && outstandingItemIds.length > 0) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
        PayoutBatchRetryStateErrorCode.OUTSTANDING_ITEMS_REMAIN
      ],
      PayoutBatchRetryStateErrorCode.OUTSTANDING_ITEMS_REMAIN,
      { outstandingCount: outstandingItemIds.length }
    );
  }

  if (targetStatus === "failed" && outstandingItemIds.length === 0) {
    throw new PayoutBatchRetryStateError(
      "A payout batch cannot be marked failed when it has no outstanding payouts.",
      PayoutBatchRetryStateErrorCode.INVALID_STATE_TRANSITION,
      { outstandingCount: 0 }
    );
  }

  // 6. Failure code (machine-readable only)
  let lastErrorCode: string | undefined;
  if (input.lastErrorCode !== undefined) {
    if (
      typeof input.lastErrorCode !== "string" ||
      !ERROR_CODE_PATTERN.test(input.lastErrorCode)
    ) {
      throw new PayoutBatchRetryStateError(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
          PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE
        ],
        PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE,
        { field: "lastErrorCode" }
      );
    }
    lastErrorCode = input.lastErrorCode;
  } else {
    lastErrorCode = current?.lastErrorCode;
  }

  // 7. Timestamp
  const updatedAtMs = resolveTimestamp(input.timestampMs, options);
  if (current && updatedAtMs < current.updatedAtMs) {
    throw new PayoutBatchRetryStateError(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[
        PayoutBatchRetryStateErrorCode.TIMESTAMP_REGRESSION
      ],
      PayoutBatchRetryStateErrorCode.TIMESTAMP_REGRESSION,
      { timestampMs: updatedAtMs, currentUpdatedAtMs: current.updatedAtMs }
    );
  }

  // 8. No-op detection
  if (current) {
    const isNoOp =
      current.status === targetStatus &&
      current.attempt === attempt &&
      sameItemSet(current.outstandingItemIds, outstandingItemIds) &&
      sameItemSet(current.settledItemIds, settledItemIds) &&
      current.lastErrorCode === lastErrorCode;

    if (isNoOp) {
      throw new PayoutBatchRetryStateError(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[PayoutBatchRetryStateErrorCode.NO_OP_UPDATE],
        PayoutBatchRetryStateErrorCode.NO_OP_UPDATE,
        { batchId }
      );
    }
  }

  // 9. Build the immutable next revision
  const state = buildState({
    batchId,
    version: current ? current.version + 1 : 1,
    status: targetStatus,
    attempt,
    maxAttempts,
    outstandingItemIds,
    settledItemIds,
    ...(lastErrorCode !== undefined ? { lastErrorCode } : {}),
    updatedAtMs,
    updatedBy,
    previousHash: current ? current.hash : PAYOUT_BATCH_RETRY_GENESIS_HASH,
  });

  return Object.freeze({
    success: true as const,
    previousState: current ?? undefined,
    state,
    appliedAtMs: updatedAtMs,
  });
}

// ── State manager ────────────────────────────────────────────────────────────

/**
 * In-memory coordinator for payout batch retry state revisions.
 *
 * Persist state durably alongside payroll records in production; this manager
 * provides the validation and hash-chain semantics a durable store should
 * mirror.
 */
export class PayoutBatchRetryStateManager {
  private readonly states = new Map<string, PayoutBatchRetryState>();
  private readonly history = new Map<string, PayoutBatchRetryState[]>();

  constructor(initialStates: readonly PayoutBatchRetryState[] = []) {
    for (const state of initialStates) {
      this.registerState(state);
    }
  }

  /** Register a previously persisted revision (e.g. on startup). */
  public registerState(state: PayoutBatchRetryState): void {
    this.states.set(state.batchId, Object.freeze(state));
    const revisions = this.history.get(state.batchId) ?? [];
    revisions.push(Object.freeze(state));
    this.history.set(state.batchId, revisions);
  }

  /** Initialize a new batch in the `pending` state. */
  public initializeBatch(
    batchId: string,
    outstandingItemIds: readonly string[],
    options: { updatedBy: string; maxAttempts?: number; timestampMs?: number } & PayoutBatchRetryValidationOptions
  ): PayoutBatchRetryTransitionResult {
    if (this.states.has(batchId)) {
      throw new PayoutBatchRetryStateError(
        `Payout batch "${batchId}" already has retry state.`,
        PayoutBatchRetryStateErrorCode.VERSION_MISMATCH,
        { batchId }
      );
    }
    const result = applyPayoutBatchRetryUpdate(
      undefined,
      {
        batchId,
        expectedVersion: 0,
        targetStatus: "pending",
        updatedBy: options.updatedBy,
        outstandingItemIds,
        ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
        ...(options.timestampMs !== undefined ? { timestampMs: options.timestampMs } : {}),
      },
      options
    );
    this.registerState(result.state);
    return result;
  }

  /** Read the latest revision, or `undefined` when the batch is unknown. */
  public getState(batchId: string): PayoutBatchRetryState | undefined {
    return this.states.get(batchId);
  }

  /** Read all revisions for a batch, oldest first. */
  public getHistory(batchId: string): readonly PayoutBatchRetryState[] {
    return Object.freeze([...(this.history.get(batchId) ?? [])]);
  }

  /** Apply a transition and record the resulting revision. */
  public update(
    input: PayoutBatchRetryUpdateInput,
    options: PayoutBatchRetryValidationOptions = {}
  ): PayoutBatchRetryTransitionResult {
    const current = this.states.get(input.batchId);
    if (!current && input.expectedVersion !== 0) {
      throw new PayoutBatchRetryStateError(
        `Payout batch "${input.batchId}" does not have retry state. Initialize it first.`,
        PayoutBatchRetryStateErrorCode.BATCH_NOT_FOUND,
        { batchId: input.batchId }
      );
    }

    const result = applyPayoutBatchRetryUpdate(current, input, options);
    this.registerState(result.state);
    return result;
  }

  /**
   * Verify the hash chain of a batch's revisions.
   *
   * @returns `{ valid: true }` or the first broken revision with a reason.
   */
  public verifyHistoryIntegrity(batchId: string): {
    valid: boolean;
    brokenAt?: number;
    reason?: string;
  } {
    const revisions = this.history.get(batchId);
    if (!revisions || revisions.length === 0) {
      return { valid: true };
    }

    for (let i = 0; i < revisions.length; i++) {
      const entry = revisions[i];
      const expectedPrevious =
        i === 0 ? PAYOUT_BATCH_RETRY_GENESIS_HASH : revisions[i - 1].hash;

      if (entry.previousHash !== expectedPrevious) {
        return {
          valid: false,
          brokenAt: i + 1,
          reason: `Hash link broken at revision ${entry.version}.`,
        };
      }

      const { hash, ...rest } = entry;
      if (computeStateHash(rest) !== hash) {
        return {
          valid: false,
          brokenAt: i + 1,
          reason: `Integrity check failed at revision ${entry.version}.`,
        };
      }
    }

    return { valid: true };
  }
}
