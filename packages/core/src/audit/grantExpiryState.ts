/**
 * Hardened State Handling for Auditor Grant Expiry (#908)
 *
 * Auditor grants outlive the dashboards and operators that issued them. A stale
 * write can make a revoked or purged grant appear usable again, which is why
 * this module treats expiry as a versioned, hash-chained state machine rather
 * than a derived label.
 *
 * The state stores a redacted auditor identifier only. Raw auditor ids, view
 * keys, employee records, and payroll amounts never enter a revision, its hash,
 * its history, or an error.
 *
 * @module
 */

import { createHash } from "crypto";
import {
  DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS,
  DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS,
  redactAuditorId,
} from "./accessExpiry";
import { MAX_GRANT_EXPIRY_WARNING_THRESHOLD_MS } from "./grantExpiryValidation";
import { AuditorGrantExpiryError, AuditorGrantExpiryErrorCode } from "./grantExpiryErrors";

const MAX_GRANT_ID_LENGTH = 200;

export const AUDITOR_GRANT_EXPIRY_STATE_STATUSES = [
  "active",
  "expiring_soon",
  "expired",
  "purged",
  "revoked",
] as const;

export type AuditorGrantExpiryStateStatus = (typeof AUDITOR_GRANT_EXPIRY_STATE_STATUSES)[number];

export const TERMINAL_AUDITOR_GRANT_EXPIRY_STATUSES: readonly AuditorGrantExpiryStateStatus[] =
  Object.freeze(["purged", "revoked"]);

export const ALLOWED_AUDITOR_GRANT_EXPIRY_TRANSITIONS: Readonly<
  Record<AuditorGrantExpiryStateStatus, readonly AuditorGrantExpiryStateStatus[]>
> = Object.freeze({
  active: Object.freeze(["active", "expiring_soon", "expired", "revoked"] as const),
  expiring_soon: Object.freeze(["active", "expiring_soon", "expired", "revoked"] as const),
  expired: Object.freeze(["expired", "purged", "revoked"] as const),
  purged: Object.freeze([] as const),
  revoked: Object.freeze([] as const),
});

export const AUDITOR_GRANT_EXPIRY_GENESIS_HASH = "0".repeat(64);

export interface AuditorGrantExpiryState {
  readonly grantId: string;
  readonly redactedAuditorId: string;
  readonly revision: number;
  readonly status: AuditorGrantExpiryStateStatus;
  readonly grantedAtMs: number;
  readonly expiresAtMs: number;
  readonly referenceTimeMs: number;
  readonly warningThresholdMs: number;
  readonly retentionWindowMs: number;
  readonly previousHash: string;
  readonly hash: string;
}

export interface AuditorGrantExpiryUpdateInput {
  grantId: string;
  expectedRevision: number;
  targetStatus?: AuditorGrantExpiryStateStatus;
  auditorId?: string;
  grantedAtMs?: number;
  expiresAtMs?: number;
  referenceTimeMs?: number;
  warningThresholdMs?: number;
  retentionWindowMs?: number;
}

export type AuditorGrantExpiryInitializationInput = Omit<
  AuditorGrantExpiryUpdateInput,
  "expectedRevision"
> & {
  /** Initialization always starts at revision 0; the first state is revision 1. */
  expectedRevision?: 0;
};

export interface AuditorGrantExpiryStateOptions {
  now?: number;
  maxLifetimeMs?: number;
}

export interface AuditorGrantExpiryTransitionResult {
  readonly success: true;
  readonly previousState?: AuditorGrantExpiryState;
  readonly state: AuditorGrantExpiryState;
  readonly appliedAtMs: number;
}

function fail(
  code: AuditorGrantExpiryErrorCode,
  message?: string,
  context: Record<string, unknown> = {}
): never {
  throw new AuditorGrantExpiryError(
    message ?? `Auditor grant expiry validation failed: ${code.toLowerCase()}.`,
    code,
    [],
    context
  );
}

function assertIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(AuditorGrantExpiryErrorCode.INVALID_INPUT, undefined, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_GRANT_ID_LENGTH) {
    fail(AuditorGrantExpiryErrorCode.INVALID_INPUT, undefined, { field });
  }
  return trimmed;
}

function assertTimestamp(value: unknown, field: string, code: AuditorGrantExpiryErrorCode): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(code, undefined, { field });
  }
  return value;
}

/** Derive the documented expiry status from explicit timestamps. */
export function deriveAuditorGrantExpiryStateStatus(
  expiresAtMs: number,
  referenceTimeMs: number,
  warningThresholdMs: number
): AuditorGrantExpiryStateStatus {
  if (expiresAtMs <= referenceTimeMs) return "expired";
  if (expiresAtMs - referenceTimeMs <= warningThresholdMs) return "expiring_soon";
  return "active";
}

/** Compute a deterministic SHA-256 hash for one grant-expiry revision. */
export function computeAuditorGrantExpiryStateHash(
  state: Omit<AuditorGrantExpiryState, "hash">
): string {
  const parts = [
    "zkpayroll:auditor-grant-expiry:v1",
    state.grantId,
    state.redactedAuditorId,
    String(state.revision),
    state.status,
    String(state.grantedAtMs),
    String(state.expiresAtMs),
    String(state.referenceTimeMs),
    String(state.warningThresholdMs),
    String(state.retentionWindowMs),
    state.previousHash,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function buildState(base: Omit<AuditorGrantExpiryState, "hash">): AuditorGrantExpiryState {
  return Object.freeze({ ...base, hash: computeAuditorGrantExpiryStateHash(base) });
}

/**
 * Validate and apply one auditor grant expiry-state transition.
 *
 * @throws {AuditorGrantExpiryError} when any invariant is violated.
 */
export function applyAuditorGrantExpiryUpdate(
  current: AuditorGrantExpiryState | null | undefined,
  input: AuditorGrantExpiryUpdateInput,
  options: AuditorGrantExpiryStateOptions = {}
): AuditorGrantExpiryTransitionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(AuditorGrantExpiryErrorCode.INVALID_INPUT);
  }

  const grantId = assertIdentifier(input.grantId, "grantId");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    fail(AuditorGrantExpiryErrorCode.STALE_REVISION, undefined, {
      expectedRevision: input.expectedRevision,
    });
  }

  if (current) {
    if (current.grantId !== grantId) {
      fail(AuditorGrantExpiryErrorCode.INVALID_INPUT, undefined, { field: "grantId" });
    }
    if (current.revision !== input.expectedRevision) {
      fail(AuditorGrantExpiryErrorCode.STALE_REVISION, undefined, {
        expectedRevision: input.expectedRevision,
        revision: current.revision,
      });
    }
    if (TERMINAL_AUDITOR_GRANT_EXPIRY_STATUSES.includes(current.status)) {
      fail(AuditorGrantExpiryErrorCode.TERMINAL_STATE, undefined, { status: current.status });
    }
  } else if (input.expectedRevision !== 0) {
    fail(AuditorGrantExpiryErrorCode.STALE_REVISION, undefined, {
      expectedRevision: input.expectedRevision,
    });
  }

  const grantedAtMs = assertTimestamp(
    input.grantedAtMs ?? current?.grantedAtMs,
    "grantedAtMs",
    AuditorGrantExpiryErrorCode.GRANTED_AT_INVALID
  );
  const expiresAtMs = assertTimestamp(
    input.expiresAtMs ?? current?.expiresAtMs,
    "expiresAtMs",
    AuditorGrantExpiryErrorCode.EXPIRES_AT_INVALID
  );
  if (expiresAtMs <= grantedAtMs) {
    fail(AuditorGrantExpiryErrorCode.EXPIRES_BEFORE_GRANTED);
  }
  if (
    current &&
    ((input.grantedAtMs !== undefined && input.grantedAtMs !== current.grantedAtMs) ||
      (input.expiresAtMs !== undefined && input.expiresAtMs !== current.expiresAtMs))
  ) {
    fail(AuditorGrantExpiryErrorCode.INVALID_INPUT, undefined, { field: "expiresAtMs" });
  }
  if (
    options.maxLifetimeMs !== undefined &&
    (!Number.isFinite(options.maxLifetimeMs) || options.maxLifetimeMs <= 0)
  ) {
    fail(AuditorGrantExpiryErrorCode.MAX_LIFETIME_EXCEEDED);
  }
  if (options.maxLifetimeMs !== undefined && expiresAtMs - grantedAtMs > options.maxLifetimeMs) {
    fail(AuditorGrantExpiryErrorCode.MAX_LIFETIME_EXCEEDED, undefined, {
      maxLifetimeMs: options.maxLifetimeMs,
    });
  }

  const warningThresholdMs =
    input.warningThresholdMs ??
    current?.warningThresholdMs ??
    DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS;
  if (
    typeof warningThresholdMs !== "number" ||
    !Number.isFinite(warningThresholdMs) ||
    warningThresholdMs < 0 ||
    warningThresholdMs > MAX_GRANT_EXPIRY_WARNING_THRESHOLD_MS
  ) {
    fail(AuditorGrantExpiryErrorCode.WARNING_THRESHOLD_INVALID);
  }
  const retentionWindowMs =
    input.retentionWindowMs ??
    current?.retentionWindowMs ??
    DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS;
  if (
    typeof retentionWindowMs !== "number" ||
    !Number.isFinite(retentionWindowMs) ||
    retentionWindowMs < 0
  ) {
    fail(AuditorGrantExpiryErrorCode.RETENTION_WINDOW_INVALID);
  }
  if (
    current &&
    ((input.warningThresholdMs !== undefined &&
      input.warningThresholdMs !== current.warningThresholdMs) ||
      (input.retentionWindowMs !== undefined &&
        input.retentionWindowMs !== current.retentionWindowMs))
  ) {
    fail(AuditorGrantExpiryErrorCode.INVALID_INPUT, undefined, { field: "warningThresholdMs" });
  }

  const referenceTimeMs = assertTimestamp(
    input.referenceTimeMs ?? options.now ?? Date.now(),
    "referenceTimeMs",
    AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID
  );
  if (current && referenceTimeMs < current.referenceTimeMs) {
    fail(AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID, undefined, {
      field: "referenceTimeMs",
    });
  }

  const derivedStatus = deriveAuditorGrantExpiryStateStatus(
    expiresAtMs,
    referenceTimeMs,
    warningThresholdMs
  );
  const targetStatus = input.targetStatus ?? derivedStatus;
  if (!AUDITOR_GRANT_EXPIRY_STATE_STATUSES.includes(targetStatus)) {
    fail(AuditorGrantExpiryErrorCode.INVALID_INPUT, undefined, { field: "targetStatus" });
  }

  if (current && targetStatus !== current.status) {
    const allowed = ALLOWED_AUDITOR_GRANT_EXPIRY_TRANSITIONS[current.status];
    if (!allowed.includes(targetStatus)) {
      fail(AuditorGrantExpiryErrorCode.INVALID_STATE_TRANSITION, undefined, {
        status: current.status,
      });
    }
  }

  if (targetStatus === "purged") {
    if (derivedStatus !== "expired") {
      fail(AuditorGrantExpiryErrorCode.INVALID_STATE_TRANSITION, undefined, {
        field: "expiresAtMs",
      });
    }
    if (referenceTimeMs - expiresAtMs <= retentionWindowMs) {
      fail(AuditorGrantExpiryErrorCode.INVALID_STATE_TRANSITION, undefined, {
        retentionWindowMs,
      });
    }
  }
  if (targetStatus === "active" || targetStatus === "expiring_soon") {
    if (derivedStatus !== targetStatus) {
      fail(AuditorGrantExpiryErrorCode.INVALID_STATE_TRANSITION, undefined, {
        field: "referenceTimeMs",
      });
    }
  }
  if (targetStatus === "expired" && derivedStatus !== "expired") {
    fail(AuditorGrantExpiryErrorCode.INVALID_STATE_TRANSITION, undefined, {
      field: "referenceTimeMs",
    });
  }

  const redactedAuditorId = redactAuditorId(
    typeof input.auditorId === "string" ? input.auditorId : undefined
  );

  const state = buildState({
    grantId,
    redactedAuditorId: current?.redactedAuditorId ?? redactedAuditorId,
    revision: current ? current.revision + 1 : 1,
    status: targetStatus,
    grantedAtMs,
    expiresAtMs,
    referenceTimeMs,
    warningThresholdMs,
    retentionWindowMs,
    previousHash: current ? current.hash : AUDITOR_GRANT_EXPIRY_GENESIS_HASH,
  });

  return Object.freeze({
    success: true as const,
    previousState: current ?? undefined,
    state,
    appliedAtMs: referenceTimeMs,
  });
}

/** In-memory coordinator for versioned auditor grant expiry state. */
export class AuditorGrantExpiryStateManager {
  private readonly states = new Map<string, AuditorGrantExpiryState>();
  private readonly history = new Map<string, AuditorGrantExpiryState[]>();

  constructor(initialStates: readonly AuditorGrantExpiryState[] = []) {
    for (const state of initialStates) this.registerState(state);
  }

  /** Register a previously persisted revision, e.g. during startup. */
  public registerState(state: AuditorGrantExpiryState): void {
    this.states.set(state.grantId, state);
    const revisions = this.history.get(state.grantId) ?? [];
    revisions.push(state);
    this.history.set(state.grantId, revisions);
  }

  /** Initialize a grant in the status derived from its explicit timestamps. */
  public initializeGrant(
    input: AuditorGrantExpiryInitializationInput,
    options: AuditorGrantExpiryStateOptions = {}
  ): AuditorGrantExpiryTransitionResult {
    if (this.states.has(input.grantId)) {
      fail(AuditorGrantExpiryErrorCode.DUPLICATE_GRANT, undefined, { field: "grantId" });
    }
    const result = applyAuditorGrantExpiryUpdate(null, { ...input, expectedRevision: 0 }, options);
    this.registerState(result.state);
    return result;
  }

  /** Apply a transition and record the resulting revision. */
  public update(
    input: AuditorGrantExpiryUpdateInput,
    options: AuditorGrantExpiryStateOptions = {}
  ): AuditorGrantExpiryTransitionResult {
    const current = this.states.get(input.grantId);
    if (!current) {
      fail(AuditorGrantExpiryErrorCode.INVALID_INPUT, undefined, { field: "grantId" });
    }
    const result = applyAuditorGrantExpiryUpdate(current, input, options);
    this.registerState(result.state);
    return result;
  }

  /** Read the latest revision, or `undefined` for an unknown grant. */
  public getState(grantId: string): AuditorGrantExpiryState | undefined {
    return this.states.get(grantId);
  }

  /** Read all revisions oldest-first. */
  public getHistory(grantId: string): readonly AuditorGrantExpiryState[] {
    return Object.freeze([...(this.history.get(grantId) ?? [])]);
  }

  /** Verify the hash chain of every recorded revision. */
  public verifyIntegrity(grantId: string): {
    valid: boolean;
    brokenAt?: number;
    reason?: string;
  } {
    const revisions = this.history.get(grantId);
    if (!revisions || revisions.length === 0) return { valid: true };

    for (let i = 0; i < revisions.length; i++) {
      const entry = revisions[i];
      const expectedPrevious = i === 0 ? AUDITOR_GRANT_EXPIRY_GENESIS_HASH : revisions[i - 1].hash;
      if (entry.previousHash !== expectedPrevious) {
        return {
          valid: false,
          brokenAt: i + 1,
          reason: `Integrity check failed: hash link broken at revision ${entry.revision}.`,
        };
      }
      const { hash, ...rest } = entry;
      if (computeAuditorGrantExpiryStateHash(rest) !== hash) {
        return {
          valid: false,
          brokenAt: i + 1,
          reason: `Integrity check failed at revision ${entry.revision}.`,
        };
      }
    }
    return { valid: true };
  }
}
