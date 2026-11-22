/**
 * Retention Policy Errors (#913, #910)
 *
 * Safe errors and error codes for hardened retention policy transitions.
 * Errors are structured, actionable, and never expose sensitive payroll data.
 *
 * @module
 */

import { ZkPayrollError } from "../core/errors";

export const RetentionPolicyErrorCode = {
  POLICY_ID_REQUIRED: "RETENTION_POLICY_ID_REQUIRED",
  ACTOR_REQUIRED: "RETENTION_POLICY_ACTOR_REQUIRED",
  REASON_REQUIRED: "RETENTION_POLICY_REASON_REQUIRED",
  VERSION_MISMATCH: "RETENTION_POLICY_VERSION_MISMATCH",
  VERSION_REGRESSION: "RETENTION_POLICY_VERSION_REGRESSION",
  INVALID_RETENTION_DAYS: "RETENTION_POLICY_INVALID_RETENTION_DAYS",
  STATUTORY_MINIMUM_VIOLATION: "RETENTION_POLICY_STATUTORY_MINIMUM_VIOLATION",
  LEGAL_HOLD_CONFLICT: "RETENTION_POLICY_LEGAL_HOLD_CONFLICT",
  POLICY_SUSPENDED: "RETENTION_POLICY_SUSPENDED",
  POLICY_NOT_FOUND: "RETENTION_POLICY_NOT_FOUND",
  NO_OP_UPDATE: "RETENTION_POLICY_NO_OP_UPDATE",
  INVALID_TIMESTAMP: "RETENTION_POLICY_INVALID_TIMESTAMP",
  INVALID_STATE_TRANSITION: "RETENTION_POLICY_INVALID_STATE_TRANSITION",
  CONCURRENT_MODIFICATION: "RETENTION_POLICY_CONCURRENT_MODIFICATION",
  SENSITIVE_DATA_DETECTED: "RETENTION_POLICY_SENSITIVE_DATA_DETECTED",
  INVALID_HASH: "RETENTION_POLICY_INVALID_HASH",
} as const;

export type RetentionPolicyErrorCode =
  (typeof RetentionPolicyErrorCode)[keyof typeof RetentionPolicyErrorCode];

export const RETENTION_POLICY_ERROR_MESSAGES: Record<RetentionPolicyErrorCode, string> = {
  [RetentionPolicyErrorCode.POLICY_ID_REQUIRED]: "A retention policy ID is required.",
  [RetentionPolicyErrorCode.ACTOR_REQUIRED]:
    "An updating actor identity is required to audit retention policy changes.",
  [RetentionPolicyErrorCode.REASON_REQUIRED]:
    "An operational justification is required for updating retention policies.",
  [RetentionPolicyErrorCode.VERSION_MISMATCH]:
    "Retention policy version mismatch: concurrent update detected.",
  [RetentionPolicyErrorCode.VERSION_REGRESSION]:
    "Retention policy version cannot regress or repeat.",
  [RetentionPolicyErrorCode.INVALID_RETENTION_DAYS]:
    "Retention duration in days must be a positive integer within valid bounds.",
  [RetentionPolicyErrorCode.STATUTORY_MINIMUM_VIOLATION]:
    "Retention duration cannot be decreased below the statutory compliance floor.",
  [RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT]:
    "Cannot decrease retention duration while an active legal hold is in effect.",
  [RetentionPolicyErrorCode.POLICY_SUSPENDED]:
    "Retention policy updates are blocked while the policy is suspended.",
  [RetentionPolicyErrorCode.POLICY_NOT_FOUND]: "The target retention policy was not found.",
  [RetentionPolicyErrorCode.NO_OP_UPDATE]:
    "No configuration changes were detected in the proposed retention policy update.",
  [RetentionPolicyErrorCode.INVALID_TIMESTAMP]:
    "Retention policy update timestamp must be a valid non-future Unix epoch millisecond timestamp.",
  [RetentionPolicyErrorCode.INVALID_STATE_TRANSITION]:
    "The requested lifecycle state transition is not permitted.",
  [RetentionPolicyErrorCode.CONCURRENT_MODIFICATION]:
    "Retention policy was modified by another operator. Fetch the latest policy and retry.",
  [RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED]:
    "Prohibited sensitive terminology was detected in the policy metadata or justification.",
  [RetentionPolicyErrorCode.INVALID_HASH]:
    "Retention policy integrity hash is invalid or does not match the policy snapshot.",
};

export interface RetentionPolicyValidationIssue {
  readonly code: RetentionPolicyErrorCode;
  readonly field: string;
  readonly message: string;
  readonly suggestedFix?: string;
}

function sanitizeRetentionContext(context: Record<string, unknown>): Record<string, unknown> {
  const sensitive =
    /(salary|wage|balance|ssn|secret|private|password|employee|reason|metadata|actor|updatedby)/i;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (sensitive.test(key) && key !== "field" && key !== "issueCount") continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

export class RetentionPolicyError extends ZkPayrollError {
  public readonly retentionCode: RetentionPolicyErrorCode;
  public readonly issues: readonly RetentionPolicyValidationIssue[];

  constructor(
    message: string,
    code: RetentionPolicyErrorCode = RetentionPolicyErrorCode.INVALID_STATE_TRANSITION,
    context: Record<string, unknown> = {},
    cause?: unknown,
    issues: readonly RetentionPolicyValidationIssue[] = []
  ) {
    super(message, code, sanitizeRetentionContext(context), cause);
    this.name = "RetentionPolicyError";
    this.retentionCode = code;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}

export function isRetentionPolicyError(error: unknown): boolean {
  if (error instanceof RetentionPolicyError) return true;
  if (
    error &&
    typeof error === "object" &&
    "retentionCode" in error &&
    typeof (error as Record<string, unknown>).retentionCode === "string"
  ) {
    const code = (error as Record<string, unknown>).retentionCode as string;
    return Object.values(RetentionPolicyErrorCode).includes(code as RetentionPolicyErrorCode);
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as string;
    return Object.values(RetentionPolicyErrorCode).includes(code as RetentionPolicyErrorCode);
  }
  return false;
}

export function getRetentionPolicyErrorMessage(error: unknown): string {
  if (error instanceof RetentionPolicyError) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "retentionCode" in error &&
    typeof (error as Record<string, unknown>).retentionCode === "string"
  ) {
    const code = (error as Record<string, unknown>).retentionCode as RetentionPolicyErrorCode;
    if (code in RETENTION_POLICY_ERROR_MESSAGES) {
      return RETENTION_POLICY_ERROR_MESSAGES[code];
    }
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as RetentionPolicyErrorCode;
    if (code in RETENTION_POLICY_ERROR_MESSAGES) {
      return RETENTION_POLICY_ERROR_MESSAGES[code];
    }
  }
  if (error instanceof Error)
    return "A retention policy error occurred. Check policy parameters and retry.";
  return "A retention policy error occurred. Check policy parameters and retry.";
}

/**
 * Redacts an operator identifier for safe diagnostics.
 * Never returns the full identifier when it is long enough to be sensitive.
 */
export function redactPolicyActorId(actorId: unknown): string | undefined {
  if (typeof actorId !== "string") return undefined;
  const trimmed = actorId.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= 4) return "***";
  const prefix = trimmed.slice(0, 2);
  const suffix = trimmed.slice(-2);
  return `${prefix}***${suffix}`;
}

/**
 * Formats a retention policy error or issue list into an actionable, privacy-safe string.
 */
export function formatRetentionPolicyError(
  error: unknown | readonly RetentionPolicyValidationIssue[]
): string {
  if (Array.isArray(error)) {
    if (error.length === 0) {
      return RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.INVALID_STATE_TRANSITION];
    }
    return error.map((i) => `[${i.field}] ${i.message}`).join("; ");
  }
  if (error instanceof RetentionPolicyError) {
    const base = `[${error.retentionCode}] ${getRetentionPolicyErrorMessage(error)}`;
    if (error.issues.length > 0) {
      const details = error.issues.map((i) => `[${i.field}] ${i.message}`).join("; ");
      return `${base} — ${details}`;
    }
    return base;
  }
  return getRetentionPolicyErrorMessage(error);
}
