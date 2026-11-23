/**
 * Safe Errors for Auditor Grant Expiry (#905, #908)
 *
 * Auditor grant records feed compliance dashboards and, in some integrations,
 * access gates. Failures must therefore be *actionable* to the operator while
 * remaining *privacy preserving*: an error may name the offending field and the
 * remediation, but it must never echo the auditor's address, view key, employee
 * records, or amounts.
 *
 * This module exposes:
 *
 * - {@link AuditorGrantExpiryError} — typed validation failure carrying stable
 *   codes and structured issues.
 * - {@link AuditorGrantExpiredError} — thrown when access is denied because the
 *   grant has lapsed; carries only a redacted auditor identifier and a bounded
 *   expiry timestamp.
 * - Helpers to detect, extract, and format these errors for UI/CLI output.
 *
 * @module
 */

import { ZkPayrollError } from "../core/errors";
import { redactAuditorId } from "./accessExpiry";

/** Stable error codes for auditor grant expiry failures. */
export const AuditorGrantExpiryErrorCode = {
  /** The supplied expiry descriptor is not a valid object. */
  INVALID_INPUT: "AUDITOR_GRANT_EXPIRY_INVALID_INPUT",
  /** The auditor identifier is not a usable non-empty string. */
  AUDITOR_ID_INVALID: "AUDITOR_GRANT_EXPIRY_AUDITOR_ID_INVALID",
  /** No expiration timestamp was recorded for the grant. */
  EXPIRES_AT_REQUIRED: "AUDITOR_GRANT_EXPIRY_EXPIRES_AT_REQUIRED",
  /** The expiration timestamp could not be parsed. */
  EXPIRES_AT_INVALID: "AUDITOR_GRANT_EXPIRY_EXPIRES_AT_INVALID",
  /** The optional grant issuance timestamp could not be parsed. */
  GRANTED_AT_INVALID: "AUDITOR_GRANT_EXPIRY_GRANTED_AT_INVALID",
  /** The grant expires at or before it was issued. */
  EXPIRES_BEFORE_GRANTED: "AUDITOR_GRANT_EXPIRY_BEFORE_GRANTED",
  /** The warning threshold is negative, non-finite, or unreasonably large. */
  WARNING_THRESHOLD_INVALID: "AUDITOR_GRANT_EXPIRY_WARNING_THRESHOLD_INVALID",
  /** The retention window is negative or non-finite. */
  RETENTION_WINDOW_INVALID: "AUDITOR_GRANT_EXPIRY_RETENTION_WINDOW_INVALID",
  /** The reference time is not a usable timestamp. */
  REFERENCE_TIME_INVALID: "AUDITOR_GRANT_EXPIRY_REFERENCE_TIME_INVALID",
  /** The grant lifetime exceeds the configured maximum. */
  MAX_LIFETIME_EXCEEDED: "AUDITOR_GRANT_EXPIRY_MAX_LIFETIME_EXCEEDED",
  /** Access was requested with an expired (or unknown) grant. */
  GRANT_EXPIRED: "AUDITOR_GRANT_EXPIRED",
  /** A grant identifier is missing or already registered. */
  DUPLICATE_GRANT: "AUDITOR_GRANT_EXPIRY_DUPLICATE_GRANT",
  /** The update was derived from a stale state revision. */
  STALE_REVISION: "AUDITOR_GRANT_EXPIRY_STALE_REVISION",
  /** The requested lifecycle transition is not permitted. */
  INVALID_STATE_TRANSITION: "AUDITOR_GRANT_EXPIRY_INVALID_STATE_TRANSITION",
  /** The grant state is terminal and cannot be modified. */
  TERMINAL_STATE: "AUDITOR_GRANT_EXPIRY_TERMINAL_STATE",
  /** Persisted grant-expiry state failed its hash-chain verification. */
  STATE_INTEGRITY_COMPROMISED: "AUDITOR_GRANT_EXPIRY_STATE_INTEGRITY_COMPROMISED",
} as const;

export type AuditorGrantExpiryErrorCode =
  (typeof AuditorGrantExpiryErrorCode)[keyof typeof AuditorGrantExpiryErrorCode];

/**
 * User-facing, privacy-safe messages keyed by error code.
 * Messages never interpolate auditor identifiers or payroll values.
 */
export const AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES: Record<AuditorGrantExpiryErrorCode, string> = {
  [AuditorGrantExpiryErrorCode.INVALID_INPUT]:
    "Auditor grant expiry details must be provided as an object.",
  [AuditorGrantExpiryErrorCode.AUDITOR_ID_INVALID]:
    "Auditor identifier must be a non-empty string of at most 128 characters.",
  [AuditorGrantExpiryErrorCode.EXPIRES_AT_REQUIRED]:
    "Auditor grant expiry requires an expiration timestamp.",
  [AuditorGrantExpiryErrorCode.EXPIRES_AT_INVALID]:
    "Auditor grant expiration must be a valid epoch-millisecond, ISO-8601, or Date value.",
  [AuditorGrantExpiryErrorCode.GRANTED_AT_INVALID]:
    "Auditor grant issuance time must be a valid epoch-millisecond, ISO-8601, or Date value.",
  [AuditorGrantExpiryErrorCode.EXPIRES_BEFORE_GRANTED]:
    "Auditor grant expiration must be after the grant issuance time.",
  [AuditorGrantExpiryErrorCode.WARNING_THRESHOLD_INVALID]:
    "The expiring-soon warning threshold must be a non-negative duration of at most 365 days.",
  [AuditorGrantExpiryErrorCode.RETENTION_WINDOW_INVALID]:
    "The audit access retention window must be a non-negative, finite duration in milliseconds.",
  [AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID]:
    "The reference time must be a valid epoch-millisecond or Date value.",
  [AuditorGrantExpiryErrorCode.MAX_LIFETIME_EXCEEDED]:
    "The auditor grant lifetime exceeds the maximum allowed duration.",
  [AuditorGrantExpiryErrorCode.GRANT_EXPIRED]:
    "Auditor access has expired. Request a new grant before accessing payroll data.",
  [AuditorGrantExpiryErrorCode.DUPLICATE_GRANT]:
    "A grant state is already registered for this grant. Reload it before applying another update.",
  [AuditorGrantExpiryErrorCode.STALE_REVISION]:
    "Auditor grant state changed since it was read. Refresh the grant and retry.",
  [AuditorGrantExpiryErrorCode.INVALID_STATE_TRANSITION]:
    "The requested auditor grant expiry transition is not permitted.",
  [AuditorGrantExpiryErrorCode.TERMINAL_STATE]:
    "This auditor grant state is terminal and cannot be modified.",
  [AuditorGrantExpiryErrorCode.STATE_INTEGRITY_COMPROMISED]:
    "The auditor grant expiry state hash is invalid or does not match its contents.",
};

const SAFE_CONTEXT_KEYS = new Set([
  "field",
  "code",
  "issueCount",
  "status",
  "expectedRevision",
  "revision",
  "grantedAtMs",
  "expiresAtMs",
  "referenceTimeMs",
  "warningThresholdMs",
  "retentionWindowMs",
  "maxLifetimeMs",
  "redactedAuditorId",
]);

function safeContext(context: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!SAFE_CONTEXT_KEYS.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    } else if (typeof value === "string" && value.length <= 128) {
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

/** A single structured validation issue for auditor grant expiry. */
export interface AuditorGrantExpiryIssue {
  /** Stable machine-readable code. */
  readonly code: AuditorGrantExpiryErrorCode;
  /** Dot-notation field path that failed validation. */
  readonly field: string;
  /** Safe, human-readable explanation. */
  readonly message: string;
}

/**
 * Typed, SDK-safe error for auditor grant expiry validation failures.
 * Extends {@link ZkPayrollError} so it can be caught centrally.
 */
export class AuditorGrantExpiryError extends ZkPayrollError {
  public readonly expiryCode: AuditorGrantExpiryErrorCode;
  public readonly issues: readonly AuditorGrantExpiryIssue[];

  constructor(
    message: string,
    code: AuditorGrantExpiryErrorCode = AuditorGrantExpiryErrorCode.INVALID_INPUT,
    issues: readonly AuditorGrantExpiryIssue[] = [],
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, code, safeContext(context), cause);
    this.name = "AuditorGrantExpiryError";
    this.expiryCode = code;
    this.issues = Object.freeze(
      issues.map((entry) =>
        Object.freeze({ code: entry.code, field: entry.field, message: entry.message })
      )
    );
  }
}

/**
 * Safe error raised when payroll access is denied because an auditor grant has
 * expired (or carries no usable expiration).
 *
 * The identifier is redacted before it reaches `message` or `context`, so the
 * error may be logged verbatim. The expiry timestamp is included only as a
 * bounded ISO-8601 value.
 */
export class AuditorGrantExpiredError extends AuditorGrantExpiryError {
  /** Redacted auditor identifier, safe for logs and UI. */
  public readonly redactedAuditorId: string;

  constructor(
    auditorId: string | undefined,
    expiresAtMs: number | null,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    const redacted = redactAuditorId(typeof auditorId === "string" ? auditorId : undefined);
    const hasExpiry = typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs);
    const detail = hasExpiry
      ? `it expired at ${new Date(expiresAtMs).toISOString()}`
      : "no expiration is recorded";
    super(
      `${AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES[AuditorGrantExpiryErrorCode.GRANT_EXPIRED]} (${redacted}: ${detail})`,
      AuditorGrantExpiryErrorCode.GRANT_EXPIRED,
      [
        {
          code: AuditorGrantExpiryErrorCode.GRANT_EXPIRED,
          field: "expiresAt",
          message: AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES[AuditorGrantExpiryErrorCode.GRANT_EXPIRED],
        },
      ],
      { ...context, redactedAuditorId: redacted },
      cause
    );
    this.name = "AuditorGrantExpiredError";
    this.redactedAuditorId = redacted;
  }
}

function resolveErrorCode(error: unknown): AuditorGrantExpiryErrorCode | undefined {
  if (error instanceof AuditorGrantExpiryError) return error.expiryCode;
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  const raw = candidate.expiryCode ?? candidate.code;
  if (typeof raw !== "string") return undefined;
  return Object.values(AuditorGrantExpiryErrorCode).includes(raw as AuditorGrantExpiryErrorCode)
    ? (raw as AuditorGrantExpiryErrorCode)
    : undefined;
}

/** Type guard for {@link AuditorGrantExpiryError} and subclasses. */
export function isAuditorGrantExpiryError(error: unknown): error is AuditorGrantExpiryError {
  return error instanceof AuditorGrantExpiryError || resolveErrorCode(error) !== undefined;
}

/** Type guard for {@link AuditorGrantExpiredError}. */
export function isAuditorGrantExpiredError(error: unknown): error is AuditorGrantExpiredError {
  return error instanceof AuditorGrantExpiredError;
}

/**
 * Extract a safe, canonical message for an auditor grant expiry error.
 * Arbitrary error messages are never returned because they may contain private
 * payroll data.
 */
export function getAuditorGrantExpiryErrorMessage(error: unknown): string {
  const code = resolveErrorCode(error);
  if (code !== undefined) {
    return AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES[code];
  }
  return "An auditor grant expiry error occurred. Verify the grant and retry.";
}

/**
 * Format an auditor grant expiry error into an actionable message listing
 * every failing field. The output never includes raw auditor identifiers.
 */
export function formatAuditorGrantExpiryError(error: unknown): string {
  const base = getAuditorGrantExpiryErrorMessage(error);
  const issues =
    error instanceof AuditorGrantExpiryError ||
    (error && typeof error === "object" && "issues" in error)
      ? (error as { issues?: unknown }).issues
      : undefined;
  if (!Array.isArray(issues) || issues.length === 0) return base;

  const details = issues
    .filter((entry): entry is AuditorGrantExpiryIssue => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.field === "string" &&
        typeof candidate.message === "string" &&
        resolveErrorCode(entry) !== undefined
      );
    })
    .map((entry) => {
      const field = entry.field.length <= 64 ? entry.field : "input";
      const code = resolveErrorCode(entry)!;
      return `[${field}] ${AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES[code]}`;
    });
  return details.length > 0 ? `${base} — Issues: ${details.join("; ")}` : base;
}
