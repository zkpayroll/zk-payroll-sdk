/**
 * Typed Approval Invalidation Validation (#919)
 *
 * Validates approval invalidation requests and records before state changes
 * are committed. Ensures that approval invalidations are well-formed, have a
 * recognized typed reason, identify the acting operator, carry a valid
 * non-future timestamp, and prevent invalidating already-executed runs.
 *
 * ## Privacy & Security Guarantees
 * - Error messages and issues never expose employee identifiers, salaries,
 *   or disbursement amounts.
 * - Free-form notes are checked against accidental inclusion of sensitive keywords.
 * - Operators must identify themselves with non-empty identifiers.
 *
 * @module
 */

import { ZkPayrollError } from "../core/errors";

// ── Types & Constants ────────────────────────────────────────────────────────

/**
 * Standard typed reasons an approval may be invalidated.
 */
export const APPROVAL_INVALIDATION_REASONS = [
  "DRAFT_MODIFIED",
  "POLICY_CHANGED",
  "QUORUM_REVOKED",
  "SCHEDULE_EXPIRED",
  "COMPLIANCE_HOLD",
  "RECIPIENT_CHANGED",
  "AMOUNT_MISMATCH",
  "SECURITY_ANOMALY",
  "MANUAL_REVOCATION",
] as const;

export type ApprovalInvalidationReason = (typeof APPROVAL_INVALIDATION_REASONS)[number];

/** Machine-readable error codes for approval invalidation failures. */
export const ApprovalInvalidationErrorCode = {
  INVALID_INPUT: "INVALID_INPUT",
  APPROVAL_ID_REQUIRED: "APPROVAL_ID_REQUIRED",
  TARGET_ID_REQUIRED: "TARGET_ID_REQUIRED",
  INVALID_REASON: "INVALID_REASON",
  INVALID_TIMESTAMP: "INVALID_TIMESTAMP",
  TIMESTAMP_IN_FUTURE: "TIMESTAMP_IN_FUTURE",
  INVALIDATED_BY_REQUIRED: "INVALIDATED_BY_REQUIRED",
  ALREADY_EXECUTED: "ALREADY_EXECUTED",
  ALREADY_INVALIDATED: "ALREADY_INVALIDATED",
  STATUS_INVALID: "STATUS_INVALID",
  UNAUTHORIZED_OPERATOR: "UNAUTHORIZED_OPERATOR",
  EMPTY_APPROVAL_LIST: "EMPTY_APPROVAL_LIST",
  SENSITIVE_DATA_DETECTED: "SENSITIVE_DATA_DETECTED",
} as const;

export type ApprovalInvalidationErrorCode =
  (typeof ApprovalInvalidationErrorCode)[keyof typeof ApprovalInvalidationErrorCode];

/**
 * Input descriptor for validating an approval invalidation.
 */
export interface ApprovalInvalidationInput {
  /** Identifier of the approval record being invalidated. */
  approvalId: unknown;
  /** Optional payroll run ID associated with the approval. */
  runId?: unknown;
  /** Optional draft ID associated with the approval. */
  draftId?: unknown;
  /** Reason for invalidation (typed code or recognized string). */
  reason: unknown;
  /** When invalidation occurred (timestamp ms, ISO string, or Date). */
  invalidatedAt: unknown;
  /** Identity or address of the operator or service recording the invalidation. */
  invalidatedBy: unknown;
  /** Status of the approval prior to invalidation (e.g. 'approved', 'pending'). */
  currentStatus?: unknown;
  /** True if the underlying payroll batch/run has already been executed on-chain. */
  executed?: unknown;
  /** Optional operational notes or explanation (must not contain private PII). */
  notes?: unknown;
  /** Operational role held by the operator. */
  operatorRole?: unknown;
}

/**
 * Options for configuring validation rules.
 */
export interface ApprovalInvalidationOptions {
  /** Explicit list of roles authorized to invalidate approvals. */
  allowedRoles?: readonly string[];
  /** Reference current time in milliseconds (defaults to Date.now()). */
  now?: number;
  /** Max clock skew allowed for future timestamps in milliseconds (defaults to 5000). */
  maxClockSkewMs?: number;
  /** Require at least one target identifier (runId or draftId). Defaults to true. */
  requireTargetId?: boolean;
  /** Disallow invalidation if executed === true. Defaults to true. */
  disallowExecuted?: boolean;
}

/**
 * Normalized and validated approval invalidation record.
 */
export interface NormalizedApprovalInvalidation {
  readonly approvalId: string;
  readonly targetId: string;
  readonly targetType: "run" | "draft" | "unspecified";
  readonly reason: ApprovalInvalidationReason;
  readonly invalidatedAtMs: number;
  readonly invalidatedBy: string;
  readonly currentStatus: string;
  readonly executed: boolean;
  readonly notes?: string;
}

/**
 * Single actionable problem found during validation.
 */
export interface ApprovalInvalidationIssue {
  readonly code: ApprovalInvalidationErrorCode;
  readonly field?: string;
  readonly message: string;
  readonly remediation?: string;
}

/**
 * Aggregated result of validating an approval invalidation request.
 */
export interface ApprovalInvalidationValidationResult {
  readonly isValid: boolean;
  readonly normalized?: NormalizedApprovalInvalidation;
  readonly issues: readonly ApprovalInvalidationIssue[];
  readonly primaryIssue?: ApprovalInvalidationIssue;
}

/**
 * Batch validation outcome.
 */
export interface ApprovalBatchInvalidationValidationResult {
  readonly isValid: boolean;
  readonly totalCount: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly results: readonly ApprovalInvalidationValidationResult[];
  readonly issues: readonly ApprovalInvalidationIssue[];
}

// ── Error Class ─────────────────────────────────────────────────────────────

/**
 * Structured error thrown when approval invalidation validation fails.
 */
export class ApprovalInvalidationError extends ZkPayrollError {
  public readonly validationCode: ApprovalInvalidationErrorCode;
  public readonly issues: readonly ApprovalInvalidationIssue[];

  constructor(
    message: string,
    code: ApprovalInvalidationErrorCode = ApprovalInvalidationErrorCode.INVALID_INPUT,
    issues: readonly ApprovalInvalidationIssue[] = [],
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
    this.name = "ApprovalInvalidationError";
    this.validationCode = code;
    this.issues = issues;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SENSITIVE_PATTERN = /\b(salary|wage|balance|ssn|secret|private[_-]?key|password)\b/i;

function parseTimestamp(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      return Number.isSafeInteger(num) && num > 0 ? num : null;
    }
    const parsed = Date.parse(trimmed);
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }
  if (raw instanceof Date) {
    const time = raw.getTime();
    return isNaN(time) || time <= 0 ? null : time;
  }
  return null;
}

// ── Validation Functions ─────────────────────────────────────────────────────

/**
 * Validates an approval invalidation request without throwing.
 *
 * @param input - The raw invalidation record or request to validate.
 * @param options - Configuration options for validation.
 * @returns An {@link ApprovalInvalidationValidationResult}.
 */
export function validateApprovalInvalidation(
  input: unknown,
  options: ApprovalInvalidationOptions = {}
): ApprovalInvalidationValidationResult {
  const issues: ApprovalInvalidationIssue[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const issue: ApprovalInvalidationIssue = {
      code: ApprovalInvalidationErrorCode.INVALID_INPUT,
      field: "input",
      message: "Approval invalidation input must be a non-null object.",
      remediation: "Provide a structured invalidation object with approvalId, reason, and invalidatedBy.",
    };
    return {
      isValid: false,
      issues: [issue],
      primaryIssue: issue,
    };
  }

  const rec = input as Record<string, unknown>;

  // 1. Validate approvalId
  let approvalId = "";
  if (typeof rec.approvalId !== "string" || rec.approvalId.trim().length === 0) {
    issues.push({
      code: ApprovalInvalidationErrorCode.APPROVAL_ID_REQUIRED,
      field: "approvalId",
      message: "An approval ID is required to invalidate an approval.",
      remediation: "Specify the unique identifier of the approval to be invalidated.",
    });
  } else {
    approvalId = rec.approvalId.trim();
  }

  // 2. Validate target ID (runId or draftId)
  const requireTarget = options.requireTargetId !== false;
  let targetId = "";
  let targetType: "run" | "draft" | "unspecified" = "unspecified";

  if (typeof rec.runId === "string" && rec.runId.trim().length > 0) {
    targetId = rec.runId.trim();
    targetType = "run";
  } else if (typeof rec.draftId === "string" && rec.draftId.trim().length > 0) {
    targetId = rec.draftId.trim();
    targetType = "draft";
  } else if (requireTarget) {
    issues.push({
      code: ApprovalInvalidationErrorCode.TARGET_ID_REQUIRED,
      field: "runId",
      message: "A target identifier (runId or draftId) is required for approval invalidation.",
      remediation: "Provide the associated runId or draftId for the approval.",
    });
  }

  // 3. Validate reason
  let reason: ApprovalInvalidationReason = "MANUAL_REVOCATION";
  if (typeof rec.reason !== "string" || rec.reason.trim().length === 0) {
    issues.push({
      code: ApprovalInvalidationErrorCode.INVALID_REASON,
      field: "reason",
      message: "An invalidation reason code is required.",
      remediation: `Provide one of the recognized reason codes: ${APPROVAL_INVALIDATION_REASONS.join(", ")}.`,
    });
  } else {
    const normalizedReason = rec.reason.trim().toUpperCase();
    if (APPROVAL_INVALIDATION_REASONS.includes(normalizedReason as ApprovalInvalidationReason)) {
      reason = normalizedReason as ApprovalInvalidationReason;
    } else {
      issues.push({
        code: ApprovalInvalidationErrorCode.INVALID_REASON,
        field: "reason",
        message: `Reason code "${rec.reason}" is not a recognized invalidation reason.`,
        remediation: `Choose from: ${APPROVAL_INVALIDATION_REASONS.join(", ")}.`,
      });
    }
  }

  // 4. Validate invalidatedBy
  let invalidatedBy = "";
  if (typeof rec.invalidatedBy !== "string" || rec.invalidatedBy.trim().length === 0) {
    issues.push({
      code: ApprovalInvalidationErrorCode.INVALIDATED_BY_REQUIRED,
      field: "invalidatedBy",
      message: "Operator identifier is required to record approval invalidation.",
      remediation: "Provide the user ID, operator address, or service identifier recording the invalidation.",
    });
  } else {
    invalidatedBy = rec.invalidatedBy.trim();
  }

  // 5. Validate timestamp
  const now = options.now ?? Date.now();
  const maxClockSkew = options.maxClockSkewMs ?? 5000;
  let invalidatedAtMs = 0;

  if (rec.invalidatedAt === undefined || rec.invalidatedAt === null) {
    issues.push({
      code: ApprovalInvalidationErrorCode.INVALID_TIMESTAMP,
      field: "invalidatedAt",
      message: "An invalidation timestamp is required.",
      remediation: "Provide a valid timestamp in milliseconds, ISO-8601 string, or Date instance.",
    });
  } else {
    const parsed = parseTimestamp(rec.invalidatedAt);
    if (parsed === null) {
      issues.push({
        code: ApprovalInvalidationErrorCode.INVALID_TIMESTAMP,
        field: "invalidatedAt",
        message: "The invalidation timestamp is malformed or not a valid positive timestamp.",
        remediation: "Provide a valid timestamp in milliseconds, ISO-8601 string, or Date instance.",
      });
    } else if (parsed > now + maxClockSkew) {
      issues.push({
        code: ApprovalInvalidationErrorCode.TIMESTAMP_IN_FUTURE,
        field: "invalidatedAt",
        message: "Invalidation timestamp cannot be in the future.",
        remediation: "Check system clocks or verify the invalidation event timing.",
      });
    } else {
      invalidatedAtMs = parsed;
    }
  }

  // 6. Validate execution state
  const disallowExecuted = options.disallowExecuted !== false;
  const isExecuted = Boolean(rec.executed);
  if (disallowExecuted && isExecuted) {
    issues.push({
      code: ApprovalInvalidationErrorCode.ALREADY_EXECUTED,
      field: "executed",
      message: "Cannot invalidate approvals for an already-executed payroll batch.",
      remediation: "Executed runs cannot have approvals revoked; consider creating an adjustment run instead.",
    });
  }

  // 7. Validate current status
  const rawStatus = typeof rec.currentStatus === "string" ? rec.currentStatus.trim().toLowerCase() : "approved";
  if (rawStatus === "invalidated" || rawStatus === "revoked") {
    issues.push({
      code: ApprovalInvalidationErrorCode.ALREADY_INVALIDATED,
      field: "currentStatus",
      message: "The approval is already in an invalidated state.",
      remediation: "No action required: the approval has already been invalidated.",
    });
  } else if (rawStatus === "executed" && disallowExecuted) {
    issues.push({
      code: ApprovalInvalidationErrorCode.ALREADY_EXECUTED,
      field: "currentStatus",
      message: "The approval status indicates it has already been executed.",
      remediation: "Cannot revoke approvals after execution.",
    });
  }

  // 8. Role authorization check
  if (options.allowedRoles && options.allowedRoles.length > 0) {
    const operatorRole = typeof rec.operatorRole === "string" ? rec.operatorRole.trim().toLowerCase() : "";
    const allowed = options.allowedRoles.map((r) => r.toLowerCase());
    if (!operatorRole || !allowed.includes(operatorRole)) {
      issues.push({
        code: ApprovalInvalidationErrorCode.UNAUTHORIZED_OPERATOR,
        field: "operatorRole",
        message: "The operator role is not authorized to invalidate approvals.",
        remediation: `Invalidation requires one of the following roles: ${options.allowedRoles.join(", ")}.`,
      });
    }
  }

  // 9. Notes privacy check
  let sanitizedNotes: string | undefined = undefined;
  if (rec.notes !== undefined && rec.notes !== null) {
    if (typeof rec.notes === "string") {
      const trimmedNotes = rec.notes.trim();
      if (SENSITIVE_PATTERN.test(trimmedNotes)) {
        issues.push({
          code: ApprovalInvalidationErrorCode.SENSITIVE_DATA_DETECTED,
          field: "notes",
          message: "Invalidation notes contain prohibited sensitive terminology.",
          remediation: "Remove salary figures, employee names, or secrets from operational notes.",
        });
      } else if (trimmedNotes.length > 0) {
        sanitizedNotes = trimmedNotes;
      }
    }
  }

  const isValid = issues.length === 0;

  if (!isValid) {
    return {
      isValid: false,
      issues,
      primaryIssue: issues[0],
    };
  }

  const normalized: NormalizedApprovalInvalidation = Object.freeze({
    approvalId,
    targetId,
    targetType,
    reason,
    invalidatedAtMs,
    invalidatedBy,
    currentStatus: rawStatus,
    executed: isExecuted,
    ...(sanitizedNotes !== undefined ? { notes: sanitizedNotes } : {}),
  });

  return {
    isValid: true,
    normalized,
    issues: [],
  };
}

/**
 * Asserts that an approval invalidation is valid, throwing an {@link ApprovalInvalidationError} if not.
 *
 * @param input - Invalidation input to validate.
 * @param options - Configuration options.
 * @returns The normalized approval invalidation record.
 */
export function assertValidApprovalInvalidation(
  input: unknown,
  options: ApprovalInvalidationOptions = {}
): NormalizedApprovalInvalidation {
  const result = validateApprovalInvalidation(input, options);
  if (!result.isValid || !result.normalized) {
    const primary = result.primaryIssue ?? {
      code: ApprovalInvalidationErrorCode.INVALID_INPUT,
      message: "Approval invalidation validation failed.",
    };
    throw new ApprovalInvalidationError(
      primary.message,
      primary.code,
      result.issues,
      { field: primary.field }
    );
  }
  return result.normalized;
}

/**
 * Validates a batch of approval invalidations.
 *
 * @param inputs - Array of invalidation requests.
 * @param options - Validation options.
 * @returns An aggregated {@link ApprovalBatchInvalidationValidationResult}.
 */
export function validateApprovalBatchInvalidation(
  inputs: unknown[],
  options: ApprovalInvalidationOptions = {}
): ApprovalBatchInvalidationValidationResult {
  if (!Array.isArray(inputs)) {
    const issue: ApprovalInvalidationIssue = {
      code: ApprovalInvalidationErrorCode.INVALID_INPUT,
      field: "inputs",
      message: "Approval invalidation batch must be an array.",
      remediation: "Provide an array of approval invalidation input objects.",
    };
    return {
      isValid: false,
      totalCount: 0,
      validCount: 0,
      invalidCount: 0,
      results: [],
      issues: [issue],
    };
  }

  if (inputs.length === 0) {
    const issue: ApprovalInvalidationIssue = {
      code: ApprovalInvalidationErrorCode.EMPTY_APPROVAL_LIST,
      field: "inputs",
      message: "Approval invalidation batch cannot be empty.",
      remediation: "Provide at least one approval invalidation to validate.",
    };
    return {
      isValid: false,
      totalCount: 0,
      validCount: 0,
      invalidCount: 0,
      results: [],
      issues: [issue],
    };
  }

  const results: ApprovalInvalidationValidationResult[] = [];
  const allIssues: ApprovalInvalidationIssue[] = [];
  let validCount = 0;

  for (const item of inputs) {
    const res = validateApprovalInvalidation(item, options);
    results.push(res);
    if (res.isValid) {
      validCount++;
    } else {
      allIssues.push(...res.issues);
    }
  }

  return {
    isValid: validCount === inputs.length,
    totalCount: inputs.length,
    validCount,
    invalidCount: inputs.length - validCount,
    results,
    issues: allIssues,
  };
}

/**
 * Returns true if an error is an {@link ApprovalInvalidationError}.
 */
export function isApprovalInvalidationError(error: unknown): boolean {
  if (error instanceof ApprovalInvalidationError) return true;
  if (
    error &&
    typeof error === "object" &&
    "validationCode" in error &&
    typeof (error as Record<string, unknown>).validationCode === "string"
  ) {
    const code = (error as Record<string, unknown>).validationCode as string;
    return Object.values(ApprovalInvalidationErrorCode).includes(code as ApprovalInvalidationErrorCode);
  }
  return false;
}

/**
 * Extracts a safe user-facing message for an approval invalidation error.
 */
export function getApprovalInvalidationErrorMessage(error: unknown): string {
  if (error instanceof ApprovalInvalidationError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected approval invalidation error occurred.";
}
