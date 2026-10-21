/**
 * Audit Record Retention Safeguards.
 *
 * Evaluates whether an audit record (an audit package, a retention-safe
 * artifact, or any other immutable audit trail entry) may be deleted, and
 * refuses deletions that would violate the minimum retention window or an
 * active legal hold.
 *
 * ## Privacy & Security Guarantees
 * - Record identifiers are masked by default (`redactRecordId`), so retention
 *   decisions can be logged without leaking audit record identifiers.
 * - Legal hold reasons are never copied into error messages; only the hold id
 *   and the record kind are reported.
 * - Retention evaluation is a pure, side-effect free computation: it never
 *   deletes anything, it only reports what *may* be deleted.
 *
 * @module
 */

/**
 * Default minimum retention window applied when a caller does not supply one:
 * seven years, matching the statutory retention window used across the SDK.
 */
export const DEFAULT_MINIMUM_RETENTION_MS = 7 * 365 * 24 * 60 * 60 * 1000;

/**
 * Machine-readable error codes for audit retention validation failures.
 */
export type AuditRetentionValidationErrorCode =
  /** The record identifier was missing or blank. */
  | "INVALID_RECORD_ID"
  /** The record kind was missing or blank. */
  | "INVALID_RECORD_KIND"
  /** The creation timestamp was missing or not a finite timestamp. */
  | "INVALID_CREATED_AT"
  /** The reference timestamp was not a finite timestamp. */
  | "INVALID_REFERENCE_TIME"
  /** The retention window bounds were negative or inconsistent. */
  | "INVALID_RETENTION_WINDOW"
  /** A retention window produced an unrepresentable deadline. */
  | "INVALID_RETENTION_DEADLINE"
  /** A legal hold entry was missing an id or a reason. */
  | "INVALID_LEGAL_HOLD";

/**
 * A single validation problem found in an audit retention input.
 */
export interface AuditRetentionValidationErrorDetail {
  /** Machine-readable error code. */
  code: AuditRetentionValidationErrorCode;
  /** Human-readable description of the problem. */
  message: string;
  /** Name of the offending field, when it can be attributed to one. */
  field?: string;
}

/**
 * Error thrown when an audit retention input is malformed, or when a record
 * may not be deleted.
 */
export class AuditRetentionValidationError extends Error {
  readonly code: AuditRetentionValidationErrorCode;
  readonly errors: AuditRetentionValidationErrorDetail[];
  readonly recordKind?: string;

  constructor(
    message: string,
    code: AuditRetentionValidationErrorCode = "INVALID_RETENTION_WINDOW",
    errors: AuditRetentionValidationErrorDetail[] = [],
    recordKind?: string
  ) {
    super(message);
    this.name = "AuditRetentionValidationError";
    this.code = code;
    this.errors = errors;
    this.recordKind = recordKind;
    Object.setPrototypeOf(this, AuditRetentionValidationError.prototype);
  }
}

/**
 * A legal hold placed on an audit record.
 */
export interface AuditLegalHold {
  /** Identifier of the legal hold. */
  holdId: string;
  /** Why the record is being held. Never surfaced in error messages. */
  reason: string;
  /** Timestamp (ms) at which the hold expires; `null` means it never expires. */
  expiresAt?: number | null;
}

/**
 * Input describing an audit record whose retention is being evaluated.
 */
export interface AuditRecordRetentionInput {
  /** Identifier of the audit record. */
  recordId: string;
  /** Kind of audit record (e.g. `"audit_package"`). */
  recordKind: string;
  /** Timestamp (ms) at which the record was created. */
  createdAt: number;
  /** Minimum time the record must be retained (ms). Defaults to seven years. */
  minimumRetentionMs?: number;
  /** Maximum time the record may be retained (ms), when the policy defines one. */
  maximumRetentionMs?: number;
  /** Legal holds currently placed on the record. */
  legalHolds?: AuditLegalHold[];
  /** Reference timestamp (ms). Defaults to `Date.now()`. */
  referenceTime?: number;
}

/**
 * Operational status of an audit record's retention window.
 */
export type AuditRecordRetentionStatus =
  /** The minimum retention window has not elapsed yet. */
  | "retained"
  /** The record may be deleted. */
  | "eligible_for_deletion"
  /** The record is blocked by an active legal hold. */
  | "legal_hold"
  /** The maximum retention window has been exceeded. */
  | "expired";

/**
 * Result of evaluating an audit record's retention.
 */
export interface AuditRecordRetentionEvaluation {
  /** Masked record identifier, safe for logs. */
  recordId: string;
  /** Kind of the evaluated record. */
  recordKind: string;
  /** Evaluated retention status. */
  status: AuditRecordRetentionStatus;
  /** True when the record may be deleted right now. */
  canDelete: boolean;
  /** True when the record must be kept regardless of the retention window. */
  mustRetain: boolean;
  /** True when the minimum retention window has elapsed. */
  isMinimumRetentionMet: boolean;
  /** True when the maximum retention window has been exceeded. */
  isMaximumRetentionExceeded: boolean;
  /** True when at least one legal hold is currently active. */
  isLegalHeld: boolean;
  /** Remaining time before the minimum retention window elapses (ms). */
  remainingMinimumMs: number;
  /** Timestamp (ms) at which the maximum retention window elapses, when configured. */
  maximumRetentionUntilMs: number | null;
  /** Legal holds that are still active at the reference time. */
  activeLegalHolds: AuditLegalHold[];
  /** Reference timestamp (ms) used for the evaluation. */
  evaluatedAt: number;
}

/**
 * Masks an audit record identifier so retention decisions can be logged
 * without exposing the underlying identifier.
 *
 * @param id - The record identifier to mask.
 * @returns A masked identifier.
 *
 * @example
 * redactRecordId("audit-package-2026-07"); // "aud***-07"
 */
export function redactRecordId(id?: string): string {
  if (!id || id.trim().length === 0) return "[ANONYMOUS_RECORD]";
  const clean = id.trim();
  if (clean.length < 8) return "[REDACTED_RECORD]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Validates an audit retention input.
 *
 * @param input - The retention input to validate.
 * @returns The list of validation problems; empty when the input is valid.
 */
export function validateAuditRetentionInput(
  input: AuditRecordRetentionInput | unknown
): AuditRetentionValidationErrorDetail[] {
  const errors: AuditRetentionValidationErrorDetail[] = [];

  if (!input || typeof input !== "object") {
    errors.push({
      code: "INVALID_RECORD_ID",
      message: "Audit retention input must be an object.",
      field: "input",
    });
    return errors;
  }

  const record = input as AuditRecordRetentionInput;

  if (typeof record.recordId !== "string" || record.recordId.trim().length === 0) {
    errors.push({
      code: "INVALID_RECORD_ID",
      message: "Audit record id is required.",
      field: "recordId",
    });
  }

  if (typeof record.recordKind !== "string" || record.recordKind.trim().length === 0) {
    errors.push({
      code: "INVALID_RECORD_KIND",
      message: "Audit record kind is required.",
      field: "recordKind",
    });
  }

  if (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) {
    errors.push({
      code: "INVALID_CREATED_AT",
      message: "Audit record creation timestamp must be a finite number.",
      field: "createdAt",
    });
  }

  if (
    record.referenceTime !== undefined &&
    (typeof record.referenceTime !== "number" || !Number.isFinite(record.referenceTime))
  ) {
    errors.push({
      code: "INVALID_REFERENCE_TIME",
      message: "Reference timestamp must be a finite number of milliseconds.",
      field: "referenceTime",
    });
  }

  const minimumRetentionMs = record.minimumRetentionMs ?? DEFAULT_MINIMUM_RETENTION_MS;
  if (typeof minimumRetentionMs !== "number" || !Number.isFinite(minimumRetentionMs)) {
    errors.push({
      code: "INVALID_RETENTION_WINDOW",
      message: "Minimum retention window must be a finite number of milliseconds.",
      field: "minimumRetentionMs",
    });
  } else if (minimumRetentionMs < 0) {
    errors.push({
      code: "INVALID_RETENTION_WINDOW",
      message: "Minimum retention window must not be negative.",
      field: "minimumRetentionMs",
    });
  }

  const maximumRetentionMs = record.maximumRetentionMs;
  if (maximumRetentionMs !== undefined && maximumRetentionMs !== null) {
    if (typeof maximumRetentionMs !== "number" || !Number.isFinite(maximumRetentionMs)) {
      errors.push({
        code: "INVALID_RETENTION_WINDOW",
        message: "Maximum retention window must be a finite number of milliseconds.",
        field: "maximumRetentionMs",
      });
    } else if (maximumRetentionMs < 0) {
      errors.push({
        code: "INVALID_RETENTION_WINDOW",
        message: "Maximum retention window must not be negative.",
        field: "maximumRetentionMs",
      });
    } else if (typeof minimumRetentionMs === "number" && maximumRetentionMs < minimumRetentionMs) {
      errors.push({
        code: "INVALID_RETENTION_WINDOW",
        message: "Maximum retention window must not be shorter than the minimum retention window.",
        field: "maximumRetentionMs",
      });
    }
  }

  if (
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    typeof minimumRetentionMs === "number" &&
    Number.isFinite(minimumRetentionMs) &&
    !Number.isFinite(record.createdAt + minimumRetentionMs)
  ) {
    errors.push({
      code: "INVALID_RETENTION_DEADLINE",
      message: "Minimum retention deadline is outside the supported timestamp range.",
      field: "minimumRetentionMs",
    });
  }
  if (
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    typeof maximumRetentionMs === "number" &&
    Number.isFinite(maximumRetentionMs) &&
    !Number.isFinite(record.createdAt + maximumRetentionMs)
  ) {
    errors.push({
      code: "INVALID_RETENTION_DEADLINE",
      message: "Maximum retention deadline is outside the supported timestamp range.",
      field: "maximumRetentionMs",
    });
  }

  const legalHolds = record.legalHolds ?? [];
  if (!Array.isArray(legalHolds)) {
    errors.push({
      code: "INVALID_LEGAL_HOLD",
      message: "Legal holds must be provided as an array.",
      field: "legalHolds",
    });
  } else {
    for (let index = 0; index < legalHolds.length; index++) {
      const hold = legalHolds[index];
      const holdId = hold && typeof hold.holdId === "string" ? hold.holdId.trim() : "";
      const reason = hold && typeof hold.reason === "string" ? hold.reason.trim() : "";
      if (!hold || typeof hold !== "object" || holdId.length === 0 || reason.length === 0) {
        errors.push({
          code: "INVALID_LEGAL_HOLD",
          message: `Legal hold at index ${index} requires a hold id and a reason.`,
          field: `legalHolds[${index}]`,
        });
      }
    }
  }

  return errors;
}

/**
 * Evaluates whether an audit record may be deleted.
 *
 * The evaluation is a pure computation: it never mutates or deletes anything.
 * Legal holds always win over the retention window, and an expired legal hold
 * is ignored.
 *
 * @param input - The audit record retention input.
 * @returns The retention evaluation.
 * @throws {AuditRetentionValidationError} When the input is malformed.
 *
 * @example
 * const evaluation = evaluateAuditRetention({
 *   recordId: "audit-package-2026-07",
 *   recordKind: "audit_package",
 *   createdAt: Date.now(),
 * });
 *
 * if (evaluation.canDelete) {
 *   // safe to delete
 * }
 */
export function evaluateAuditRetention(
  input: AuditRecordRetentionInput | unknown
): AuditRecordRetentionEvaluation {
  const errors = validateAuditRetentionInput(input);
  if (errors.length > 0) {
    const recordKind =
      input && typeof input === "object"
        ? (input as AuditRecordRetentionInput).recordKind
        : undefined;
    throw new AuditRetentionValidationError(
      `Audit retention input is invalid: ${errors.map((e) => e.message).join("; ")}`,
      errors[0].code,
      errors,
      recordKind
    );
  }

  const record = input as AuditRecordRetentionInput;
  const evaluatedAt = record.referenceTime ?? Date.now();
  const minimumRetentionMs = record.minimumRetentionMs ?? DEFAULT_MINIMUM_RETENTION_MS;
  const maximumRetentionMs = record.maximumRetentionMs;

  const minimumRetentionUntilMs = record.createdAt + minimumRetentionMs;
  const remainingMinimumMs = Math.max(0, minimumRetentionUntilMs - evaluatedAt);
  const isMinimumRetentionMet = remainingMinimumMs === 0;
  const maximumRetentionUntilMs =
    typeof maximumRetentionMs === "number" ? record.createdAt + maximumRetentionMs : null;
  const isMaximumRetentionExceeded =
    maximumRetentionUntilMs !== null && evaluatedAt > maximumRetentionUntilMs;

  const activeLegalHolds = (record.legalHolds ?? []).filter((hold) => {
    if (hold.expiresAt === undefined || hold.expiresAt === null) return true;
    return hold.expiresAt > evaluatedAt;
  });
  const isLegalHeld = activeLegalHolds.length > 0;

  let status: AuditRecordRetentionStatus;
  if (isLegalHeld) {
    status = "legal_hold";
  } else if (isMaximumRetentionExceeded) {
    status = "expired";
  } else if (isMinimumRetentionMet) {
    status = "eligible_for_deletion";
  } else {
    status = "retained";
  }

  const canDelete = status === "eligible_for_deletion" || status === "expired";

  return {
    recordId: redactRecordId(record.recordId),
    recordKind: record.recordKind,
    status,
    canDelete,
    mustRetain: !canDelete,
    isMinimumRetentionMet,
    isMaximumRetentionExceeded,
    isLegalHeld,
    remainingMinimumMs,
    maximumRetentionUntilMs,
    activeLegalHolds,
    evaluatedAt,
  };
}

/**
 * Asserts that an audit record may be deleted and returns its evaluation.
 *
 * @param input - The audit record retention input.
 * @returns The retention evaluation, when deletion is allowed.
 * @throws {AuditRetentionValidationError} When the input is malformed or the
 *   record may not be deleted.
 */
export function assertAuditRecordDeletable(
  input: AuditRecordRetentionInput | unknown
): AuditRecordRetentionEvaluation {
  const evaluation = evaluateAuditRetention(input);
  if (!evaluation.canDelete) {
    const reason =
      evaluation.status === "legal_hold"
        ? "an active legal hold blocks deletion"
        : "the minimum retention window has not elapsed";
    throw new AuditRetentionValidationError(
      `Audit record ${evaluation.recordId} (${evaluation.recordKind}) cannot be deleted: ${reason}.`,
      evaluation.status === "legal_hold" ? "INVALID_LEGAL_HOLD" : "INVALID_RETENTION_WINDOW",
      [],
      evaluation.recordKind
    );
  }
  return evaluation;
}
