/**
 * Audit Access Request Schema Validation
 *
 * Validates incoming audit access requests before they reach contract
 * or admin approval layers. Covers scope, expiration, requester identity,
 * justification reason, and target payroll period boundaries.
 *
 * Usage
 * -----
 * ```ts
 * import { validateAuditAccessRequest } from "@zk-payroll/core";
 *
 * const result = validateAuditAccessRequest(request);
 * if (!result.isValid) {
 *   throw new Error(result.errors.map((e) => e.message).join("; "));
 * }
 * ```
 */

import { ValidationError } from "../core/errors";

// ── Types ────────────────────────────────────────────────────────────────────

/** Scope of data an auditor is requesting access to. */
export type AuditAccessRequestScope =
  "transaction-summaries" | "departmental-breakdowns" | "full-payroll";

/** Valid scope values for runtime validation. */
const VALID_SCOPES: readonly AuditAccessRequestScope[] = [
  "transaction-summaries",
  "departmental-breakdowns",
  "full-payroll",
];

/**
 * An auditor's request for access to payroll data.
 *
 * Submitted by the requester (auditor) and validated before reaching
 * contract or admin approval layers.
 */
export interface AuditAccessRequest {
  /** Unique identifier for this access request. */
  requestId: string;
  /** Stellar public key of the entity requesting access. */
  requester: string;
  /** Human-readable name of the requesting auditor. */
  requesterName: string;
  /** Organisation the auditor represents. */
  requesterOrg: string;
  /** Scope of data being requested. */
  scope: AuditAccessRequestScope;
  /** ISO-8601 date-time when this request expires if unacted upon. */
  expiresAt: string;
  /** Free-text justification for the access request. */
  reason: string;
  /** ISO-8601 start date of the target payroll period (inclusive). */
  targetPayrollPeriodStart: string;
  /** ISO-8601 end date of the target payroll period (exclusive). */
  targetPayrollPeriodEnd: string;
  /** ISO-8601 timestamp when the request was created. */
  createdAt: string;
}

/** Error codes for audit access request validation failures. */
export type AuditAccessRequestErrorCode =
  | "MISSING_REQUESTER"
  | "INVALID_REQUESTER_FORMAT"
  | "MISSING_REQUESTER_NAME"
  | "MISSING_REQUESTER_ORG"
  | "MISSING_SCOPE"
  | "INVALID_SCOPE"
  | "MISSING_EXPIRES_AT"
  | "INVALID_EXPIRES_AT_FORMAT"
  | "EXPIRES_AT_IN_PAST"
  | "EXPIRES_AT_EXCEEDED_MAX_DURATION"
  | "MISSING_REASON"
  | "REASON_TOO_SHORT"
  | "REASON_TOO_LONG"
  | "MISSING_TARGET_PAYROLL_PERIOD_START"
  | "INVALID_TARGET_PAYROLL_PERIOD_START"
  | "MISSING_TARGET_PAYROLL_PERIOD_END"
  | "INVALID_TARGET_PAYROLL_PERIOD_END"
  | "TARGET_PAYROLL_PERIOD_END_BEFORE_START"
  | "TARGET_PAYROLL_PERIOD_EXCEEDS_MAX_DURATION"
  | "TARGET_PAYROLL_PERIOD_IN_FUTURE";

/** Structured validation error for an audit access request field. */
export interface AuditAccessRequestValidationError {
  /** Error code for programmatic handling. */
  code: AuditAccessRequestErrorCode;
  /** Human-readable error description. */
  message: string;
  /** Dot-notation path to the failing field. */
  field: string;
}

/** Result of validating an audit access request. */
export interface AuditAccessRequestValidationResult {
  /** Whether the request passed all validation checks. */
  isValid: boolean;
  /** Validation errors (empty when valid). */
  errors: AuditAccessRequestValidationError[];
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum allowed request expiry duration from creation (365 days). */
const MAX_REQUEST_EXPIRY_DAYS = 365;

/** Maximum allowed payroll period span (365 days). */
const MAX_PAYROLL_PERIOD_DAYS = 365;

/** Minimum reason length (10 characters). */
const MIN_REASON_LENGTH = 10;

/** Maximum reason length (2000 characters). */
const MAX_REASON_LENGTH = 2000;

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Validates an ISO-8601 date string and returns its Date object,
 * or null if the string is not a valid date.
 */
function parseISODate(value: string): Date | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Checks whether a string looks like a Stellar public key
 * (starts with G or S, 56 alphanumeric characters).
 */
function isValidStellarKey(key: string): boolean {
  return /^[GS][A-Z2-7]{55}$/.test(key);
}

/**
 * Collects validation errors for a single audit access request.
 */
function collectErrors(request: AuditAccessRequest): AuditAccessRequestValidationError[] {
  const errors: AuditAccessRequestValidationError[] = [];

  // ── requester ────────────────────────────────────────────────────────────
  if (!request.requester || request.requester.trim() === "") {
    errors.push({
      code: "MISSING_REQUESTER",
      message: "requester is required",
      field: "requester",
    });
  } else if (!isValidStellarKey(request.requester.trim())) {
    errors.push({
      code: "INVALID_REQUESTER_FORMAT",
      message: "requester must be a valid Stellar public key (56 characters starting with G or S)",
      field: "requester",
    });
  }

  // ── requesterName ────────────────────────────────────────────────────────
  if (!request.requesterName || request.requesterName.trim() === "") {
    errors.push({
      code: "MISSING_REQUESTER_NAME",
      message: "requesterName is required",
      field: "requesterName",
    });
  }

  // ── requesterOrg ─────────────────────────────────────────────────────────
  if (!request.requesterOrg || request.requesterOrg.trim() === "") {
    errors.push({
      code: "MISSING_REQUESTER_ORG",
      message: "requesterOrg is required",
      field: "requesterOrg",
    });
  }

  // ── scope ────────────────────────────────────────────────────────────────
  if (!request.scope) {
    errors.push({
      code: "MISSING_SCOPE",
      message: "scope is required",
      field: "scope",
    });
  } else if (!(VALID_SCOPES as readonly string[]).includes(request.scope)) {
    errors.push({
      code: "INVALID_SCOPE",
      message: `scope must be one of: ${VALID_SCOPES.join(", ")}`,
      field: "scope",
    });
  }

  // ── expiresAt ────────────────────────────────────────────────────────────
  if (!request.expiresAt || request.expiresAt.trim() === "") {
    errors.push({
      code: "MISSING_EXPIRES_AT",
      message: "expiresAt is required",
      field: "expiresAt",
    });
  } else {
    const expiresDate = parseISODate(request.expiresAt);
    if (!expiresDate) {
      errors.push({
        code: "INVALID_EXPIRES_AT_FORMAT",
        message: "expiresAt must be a valid ISO-8601 date-time string",
        field: "expiresAt",
      });
    } else {
      const now = new Date();
      if (expiresDate <= now) {
        errors.push({
          code: "EXPIRES_AT_IN_PAST",
          message: "expiresAt must be a future date-time",
          field: "expiresAt",
        });
      } else {
        const maxExpiry = new Date(now.getTime() + MAX_REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        if (expiresDate > maxExpiry) {
          errors.push({
            code: "EXPIRES_AT_EXCEEDED_MAX_DURATION",
            message: `expiresAt must be within ${MAX_REQUEST_EXPIRY_DAYS} days from now`,
            field: "expiresAt",
          });
        }
      }
    }
  }

  // ── reason ───────────────────────────────────────────────────────────────
  if (!request.reason || request.reason.trim() === "") {
    errors.push({
      code: "MISSING_REASON",
      message: "reason is required",
      field: "reason",
    });
  } else {
    const trimmedReason = request.reason.trim();
    if (trimmedReason.length < MIN_REASON_LENGTH) {
      errors.push({
        code: "REASON_TOO_SHORT",
        message: `reason must be at least ${MIN_REASON_LENGTH} characters`,
        field: "reason",
      });
    }
    if (trimmedReason.length > MAX_REASON_LENGTH) {
      errors.push({
        code: "REASON_TOO_LONG",
        message: `reason must not exceed ${MAX_REASON_LENGTH} characters`,
        field: "reason",
      });
    }
  }

  // ── targetPayrollPeriodStart ─────────────────────────────────────────────
  if (!request.targetPayrollPeriodStart || request.targetPayrollPeriodStart.trim() === "") {
    errors.push({
      code: "MISSING_TARGET_PAYROLL_PERIOD_START",
      message: "targetPayrollPeriodStart is required",
      field: "targetPayrollPeriodStart",
    });
  } else {
    const startDate = parseISODate(request.targetPayrollPeriodStart);
    if (!startDate) {
      errors.push({
        code: "INVALID_TARGET_PAYROLL_PERIOD_START",
        message: "targetPayrollPeriodStart must be a valid ISO-8601 date-time string",
        field: "targetPayrollPeriodStart",
      });
    }
  }

  // ── targetPayrollPeriodEnd ───────────────────────────────────────────────
  if (!request.targetPayrollPeriodEnd || request.targetPayrollPeriodEnd.trim() === "") {
    errors.push({
      code: "MISSING_TARGET_PAYROLL_PERIOD_END",
      message: "targetPayrollPeriodEnd is required",
      field: "targetPayrollPeriodEnd",
    });
  } else {
    const endDate = parseISODate(request.targetPayrollPeriodEnd);
    if (!endDate) {
      errors.push({
        code: "INVALID_TARGET_PAYROLL_PERIOD_END",
        message: "targetPayrollPeriodEnd must be a valid ISO-8601 date-time string",
        field: "targetPayrollPeriodEnd",
      });
    }
  }

  // ── Cross-field payroll period checks ────────────────────────────────────
  // Only run cross-field checks if both dates are individually valid.
  const startDate = parseISODate(request.targetPayrollPeriodStart ?? "");
  const endDate = parseISODate(request.targetPayrollPeriodEnd ?? "");

  if (startDate && endDate) {
    if (endDate <= startDate) {
      errors.push({
        code: "TARGET_PAYROLL_PERIOD_END_BEFORE_START",
        message: "targetPayrollPeriodEnd must be after targetPayrollPeriodStart",
        field: "targetPayrollPeriodEnd",
      });
    }

    const periodDays = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    if (periodDays > MAX_PAYROLL_PERIOD_DAYS) {
      errors.push({
        code: "TARGET_PAYROLL_PERIOD_EXCEEDS_MAX_DURATION",
        message: `Payroll period must not exceed ${MAX_PAYROLL_PERIOD_DAYS} days`,
        field: "targetPayrollPeriodEnd",
      });
    }

    // Check if the period is entirely in the future
    const now = new Date();
    if (startDate > now && endDate > now) {
      errors.push({
        code: "TARGET_PAYROLL_PERIOD_IN_FUTURE",
        message: "targetPayrollPeriodStart must not be entirely in the future",
        field: "targetPayrollPeriodStart",
      });
    }
  }

  return errors;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates an audit access request and returns a structured result.
 *
 * This is the primary validation entry point. It checks all required
 * fields, format constraints, date validity, and cross-field rules
 * before the request reaches contract or admin approval layers.
 *
 * @param request - The audit access request to validate.
 * @returns A validation result with `isValid` flag and `errors` array.
 *
 * @example
 * ```ts
 * const result = validateAuditAccessRequest({
 *   requestId: "req_001",
 *   requester: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
 *   requesterName: "Sarah Chen",
 *   requesterOrg: "Deloitte",
 *   scope: "transaction-summaries",
 *   expiresAt: "2027-01-01T00:00:00.000Z",
 *   reason: "Quarterly compliance audit for FY2026 payroll records",
 *   targetPayrollPeriodStart: "2025-01-01T00:00:00.000Z",
 *   targetPayrollPeriodEnd: "2025-03-31T00:00:00.000Z",
 *   createdAt: "2025-12-01T00:00:00.000Z",
 * });
 *
 * if (!result.isValid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validateAuditAccessRequest(
  request: AuditAccessRequest
): AuditAccessRequestValidationResult {
  const errors = collectErrors(request);
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates an audit access request and throws on the first error.
 *
 * Use this when you want fail-fast behavior — the first validation
 * failure is thrown as a {@link ValidationError}.
 *
 * @param request - The audit access request to validate.
 * @throws {ValidationError} When the request fails validation.
 *
 * @example
 * ```ts
 * assertValidAuditAccessRequest(request);
 * // If we get here, the request is valid
 * await submitForApproval(request);
 * ```
 */
export function assertValidAuditAccessRequest(request: AuditAccessRequest): void {
  const result = validateAuditAccessRequest(request);
  if (!result.isValid) {
    const firstError = result.errors[0];
    throw new ValidationError(
      `Audit access request validation failed: ${firstError.message}`,
      firstError.field,
      "AUDIT_ACCESS_REQUEST_VALIDATION_FAILED"
    );
  }
}
