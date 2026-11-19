/**
 * Safe Errors for Auditor Grant Expiry (#905)
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
 *   grant has lapsed; carries only a redacted auditor identifier.
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
};

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
    super(message, code, context, cause);
    this.name = "AuditorGrantExpiryError";
    this.expiryCode = code;
    this.issues = issues;
  }
}

/**
 * Safe error raised when payroll access is denied because an auditor grant has
 * expired (or carries no usable expiration).
 *
 * The identifier is redacted before it reaches `message` or `context`, so the
 * error may be logged verbatim.
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
    const redacted = redactAuditorId(auditorId);
    const detail =
      expiresAtMs === null
        ? "no expiration is recorded"
        : `it expired at ${new Date(expiresAtMs).toISOString()}`;
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

/** Type guard for {@link AuditorGrantExpiryError} and subclasses. */
export function isAuditorGrantExpiryError(error: unknown): boolean {
  if (error instanceof AuditorGrantExpiryError) return true;
  if (
    error &&
    typeof error === "object" &&
    "expiryCode" in error &&
    typeof (error as Record<string, unknown>).expiryCode === "string"
  ) {
    return Object.values(AuditorGrantExpiryErrorCode).includes(
      (error as Record<string, unknown>).expiryCode as AuditorGrantExpiryErrorCode
    );
  }
  return false;
}

/** Type guard for {@link AuditorGrantExpiredError}. */
export function isAuditorGrantExpiredError(error: unknown): boolean {
  return error instanceof AuditorGrantExpiredError;
}

/**
 * Extract a safe message for an auditor grant expiry error.
 * Falls back to the code's canonical message, then to a generic safe string.
 */
export function getAuditorGrantExpiryErrorMessage(error: unknown): string {
  if (error instanceof AuditorGrantExpiryError) {
    return error.message;
  }
  if (
    error &&
    typeof error === "object" &&
    "expiryCode" in error &&
    typeof (error as Record<string, unknown>).expiryCode === "string"
  ) {
    const code = (error as Record<string, unknown>).expiryCode as AuditorGrantExpiryErrorCode;
    if (code in AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES) {
      return AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES[code];
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An auditor grant expiry error occurred. Verify the grant and retry.";
}

/**
 * Format an auditor grant expiry error into an actionable message listing
 * every failing field. The output never includes raw auditor identifiers.
 */
export function formatAuditorGrantExpiryError(error: unknown): string {
  const base = getAuditorGrantExpiryErrorMessage(error);
  if (error instanceof AuditorGrantExpiryError && error.issues.length > 0) {
    const details = error.issues.map((issue) => `[${issue.field}] ${issue.message}`).join("; ");
    return `${base} — Issues: ${details}`;
  }
  return base;
}
