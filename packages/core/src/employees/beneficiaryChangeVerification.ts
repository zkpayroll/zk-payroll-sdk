/**
 * Beneficiary change verification workflow (#717).
 *
 * `payoutDestinationChangeReview` answers "is this a valid, meaningfully
 * different destination change?" as a single stateless comparison, and
 * `EmployeePayoutMethod` already declares `confirmationNonce`/`expiresAt`
 * fields for gating a destination change behind a second factor — but
 * nothing ties those together into an actual workflow. This module is that
 * workflow: requesting a beneficiary (payout destination) change issues a
 * time-boxed verification token; the change only takes effect once that
 * token is presented back and still valid, the same two-step pattern an
 * email/phone change confirmation uses elsewhere.
 *
 * State machine: `requested` → `verified` (success) or `expired` /
 * `token_mismatch` (failure). A request is single-use: verifying it,
 * successfully or not, does not retroactively change a different request.
 *
 * For callers that need to persist and enforce that lifecycle,
 * {@link BeneficiaryChangeStateManager} records immutable, hash-chained
 * revisions, consumes a request exactly once, bounds token guesses, and
 * rejects stale or replayed verification attempts. See
 * `packages/core/docs/beneficiary-change-verification.md` for the full
 * behavior and integration guidance.
 *
 * @module
 */

import { createHash } from "crypto";
import {
  reviewPayoutDestinationChange,
  type PayoutDestinationChangeReviewResult,
} from "./payoutDestinationChangeReview";

/** A pending beneficiary change awaiting verification. */
export interface BeneficiaryChangeRequest {
  /** Stable identifier for this request (e.g. a UUID). */
  requestId: string;
  /** Employee the change applies to. */
  employeeId: string;
  /** Opaque token the employee/approver must present to verify this request. */
  verificationToken: string;
  /** Epoch milliseconds after which this request can no longer be verified. */
  expiresAt: number;
  /** The reviewed change this request carries; built from the two destinations at request time. */
  review: Extract<PayoutDestinationChangeReviewResult, { ok: true }>["review"];
}

/** Machine-readable reasons a beneficiary change request cannot be created. */
export type BeneficiaryChangeRequestErrorCode =
  | "CURRENT_DESTINATION_INVALID"
  | "PROPOSED_DESTINATION_INVALID"
  | "DESTINATION_UNCHANGED"
  | "EMPLOYEE_ID_REQUIRED"
  | "REQUEST_ID_REQUIRED"
  | "TOKEN_REQUIRED"
  | "DUPLICATE_REQUEST_ID"
  | "INVALID_EXPIRY"
  | "INVALID_TIMESTAMP";

/** Result of requesting a beneficiary change. */
export type RequestBeneficiaryChangeResult =
  | { ok: true; request: BeneficiaryChangeRequest }
  | { ok: false; code: BeneficiaryChangeRequestErrorCode; message: string };

/** Machine-readable reasons a beneficiary change verification can fail. */
export type BeneficiaryChangeVerificationErrorCode =
  | "REQUEST_EXPIRED"
  | "TOKEN_REQUIRED"
  | "TOKEN_MISMATCH"
  | "INVALID_REQUEST"
  | "INVALID_TIMESTAMP"
  | "REQUEST_NOT_FOUND"
  | "REQUEST_ALREADY_VERIFIED"
  | "REQUEST_ALREADY_APPLIED"
  | "REQUEST_NOT_VERIFIED"
  | "VERIFICATION_ATTEMPTS_EXHAUSTED";

/** Result of verifying a beneficiary change request. */
export type VerifyBeneficiaryChangeResult =
  | {
      ok: true;
      requestId: string;
      employeeId: string;
      review: BeneficiaryChangeRequest["review"];
    }
  | {
      ok: false;
      requestId: string;
      code: BeneficiaryChangeVerificationErrorCode;
      message: string;
    };

/**
 * Freezes a reviewed destination change so a pending request cannot be
 * mutated after it has been validated.
 */
function freezeReview(
  review: Extract<PayoutDestinationChangeReviewResult, { ok: true }>["review"]
): BeneficiaryChangeRequest["review"] {
  return Object.freeze({
    ...review,
    current: Object.freeze({ ...review.current }),
    proposed: Object.freeze({ ...review.proposed }),
    warnings: Object.freeze([...review.warnings]),
  });
}

/**
 * Creates a pending beneficiary (payout destination) change request.
 *
 * Validates and reviews the destination change exactly as
 * {@link reviewPayoutDestinationChange} does — an invalid or no-op change is
 * rejected here, before any verification token is minted — then packages
 * the review alongside the caller-supplied token/expiry into a request
 * ready for {@link verifyBeneficiaryChange}.
 *
 * The SDK never generates the token or timestamps itself: token minting is
 * a security-sensitive operation callers typically delegate to a server
 * (e.g. a signed, time-boxed nonce sent out-of-band to the employee), and
 * "now" is whatever the caller's clock says. Passing both in keeps this
 * function pure and deterministic for testing.
 *
 * The returned request and its review are frozen. Requests must have a
 * non-empty `requestId` and `verificationToken`; both identify the workflow
 * and prevent an unverifiable or replayable request from being created.
 *
 * @param input.requestId - Stable identifier for the new request. Must be non-empty.
 * @param input.employeeId - Employee the change applies to. Must be non-empty.
 * @param input.currentDestination - The destination currently on file.
 * @param input.proposedDestination - The destination being requested.
 * @param input.verificationToken - Opaque token the verifier must present back.
 *   Must be non-empty.
 * @param input.expiresAt - Epoch milliseconds after which the request expires.
 *   Must be a finite number; a value in the past is accepted (the request
 *   is simply already-expired, consistent with how {@link verifyBeneficiaryChange}
 *   reports it rather than rejecting it as a different error).
 */
export function requestBeneficiaryChange(input: {
  requestId: string;
  employeeId: string;
  currentDestination: unknown;
  proposedDestination: unknown;
  verificationToken: string;
  expiresAt: number;
}): RequestBeneficiaryChangeResult {
  if (typeof input?.requestId !== "string" || input.requestId.trim().length === 0) {
    return {
      ok: false,
      code: "REQUEST_ID_REQUIRED",
      message: "A beneficiary change request requires a non-empty requestId.",
    };
  }

  if (typeof input?.employeeId !== "string" || input.employeeId.trim().length === 0) {
    return {
      ok: false,
      code: "EMPLOYEE_ID_REQUIRED",
      message: "A beneficiary change request requires a non-empty employeeId.",
    };
  }

  if (
    typeof input?.verificationToken !== "string" ||
    input.verificationToken.trim().length === 0
  ) {
    return {
      ok: false,
      code: "TOKEN_REQUIRED",
      message: "A beneficiary change request requires a non-empty verification token.",
    };
  }

  if (typeof input.expiresAt !== "number" || !Number.isFinite(input.expiresAt)) {
    return {
      ok: false,
      code: "INVALID_EXPIRY",
      message: "expiresAt must be a finite epoch-milliseconds timestamp.",
    };
  }

  const reviewed = reviewPayoutDestinationChange({
    currentDestination: input.currentDestination,
    proposedDestination: input.proposedDestination,
  });

  if (!reviewed.ok) {
    return { ok: false, code: reviewed.code, message: reviewed.message };
  }

  return {
    ok: true,
    request: Object.freeze({
      requestId: input.requestId,
      employeeId: input.employeeId,
      verificationToken: input.verificationToken,
      expiresAt: input.expiresAt,
      review: freezeReview(reviewed.review),
    }),
  };
}

/** Runtime shape guard used before reading untrusted persisted requests. */
function isBeneficiaryChangeRequest(value: unknown): value is BeneficiaryChangeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requestId === "string" &&
    candidate.requestId.length > 0 &&
    typeof candidate.employeeId === "string" &&
    candidate.employeeId.length > 0 &&
    typeof candidate.verificationToken === "string" &&
    candidate.verificationToken.length > 0 &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    !!candidate.review &&
    typeof candidate.review === "object"
  );
}

/**
 * Verifies a pending beneficiary change request against a presented token.
 *
 * Checks expiry *before* comparing the token: an expired request reports
 * `REQUEST_EXPIRED` even when the correct token is presented, so a caller
 * cannot learn whether a guessed token would have matched by checking
 * whether the error code changes.
 *
 * Malformed requests and non-finite `now` values are rejected with typed
 * failures instead of throwing, so persisted or user-supplied state cannot
 * crash the verification path.
 *
 * @param request - The pending request, as returned by
 *   {@link requestBeneficiaryChange}.
 * @param presentedToken - The token presented back for verification.
 * @param now - The current time in epoch milliseconds (caller-supplied for
 *   determinism — see {@link requestBeneficiaryChange}'s note on timestamps).
 */
export function verifyBeneficiaryChange(
  request: BeneficiaryChangeRequest,
  presentedToken: unknown,
  now: number
): VerifyBeneficiaryChangeResult {
  const candidate = request as unknown;
  const safeRequestId =
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { requestId?: unknown }).requestId === "string"
      ? (candidate as { requestId: string }).requestId
      : "";

  if (!isBeneficiaryChangeRequest(candidate)) {
    return {
      ok: false,
      requestId: safeRequestId,
      code: "INVALID_REQUEST",
      message: "The beneficiary change request is malformed; recreate it before verifying.",
    };
  }

  if (typeof now !== "number" || !Number.isFinite(now)) {
    return {
      ok: false,
      requestId: request.requestId,
      code: "INVALID_TIMESTAMP",
      message: "Verification time must be a finite epoch-milliseconds timestamp.",
    };
  }

  if (now >= request.expiresAt) {
    return {
      ok: false,
      requestId: request.requestId,
      code: "REQUEST_EXPIRED",
      message: "This beneficiary change request has expired; submit a new request to retry.",
    };
  }

  if (typeof presentedToken !== "string" || presentedToken.length === 0) {
    return {
      ok: false,
      requestId: request.requestId,
      code: "TOKEN_REQUIRED",
      message: "A verification token is required to confirm this beneficiary change.",
    };
  }

  if (presentedToken !== request.verificationToken) {
    return {
      ok: false,
      requestId: request.requestId,
      code: "TOKEN_MISMATCH",
      message: "The presented verification token does not match this request.",
    };
  }

  return {
    ok: true,
    requestId: request.requestId,
    employeeId: request.employeeId,
    review: request.review,
  };
}

// ── Hardened state handling ──────────────────────────────────────────────────

/** Lifecycle states for a beneficiary change request. */
export const BENEFICIARY_CHANGE_STATE_STATUSES = [
  "pending",
  "verified",
  "applied",
  "expired",
  "locked",
] as const;

export type BeneficiaryChangeStateStatus = (typeof BENEFICIARY_CHANGE_STATE_STATUSES)[number];

/** States from which no further beneficiary change transition is possible. */
export const TERMINAL_BENEFICIARY_CHANGE_STATE_STATUSES: readonly BeneficiaryChangeStateStatus[] =
  Object.freeze(["applied", "expired", "locked"]);

/** Allowed lifecycle transitions for a beneficiary change request. */
export const ALLOWED_BENEFICIARY_CHANGE_STATE_TRANSITIONS: Readonly<
  Record<BeneficiaryChangeStateStatus, readonly BeneficiaryChangeStateStatus[]>
> = Object.freeze({
  pending: ["verified", "expired", "locked"],
  verified: ["applied", "expired"],
  applied: [],
  expired: [],
  locked: [],
});

/** Default number of token guesses allowed before a request is locked. */
export const DEFAULT_MAX_BENEFICIARY_CHANGE_VERIFICATION_ATTEMPTS = 5;

/** Hash used as `previousHash` for the first revision of a request. */
export const BENEFICIARY_CHANGE_STATE_GENESIS_HASH = "0".repeat(64);

/** Machine-readable state-management failures for beneficiary changes. */
export type BeneficiaryChangeStateErrorCode =
  | BeneficiaryChangeVerificationErrorCode
  | "DUPLICATE_REQUEST_ID"
  | "INVALID_MAX_ATTEMPTS"
  | "INVALID_TIMESTAMP";

/**
 * Immutable, versioned snapshot of a beneficiary change request's lifecycle.
 *
 * The snapshot intentionally omits the verification token: it is kept only in
 * the manager's private request record and is never written to history.
 */
export interface BeneficiaryChangeState {
  /** Stable identifier of the request this revision describes. */
  readonly requestId: string;
  /** Employee the change applies to. */
  readonly employeeId: string;
  /** Current lifecycle status. */
  readonly status: BeneficiaryChangeStateStatus;
  /** Monotonically increasing revision number (starts at 1). */
  readonly version: number;
  /** Number of failed token presentations recorded so far. */
  readonly attemptCount: number;
  /** Maximum failed token presentations before the request is locked. */
  readonly maxVerificationAttempts: number;
  /** Epoch milliseconds after which verification is no longer possible. */
  readonly expiresAt: number;
  /** When the request was recorded, in epoch milliseconds. */
  readonly requestedAtMs: number;
  /** When this revision was recorded, in epoch milliseconds. */
  readonly updatedAtMs: number;
  /** When the request was successfully verified, if it was. */
  readonly verifiedAtMs?: number;
  /** When the verified change was marked applied, if it was. */
  readonly appliedAtMs?: number;
  /** Machine-readable code of the last failed attempt (never free text). */
  readonly lastErrorCode?: BeneficiaryChangeStateErrorCode;
  /** Privacy-safe reviewed change (masked destinations only). */
  readonly review: BeneficiaryChangeRequest["review"];
  /** SHA-256 hash of this revision's contents. */
  readonly hash: string;
  /** Hash of the previous revision (genesis hash for the first revision). */
  readonly previousHash: string;
}

/** Options for creating and recording beneficiary change state. */
export interface BeneficiaryChangeStateOptions {
  /** Timestamp used when recording the request, in epoch milliseconds. */
  now?: number;
  /** Override the manager's default failed-attempt limit for this request. */
  maxVerificationAttempts?: number;
}

/** Result of a state transition that returns the resulting snapshot. */
export type BeneficiaryChangeStateTransitionResult =
  | { ok: true; state: BeneficiaryChangeState }
  | {
      ok: false;
      requestId: string;
      code: BeneficiaryChangeStateErrorCode;
      message: string;
    };

function normalizeMaxVerificationAttempts(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_BENEFICIARY_CHANGE_VERIFICATION_ATTEMPTS;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError("maxVerificationAttempts must be a positive safe integer.");
  }
  return resolved;
}

function computeBeneficiaryChangeStateHash(state: Omit<BeneficiaryChangeState, "hash">): string {
  const review = state.review;
  const parts = [
    "zkpayroll:beneficiary-change-state:v1",
    state.requestId,
    state.employeeId,
    state.status,
    String(state.version),
    String(state.attemptCount),
    String(state.maxVerificationAttempts),
    String(state.expiresAt),
    String(state.requestedAtMs),
    String(state.updatedAtMs),
    state.verifiedAtMs === undefined ? "" : String(state.verifiedAtMs),
    state.appliedAtMs === undefined ? "" : String(state.appliedAtMs),
    state.lastErrorCode ?? "",
    review.current.kind,
    review.current.preview,
    review.proposed.kind,
    review.proposed.preview,
    review.risk,
    review.warnings.join(","),
    state.previousHash,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function buildBeneficiaryChangeState(
  base: Omit<BeneficiaryChangeState, "hash">
): BeneficiaryChangeState {
  return Object.freeze({
    ...base,
    hash: computeBeneficiaryChangeStateHash(base),
  });
}

/**
 * In-memory coordinator for beneficiary change request state.
 *
 * The manager hardens the workflow beyond the stateless helpers:
 *
 * - **Unique requests** — a `requestId` can only be recorded once.
 * - **Single use** — a successfully verified request cannot be verified
 *   again, and an applied request is terminal.
 * - **Bounded guessing** — failed token presentations are counted and lock
 *   the request after {@link DEFAULT_MAX_BENEFICIARY_CHANGE_VERIFICATION_ATTEMPTS}
 *   (configurable per manager or per request).
 * - **Explicit lifecycle** — `pending → verified → applied`, with `expired`
 *   and `locked` terminal failure states.
 * - **Tamper-evident history** — revisions are SHA-256 hash-chained and can
 *   be checked with {@link BeneficiaryChangeStateManager.verifyHistoryIntegrity}.
 *
 * Persist snapshots durably alongside employee records in production; the
 * manager only demonstrates the validation and history semantics a durable
 * store should mirror. Verification tokens stay in the private request record
 * and never appear in snapshots or history.
 */
export class BeneficiaryChangeStateManager {
  private readonly requests = new Map<string, BeneficiaryChangeRequest>();
  private readonly states = new Map<string, BeneficiaryChangeState>();
  private readonly history = new Map<string, BeneficiaryChangeState[]>();
  private readonly defaultMaxVerificationAttempts: number;

  constructor(options: BeneficiaryChangeStateOptions = {}) {
    this.defaultMaxVerificationAttempts = normalizeMaxVerificationAttempts(
      options.maxVerificationAttempts
    );
  }

  /**
   * Creates, reviews, and records a pending beneficiary change request.
   *
   * Duplicate request ids are rejected rather than overwriting a pending or
   * completed request. A request whose `expiresAt` is already in the past is
   * recorded as `expired` immediately.
   */
  public requestChange(
    input: {
      requestId: string;
      employeeId: string;
      currentDestination: unknown;
      proposedDestination: unknown;
      verificationToken: string;
      expiresAt: number;
    },
    options: BeneficiaryChangeStateOptions = {}
  ): RequestBeneficiaryChangeResult {
    const requested = requestBeneficiaryChange(input);
    if (!requested.ok) return requested;

    const { requestId } = requested.request;
    if (this.states.has(requestId)) {
      return {
        ok: false,
        code: "DUPLICATE_REQUEST_ID",
        message: "A beneficiary change request with this requestId already exists.",
      };
    }

    const now = options.now ?? Date.now();
    if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
      return {
        ok: false,
        code: "INVALID_TIMESTAMP",
        message: "Request time must be a non-negative finite epoch-milliseconds timestamp.",
      };
    }

    const maxVerificationAttempts = normalizeMaxVerificationAttempts(
      options.maxVerificationAttempts ?? this.defaultMaxVerificationAttempts
    );
    const status: BeneficiaryChangeStateStatus =
      now >= requested.request.expiresAt ? "expired" : "pending";
    const state = buildBeneficiaryChangeState({
      requestId,
      employeeId: requested.request.employeeId,
      status,
      version: 1,
      attemptCount: 0,
      maxVerificationAttempts,
      expiresAt: requested.request.expiresAt,
      requestedAtMs: now,
      updatedAtMs: now,
      ...(status === "expired" ? { lastErrorCode: "REQUEST_EXPIRED" as const } : {}),
      review: requested.request.review,
      previousHash: BENEFICIARY_CHANGE_STATE_GENESIS_HASH,
    });

    this.requests.set(requestId, requested.request);
    this.registerState(state);
    return requested;
  }

  /** Read the latest snapshot for a request, or `undefined` when unknown. */
  public getState(requestId: string): BeneficiaryChangeState | undefined {
    return this.states.get(requestId);
  }

  /** Read all revisions for a request, oldest first. */
  public getHistory(requestId: string): readonly BeneficiaryChangeState[] {
    return Object.freeze([...(this.history.get(requestId) ?? [])]);
  }

  /** Register a previously persisted revision (e.g. on startup). */
  public registerState(state: BeneficiaryChangeState): void {
    const frozen = Object.freeze(state);
    this.states.set(frozen.requestId, frozen);
    const revisions = this.history.get(frozen.requestId) ?? [];
    revisions.push(frozen);
    this.history.set(frozen.requestId, revisions);
  }

  /**
   * Verifies a recorded request exactly once.
   *
   * Expiry is checked before the token, and unknown, already-verified,
   * already-applied, expired, and locked requests are rejected without
   * touching the token comparison. Failed presentations increment the
   * attempt counter; reaching the limit moves the request to `locked`.
   */
  public verifyChange(
    requestId: string,
    presentedToken: unknown,
    now: number
  ): VerifyBeneficiaryChangeResult {
    const state = this.states.get(requestId);
    const request = this.requests.get(requestId);

    if (!state || !request) {
      return {
        ok: false,
        requestId,
        code: "REQUEST_NOT_FOUND",
        message: "No beneficiary change request exists for this requestId.",
      };
    }

    if (state.status === "verified") {
      return {
        ok: false,
        requestId,
        code: "REQUEST_ALREADY_VERIFIED",
        message: "This beneficiary change request has already been verified and cannot be replayed.",
      };
    }

    if (state.status === "applied") {
      return {
        ok: false,
        requestId,
        code: "REQUEST_ALREADY_APPLIED",
        message: "This beneficiary change has already been applied.",
      };
    }

    if (state.status === "expired") {
      return {
        ok: false,
        requestId,
        code: "REQUEST_EXPIRED",
        message: "This beneficiary change request has expired; submit a new request to retry.",
      };
    }

    if (state.status === "locked") {
      return {
        ok: false,
        requestId,
        code: "VERIFICATION_ATTEMPTS_EXHAUSTED",
        message: "Too many incorrect verification attempts; submit a new request to retry.",
      };
    }

    if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
      return {
        ok: false,
        requestId,
        code: "INVALID_TIMESTAMP",
        message: "Verification time must be a non-negative finite epoch-milliseconds timestamp.",
      };
    }

    const updatedAtMs = Math.max(now, state.updatedAtMs);

    if (now >= state.expiresAt) {
      this.recordTransition(state, {
        status: "expired",
        updatedAtMs,
        lastErrorCode: "REQUEST_EXPIRED",
      });
      return {
        ok: false,
        requestId,
        code: "REQUEST_EXPIRED",
        message: "This beneficiary change request has expired; submit a new request to retry.",
      };
    }

    if (typeof presentedToken !== "string" || presentedToken.length === 0) {
      return {
        ok: false,
        requestId,
        code: "TOKEN_REQUIRED",
        message: "A verification token is required to confirm this beneficiary change.",
      };
    }

    if (presentedToken !== request.verificationToken) {
      const attemptCount = state.attemptCount + 1;
      const locked = attemptCount >= state.maxVerificationAttempts;
      this.recordTransition(state, {
        status: locked ? "locked" : "pending",
        attemptCount,
        updatedAtMs,
        lastErrorCode: "TOKEN_MISMATCH",
      });
      return {
        ok: false,
        requestId,
        code: "TOKEN_MISMATCH",
        message: "The presented verification token does not match this request.",
      };
    }

    this.recordTransition(state, {
      status: "verified",
      updatedAtMs,
      verifiedAtMs: now,
      lastErrorCode: undefined,
    });

    return {
      ok: true,
      requestId,
      employeeId: request.employeeId,
      review: request.review,
    };
  }

  /**
   * Marks a verified request as applied, completing the workflow.
   *
   * Only a `verified` request can be applied, and it can be applied once.
   */
  public markApplied(
    requestId: string,
    now: number = Date.now()
  ): BeneficiaryChangeStateTransitionResult {
    const state = this.states.get(requestId);
    if (!state) {
      return {
        ok: false,
        requestId,
        code: "REQUEST_NOT_FOUND",
        message: "No beneficiary change request exists for this requestId.",
      };
    }

    if (state.status === "applied") {
      return {
        ok: false,
        requestId,
        code: "REQUEST_ALREADY_APPLIED",
        message: "This beneficiary change has already been applied.",
      };
    }

    if (state.status === "pending") {
      return {
        ok: false,
        requestId,
        code: "REQUEST_NOT_VERIFIED",
        message: "Verify the beneficiary change request before applying it.",
      };
    }

    if (state.status === "expired") {
      return {
        ok: false,
        requestId,
        code: "REQUEST_EXPIRED",
        message: "This beneficiary change request has expired; submit a new request to retry.",
      };
    }

    if (state.status === "locked") {
      return {
        ok: false,
        requestId,
        code: "VERIFICATION_ATTEMPTS_EXHAUSTED",
        message: "Too many incorrect verification attempts; submit a new request to retry.",
      };
    }

    if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
      return {
        ok: false,
        requestId,
        code: "INVALID_TIMESTAMP",
        message: "Application time must be a non-negative finite epoch-milliseconds timestamp.",
      };
    }

    const next = this.recordTransition(state, {
      status: "applied",
      updatedAtMs: Math.max(now, state.updatedAtMs),
      appliedAtMs: now,
      lastErrorCode: undefined,
    });
    return { ok: true, state: next };
  }

  /**
   * Verify the hash chain of a request's revisions.
   *
   * @returns `{ valid: true }` or the first broken revision with a reason.
   */
  public verifyHistoryIntegrity(requestId: string): {
    valid: boolean;
    brokenAt?: number;
    reason?: string;
  } {
    const revisions = this.history.get(requestId);
    if (!revisions || revisions.length === 0) {
      return { valid: true };
    }

    for (let i = 0; i < revisions.length; i++) {
      const entry = revisions[i];
      const expectedPrevious =
        i === 0 ? BENEFICIARY_CHANGE_STATE_GENESIS_HASH : revisions[i - 1].hash;

      if (entry.previousHash !== expectedPrevious) {
        return {
          valid: false,
          brokenAt: i + 1,
          reason: `Hash link broken at revision ${entry.version}.`,
        };
      }

      const { hash, ...rest } = entry;
      if (computeBeneficiaryChangeStateHash(rest) !== hash) {
        return {
          valid: false,
          brokenAt: i + 1,
          reason: `Integrity check failed at revision ${entry.version}.`,
        };
      }
    }

    return { valid: true };
  }

  private recordTransition(
    current: BeneficiaryChangeState,
    changes: {
      status: BeneficiaryChangeStateStatus;
      attemptCount?: number;
      updatedAtMs: number;
      verifiedAtMs?: number;
      appliedAtMs?: number;
      lastErrorCode?: BeneficiaryChangeStateErrorCode;
    }
  ): BeneficiaryChangeState {
    const next = buildBeneficiaryChangeState({
      requestId: current.requestId,
      employeeId: current.employeeId,
      status: changes.status,
      version: current.version + 1,
      attemptCount: changes.attemptCount ?? current.attemptCount,
      maxVerificationAttempts: current.maxVerificationAttempts,
      expiresAt: current.expiresAt,
      requestedAtMs: current.requestedAtMs,
      updatedAtMs: changes.updatedAtMs,
      ...(changes.verifiedAtMs !== undefined
        ? { verifiedAtMs: changes.verifiedAtMs }
        : current.verifiedAtMs !== undefined
          ? { verifiedAtMs: current.verifiedAtMs }
          : {}),
      ...(changes.appliedAtMs !== undefined
        ? { appliedAtMs: changes.appliedAtMs }
        : current.appliedAtMs !== undefined
          ? { appliedAtMs: current.appliedAtMs }
          : {}),
      ...(changes.lastErrorCode !== undefined
        ? { lastErrorCode: changes.lastErrorCode }
        : {}),
      review: current.review,
      previousHash: current.hash,
    });
    this.registerState(next);
    return next;
  }
}
