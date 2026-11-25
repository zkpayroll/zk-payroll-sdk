/**
 * Typed Validation for Auditor Grant Expiry (#904)
 *
 * Grant expiry values arrive from admin tooling, contract events, and manually
 * maintained compliance spreadsheets, so they are frequently *almost* right:
 * a numeric string, a date without a timezone, a `null` for "unknown", a
 * negative retention window. Formatting such a descriptor silently is how an
 * already-expired grant keeps looking active on a dashboard.
 *
 * {@link validateAuditorGrantExpiry} returns a typed result that accumulates
 * every problem, and {@link assertValidAuditorGrantExpiry} throws a single
 * {@link AuditorGrantExpiryError} for callers that prefer exceptions. Both
 * produce privacy-safe messages: no auditor address, employee record, or
 * payroll amount is ever echoed back.
 *
 * @example
 * ```ts
 * const result = validateAuditorGrantExpiry({
 *   auditorId: "GAUDITOR...",
 *   expiresAt: "2027-01-01T00:00:00.000Z",
 *   grantedAt: "2026-01-01T00:00:00.000Z",
 * });
 * if (!result.isValid) {
 *   console.error(result.issues.map((i) => i.message).join("; "));
 * } else {
 *   result.normalized.descriptor.status; // "active"
 * }
 * ```
 *
 * @module
 */

import {
  AuditorAccessExpiryFormatted,
  AuditorAccessExpiryInput,
  AuditorAccessExpiryStatus,
  DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS,
  DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS,
  formatAuditorAccessExpiry,
  getAuditorAccessExpiryStatus,
  isAuditorAccessPurged,
} from "./accessExpiry";
import {
  AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES,
  AuditorGrantExpiredError,
  AuditorGrantExpiryError,
  AuditorGrantExpiryErrorCode,
  AuditorGrantExpiryIssue,
} from "./grantExpiryErrors";
import { parseTimestampMs } from "../utils/date";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum accepted expiring-soon threshold: 365 days. */
export const MAX_GRANT_EXPIRY_WARNING_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000;

/** Maximum accepted auditor identifier length. */
export const MAX_AUDITOR_ID_LENGTH = 128;

// ── Types ────────────────────────────────────────────────────────────────────

/** Input accepted by the auditor grant expiry validator. */
export interface AuditorGrantExpiryValidationInput extends AuditorAccessExpiryInput {
  /** Optional issuance timestamp used to bound the grant lifetime. */
  grantedAt?: number | string | Date | null;
}

/** Options for auditor grant expiry validation. */
export interface AuditorGrantExpiryValidationOptions {
  /** Reference time used when the input omits one (defaults to `Date.now()`). */
  now?: number;
  /** Optional upper bound on `expiresAt - grantedAt`, in milliseconds. */
  maxGrantLifetimeMs?: number;
}

/** Normalized, validated grant expiry values. */
export interface NormalizedAuditorGrantExpiry {
  /** Trimmed auditor identifier, when supplied. */
  readonly auditorId?: string;
  /** Parsed expiration timestamp. */
  readonly expiresAtMs: number;
  /** Parsed issuance timestamp, when supplied. */
  readonly grantedAtMs?: number;
  /** Reference timestamp used for status evaluation. */
  readonly referenceTimeMs: number;
  /** Effective expiring-soon threshold. */
  readonly warningThresholdMs: number;
  /** Effective audit access retention window. */
  readonly retentionWindowMs: number;
  /** Evaluated lifecycle status. */
  readonly status: AuditorAccessExpiryStatus;
  /** Whether the descriptor has outlived the retention window. */
  readonly isPurged: boolean;
  /** Fully formatted descriptor ready for UI rendering. */
  readonly descriptor: AuditorAccessExpiryFormatted;
}

/** Result of validating auditor grant expiry. */
export interface AuditorGrantExpiryValidationResult {
  /** Whether every check passed. */
  readonly isValid: boolean;
  /** Accumulated validation issues (empty when valid). */
  readonly issues: readonly AuditorGrantExpiryIssue[];
  /** Normalized values, present only when validation passed. */
  readonly normalized?: NormalizedAuditorGrantExpiry;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function issue(
  code: AuditorGrantExpiryErrorCode,
  field: string,
  message?: string
): AuditorGrantExpiryIssue {
  return Object.freeze({
    code,
    field,
    message: message ?? AUDITOR_GRANT_EXPIRY_ERROR_MESSAGES[code],
  });
}

function resolveReferenceTimeCandidate(
  referenceTime: AuditorAccessExpiryInput["referenceTime"]
): number | null {
  if (referenceTime === undefined) return null;
  if (referenceTime instanceof Date) {
    return Number.isNaN(referenceTime.getTime()) ? null : referenceTime.getTime();
  }
  if (typeof referenceTime === "number" && Number.isFinite(referenceTime) && referenceTime > 0) {
    return referenceTime;
  }
  return null;
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate an auditor grant expiry descriptor without throwing.
 *
 * The result accumulates every detected problem so forms can highlight all
 * invalid fields at once. `normalized` is populated only when `isValid` is true.
 *
 * @throws {RangeError} when `options.maxGrantLifetimeMs` is not a positive
 *   finite number — a programming error rather than user input.
 */
export function validateAuditorGrantExpiry(
  input: AuditorGrantExpiryValidationInput,
  options: AuditorGrantExpiryValidationOptions = {}
): AuditorGrantExpiryValidationResult {
  if (options.maxGrantLifetimeMs !== undefined) {
    if (!Number.isFinite(options.maxGrantLifetimeMs) || options.maxGrantLifetimeMs <= 0) {
      throw new RangeError("maxGrantLifetimeMs must be a positive finite number of milliseconds");
    }
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Object.freeze({
      isValid: false as const,
      issues: Object.freeze([issue(AuditorGrantExpiryErrorCode.INVALID_INPUT, "input")]),
    });
  }

  const issues: AuditorGrantExpiryIssue[] = [];

  // 1. Auditor identifier
  let auditorId: string | undefined;
  if (input.auditorId !== undefined) {
    if (typeof input.auditorId !== "string" || input.auditorId.trim().length === 0) {
      issues.push(issue(AuditorGrantExpiryErrorCode.AUDITOR_ID_INVALID, "auditorId"));
    } else {
      const trimmed = input.auditorId.trim();
      if (trimmed.length > MAX_AUDITOR_ID_LENGTH) {
        issues.push(issue(AuditorGrantExpiryErrorCode.AUDITOR_ID_INVALID, "auditorId"));
      } else {
        auditorId = trimmed;
      }
    }
  }

  // 2. Expiration
  const expiresAtMs = parseTimestampMs(input.expiresAt);
  if (input.expiresAt === null || input.expiresAt === undefined || input.expiresAt === "") {
    issues.push(issue(AuditorGrantExpiryErrorCode.EXPIRES_AT_REQUIRED, "expiresAt"));
  } else if (expiresAtMs === null) {
    issues.push(issue(AuditorGrantExpiryErrorCode.EXPIRES_AT_INVALID, "expiresAt"));
  }

  // 3. Issuance window
  let grantedAtMs: number | undefined;
  if (input.grantedAt !== undefined && input.grantedAt !== null) {
    const parsed = parseTimestampMs(input.grantedAt);
    if (parsed === null) {
      issues.push(issue(AuditorGrantExpiryErrorCode.GRANTED_AT_INVALID, "grantedAt"));
    } else {
      grantedAtMs = parsed;
      if (expiresAtMs !== null && expiresAtMs <= parsed) {
        issues.push(issue(AuditorGrantExpiryErrorCode.EXPIRES_BEFORE_GRANTED, "expiresAt"));
      }
    }
  }

  // 4. Warning threshold
  if (input.warningThresholdMs !== undefined) {
    const threshold = input.warningThresholdMs;
    if (
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > MAX_GRANT_EXPIRY_WARNING_THRESHOLD_MS
    ) {
      issues.push(
        issue(AuditorGrantExpiryErrorCode.WARNING_THRESHOLD_INVALID, "warningThresholdMs")
      );
    }
  }

  // 5. Retention window
  if (input.retentionWindowMs !== undefined) {
    const window = input.retentionWindowMs;
    if (!Number.isFinite(window) || window < 0) {
      issues.push(issue(AuditorGrantExpiryErrorCode.RETENTION_WINDOW_INVALID, "retentionWindowMs"));
    }
  }

  // 6. Reference time
  const optionsNow = options.now;
  const hasValidOptionsNow =
    optionsNow !== undefined && Number.isFinite(optionsNow) && optionsNow > 0;
  if (optionsNow !== undefined && !hasValidOptionsNow) {
    issues.push(issue(AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID, "now"));
  }
  let referenceTimeMs = hasValidOptionsNow ? (optionsNow as number) : Date.now();
  if (input.referenceTime !== undefined) {
    const resolved = resolveReferenceTimeCandidate(input.referenceTime);
    if (resolved === null) {
      issues.push(issue(AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID, "referenceTime"));
    } else {
      referenceTimeMs = resolved;
    }
  }

  // 7. Optional lifetime bound
  if (
    options.maxGrantLifetimeMs !== undefined &&
    grantedAtMs !== undefined &&
    expiresAtMs !== null &&
    expiresAtMs - grantedAtMs > options.maxGrantLifetimeMs
  ) {
    issues.push(issue(AuditorGrantExpiryErrorCode.MAX_LIFETIME_EXCEEDED, "expiresAt"));
  }

  if (issues.length > 0 || expiresAtMs === null) {
    return Object.freeze({
      isValid: false as const,
      issues: Object.freeze([...issues]),
    });
  }

  const warningThresholdMs = input.warningThresholdMs ?? DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS;
  const retentionWindowMs = input.retentionWindowMs ?? DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS;

  const status = getAuditorAccessExpiryStatus(input.expiresAt, {
    referenceTime: referenceTimeMs,
    warningThresholdMs,
  });
  const isPurged = isAuditorAccessPurged(input.expiresAt, retentionWindowMs, referenceTimeMs);
  const descriptor = Object.freeze(
    formatAuditorAccessExpiry({
      expiresAt: input.expiresAt,
      ...(auditorId !== undefined ? { auditorId } : {}),
      referenceTime: referenceTimeMs,
      warningThresholdMs,
      retentionWindowMs,
    })
  );

  return Object.freeze({
    isValid: true as const,
    issues: Object.freeze([]) as readonly AuditorGrantExpiryIssue[],
    normalized: Object.freeze({
      ...(auditorId !== undefined ? { auditorId } : {}),
      expiresAtMs,
      ...(grantedAtMs !== undefined ? { grantedAtMs } : {}),
      referenceTimeMs,
      warningThresholdMs,
      retentionWindowMs,
      status,
      isPurged,
      descriptor,
    }),
  });
}

/**
 * Validate an auditor grant expiry descriptor, throwing on the first failure.
 *
 * @returns The normalized, validated values.
 * @throws {AuditorGrantExpiryError} when validation fails, carrying all issues.
 */
export function assertValidAuditorGrantExpiry(
  input: AuditorGrantExpiryValidationInput,
  options: AuditorGrantExpiryValidationOptions = {}
): NormalizedAuditorGrantExpiry {
  const result = validateAuditorGrantExpiry(input, options);
  if (!result.isValid || !result.normalized) {
    const first = result.issues[0];
    const detail = result.issues.map((entry) => `${entry.field}: ${entry.message}`).join("; ");
    throw new AuditorGrantExpiryError(
      `Auditor grant expiry validation failed: ${detail}`,
      first?.code ?? AuditorGrantExpiryErrorCode.INVALID_INPUT,
      result.issues,
      { issueCount: result.issues.length }
    );
  }
  return result.normalized;
}

/**
 * Assert that an auditor grant is currently usable.
 *
 * Unknown or expired expirations are rejected. The thrown
 * {@link AuditorGrantExpiredError} exposes only a redacted auditor identifier.
 *
 * @returns The formatted descriptor for an active or expiring-soon grant.
 * @throws {AuditorGrantExpiryError} when the descriptor itself is invalid.
 * @throws {AuditorGrantExpiredError} when the grant has lapsed.
 */
export function assertAuditorGrantActive(
  input: AuditorGrantExpiryValidationInput,
  options: AuditorGrantExpiryValidationOptions = {}
): AuditorAccessExpiryFormatted {
  const normalized = assertValidAuditorGrantExpiry(input, options);

  if (normalized.status === "expired" || normalized.status === "unknown") {
    throw new AuditorGrantExpiredError(
      normalized.auditorId,
      normalized.expiresAtMs,
      { status: normalized.status },
      undefined
    );
  }

  return normalized.descriptor;
}

/**
 * Assert that an auditor grant was active at a specific ledger timestamp.
 * Use the ledger's close time for authorization decisions tied to a ledger
 * read, so wall-clock time cannot extend access beyond the ledger boundary.
 * Expiry is exclusive: a grant expiring exactly at the ledger timestamp is
 * already expired.
 */
export function assertAuditorGrantActiveAtLedger(
  input: AuditorGrantExpiryValidationInput,
  ledgerTimestampMs: number
): AuditorAccessExpiryFormatted {
  if (!Number.isFinite(ledgerTimestampMs) || ledgerTimestampMs <= 0) {
    throw new AuditorGrantExpiryError(
      "Auditor grant expiry validation failed: a valid ledger timestamp is required.",
      AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID,
      [issue(AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID, "ledgerTimestampMs")],
      { field: "ledgerTimestampMs" }
    );
  }
  return assertAuditorGrantActive({ ...input, referenceTime: ledgerTimestampMs });
}
