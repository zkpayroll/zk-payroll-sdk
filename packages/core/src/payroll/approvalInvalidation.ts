import { ZkPayrollError } from "../core/errors";

/**
 * Stable error codes for payroll approval invalidation conditions.
 *
 * Single source of truth for SDK consumers, approval dashboards, and automated payroll pipelines.
 * Error codes never interpolate employee IDs, recipient addresses, salaries, or secret values.
 */
export const ApprovalInvalidationErrorCode = {
  /** The payroll draft was modified after approval was granted, invalidating prior signatures. */
  APPROVAL_INVALIDATED_MODIFICATION: "APPROVAL_INVALIDATED_MODIFICATION",
  /** The required approval count or quorum was invalidated or unmet. */
  APPROVAL_INVALIDATED_QUORUM: "APPROVAL_INVALIDATED_QUORUM",
  /** The approval expiration timestamp elapsed or the window expired. */
  APPROVAL_INVALIDATED_EXPIRED: "APPROVAL_INVALIDATED_EXPIRED",
  /** The approval has been superseded by a newer revision or explicitly revoked. */
  APPROVAL_INVALIDATED_SUPERSEDED: "APPROVAL_INVALIDATED_SUPERSEDED",
  /** The approval metadata, record, or signature format is malformed or invalid. */
  APPROVAL_INVALIDATED_MALFORMED: "APPROVAL_INVALIDATED_MALFORMED",
  /** Unspecified or unknown approval invalidation condition. */
  APPROVAL_INVALIDATION_UNKNOWN: "APPROVAL_INVALIDATION_UNKNOWN",
} as const;

export type ApprovalInvalidationErrorCode =
  (typeof ApprovalInvalidationErrorCode)[keyof typeof ApprovalInvalidationErrorCode];

/**
 * Actionable, privacy-preserving user-facing messages keyed by error code.
 * These messages never leak salaries, recipient addresses, or private employee metadata.
 */
export const APPROVAL_INVALIDATION_ERROR_MESSAGES: Record<ApprovalInvalidationErrorCode, string> = {
  [ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION]:
    "The payroll draft was modified after approval. Prior approvals are invalidated; re-approval is required before execution.",
  [ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_QUORUM]:
    "The payroll approval quorum is invalidated. Collect the required approver sign-offs before proceeding.",
  [ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED]:
    "The payroll approval window has elapsed. A fresh approval sign-off is required.",
  [ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_SUPERSEDED]:
    "The payroll approval was superseded by a later revision. Re-verify the active approval revision.",
  [ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED]:
    "The payroll approval record is malformed. Verify the approval record schema and retry.",
  [ApprovalInvalidationErrorCode.APPROVAL_INVALIDATION_UNKNOWN]:
    "A payroll approval invalidation error occurred. Review the approval status and retry.",
};

const SENSITIVE_KEY_PATTERN = /(amount|salary|recipient|address|secret|key|priv|token|memo)/i;
const SAFE_CONTEXT_KEYS = new Set([
  "draftId",
  "batchId",
  "revision",
  "changedFields",
  "invalidatedApprovalsCount",
  "requiredApprovalsCount",
  "approvalCount",
  "code",
  "status",
  "reason",
  "timestamp",
]);

/**
 * Sanitizes an error context record so that no sensitive payroll values
 * (such as employee IDs, token amounts, wallet addresses, or private notes)
 * can leak into logs, telemetry, or user-facing error objects.
 */
export function sanitizeApprovalInvalidationContext(
  context: Record<string, unknown> = {}
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SAFE_CONTEXT_KEYS.has(key)) {
      if (key === "changedFields" && Array.isArray(value)) {
        safe[key] = value.filter((f): f is string => typeof f === "string");
      } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        safe[key] = value;
      }
      continue;
    }
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Thrown when an approval invalidation condition is detected in the SDK layer.
 *
 * Extends {@link ZkPayrollError} so callers can catch it via `instanceof ZkPayrollError`
 * or specifically via `instanceof ApprovalInvalidationError` or `isApprovalInvalidationError()`.
 *
 * Privacy guarantee:
 * Error messages and context objects never contain employee names, salaries,
 * recipient public keys, or raw amounts.
 */
export class ApprovalInvalidationError extends ZkPayrollError {
  public readonly changedFields?: readonly string[];
  public readonly invalidatedApprovalsCount?: number;

  constructor(
    message: string,
    code: ApprovalInvalidationErrorCode = ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    const sanitized = sanitizeApprovalInvalidationContext(context);
    super(message, code, sanitized, cause);
    this.name = "ApprovalInvalidationError";

    if (Array.isArray(sanitized.changedFields)) {
      this.changedFields = Object.freeze([...(sanitized.changedFields as string[])]);
    }
    if (typeof sanitized.invalidatedApprovalsCount === "number") {
      this.invalidatedApprovalsCount = sanitized.invalidatedApprovalsCount;
    }
  }
}

/**
 * Determines whether an unknown error is an ApprovalInvalidationError,
 * either by class instance or by recognized error code.
 */
export function isApprovalInvalidationError(error: unknown): boolean {
  if (error instanceof ApprovalInvalidationError) return true;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as string;
    return Object.values(ApprovalInvalidationErrorCode).includes(
      code as ApprovalInvalidationErrorCode
    );
  }
  return false;
}

/**
 * Formats or extracts an actionable, privacy-safe message for approval invalidation errors.
 * Never echoes private payroll values.
 */
export function getApprovalInvalidationErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as ApprovalInvalidationErrorCode;
    if (code in APPROVAL_INVALIDATION_ERROR_MESSAGES) {
      return APPROVAL_INVALIDATION_ERROR_MESSAGES[code];
    }
  }
  return APPROVAL_INVALIDATION_ERROR_MESSAGES[
    ApprovalInvalidationErrorCode.APPROVAL_INVALIDATION_UNKNOWN
  ];
}

/**
 * Maps an unknown or unhandled error into a typed {@link ApprovalInvalidationError},
 * preserving the original as `cause` while shielding sensitive payload data.
 */
export function mapToApprovalInvalidationError(
  error: unknown,
  fallbackCode: ApprovalInvalidationErrorCode = ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION,
  context: Record<string, unknown> = {}
): ApprovalInvalidationError {
  if (error instanceof ApprovalInvalidationError) return error;
  const message = getApprovalInvalidationErrorMessage({ code: fallbackCode });
  return new ApprovalInvalidationError(message, fallbackCode, context, error);
}

/**
 * Input for evaluating approval invalidation.
 */
export interface ApprovalValidationInput {
  /** Number of approvals currently attached to the draft. */
  approvalCount: number;
  /** Whether the draft or batch was modified after approvals were gathered. */
  hasModifications?: boolean;
  /** Names of fields that changed after sign-off. Values are never passed or stored. */
  changedFields?: readonly string[];
  /** Minimum required approvals. */
  requiredApprovalsCount?: number;
  /** Timestamp when the approval validity window ends, if applicable. */
  expiresAt?: string | number | Date | null;
  /** Whether this approval revision has been superseded by a later revision. */
  isSuperseded?: boolean;
  /** Optional reference time for expiration evaluation (defaults to Date.now()). */
  now?: number;
}

/**
 * Result of approval validation check.
 */
export interface ApprovalValidationResult {
  /** Whether the approvals remain valid and safe for execution. */
  isValid: boolean;
  /** Invalidation error code when isValid is false. */
  code?: ApprovalInvalidationErrorCode;
  /** Actionable, safe user message. */
  reason?: string;
  /** Names of changed fields that caused the invalidation (if applicable). */
  changedFields?: readonly string[];
  /** Count of approvals invalidated. */
  invalidatedApprovalsCount?: number;
}

/**
 * Evaluates whether an existing set of approvals has been invalidated.
 * Inspects draft modifications, quorum limits, expiration boundaries, and supersession.
 *
 * Privacy guarantee:
 * Never accepts or reflects employee names, amounts, or secret hashes.
 */
export function evaluateApprovalInvalidation(
  input: ApprovalValidationInput
): ApprovalValidationResult {
  // Boundary check: negative approval counts or invalid numbers
  if (!Number.isSafeInteger(input.approvalCount) || input.approvalCount < 0) {
    return {
      isValid: false,
      code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED,
      reason: APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED],
      invalidatedApprovalsCount: 0,
    };
  }

  // If there were no prior approvals, modifications cannot invalidate non-existent approvals
  if (input.approvalCount === 0) {
    const required = input.requiredApprovalsCount ?? 0;
    if (required > 0) {
      return {
        isValid: false,
        code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_QUORUM,
        reason: APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_QUORUM],
        invalidatedApprovalsCount: 0,
      };
    }
    return { isValid: true };
  }

  // Check supersession
  if (input.isSuperseded) {
    return {
      isValid: false,
      code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_SUPERSEDED,
      reason: APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_SUPERSEDED],
      invalidatedApprovalsCount: input.approvalCount,
    };
  }

  // Check post-approval modifications
  if (input.hasModifications) {
    const safeFields = (input.changedFields ?? []).filter((f) => typeof f === "string");
    return {
      isValid: false,
      code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION,
      reason: APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION],
      changedFields: safeFields,
      invalidatedApprovalsCount: input.approvalCount,
    };
  }

  // Check expiration window
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    const expiresTime = new Date(input.expiresAt).getTime();
    if (isNaN(expiresTime)) {
      return {
        isValid: false,
        code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED,
        reason: APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED],
        invalidatedApprovalsCount: input.approvalCount,
      };
    }
    const currentTime = input.now ?? Date.now();
    if (currentTime >= expiresTime) {
      return {
        isValid: false,
        code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED,
        reason: APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED],
        invalidatedApprovalsCount: input.approvalCount,
      };
    }
  }

  // Check quorum if specified
  if (
    input.requiredApprovalsCount !== undefined &&
    input.requiredApprovalsCount > 0 &&
    input.approvalCount < input.requiredApprovalsCount
  ) {
    return {
      isValid: false,
      code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_QUORUM,
      reason: APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_QUORUM],
      invalidatedApprovalsCount: 0,
    };
  }

  return { isValid: true };
}

/**
 * Asserts that the approvals are valid and not invalidated.
 * Throws {@link ApprovalInvalidationError} when invalid.
 *
 * @throws {ApprovalInvalidationError} If approvals are invalidated by modification, expiry, or supersession.
 */
export function assertApprovalsNotInvalidated(
  input: ApprovalValidationInput,
  context: Record<string, unknown> = {}
): void {
  const result = evaluateApprovalInvalidation(input);
  if (!result.isValid) {
    const code = result.code ?? ApprovalInvalidationErrorCode.APPROVAL_INVALIDATION_UNKNOWN;
    const message = result.reason ?? APPROVAL_INVALIDATION_ERROR_MESSAGES[code];
    throw new ApprovalInvalidationError(
      message,
      code,
      {
        ...context,
        invalidatedApprovalsCount: result.invalidatedApprovalsCount,
        changedFields: result.changedFields,
      }
    );
  }
}

// ── Hardened Approval Invalidation State Handling (#923) ─────────────────────
export * from "./approvalInvalidationState";

