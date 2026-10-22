/**
 * Delegated Approver Assignment Validation and Types
 *
 * Provides validation and normalization for delegated approver assignments
 * within the payroll workflow. Delegated approvers are temporary stand-ins
 * who can approve payroll batches on behalf of an original approver during
 * a specified time window.
 */

import type { SignerRole } from "./types";

/** Machine-readable error codes for delegated approver assignment failures. */
export enum DelegatedApproverAssignmentErrorCode {
  /** A required field is missing from the assignment input. */
  MISSING_FIELD = "MISSING_FIELD",
  /** The original approver address is invalid. */
  INVALID_ORIGINAL_APPROVER = "INVALID_ORIGINAL_APPROVER",
  /** The delegated approver address is invalid. */
  INVALID_DELEGATED_APPROVER = "INVALID_DELEGATED_APPROVER",
  /** The workflow identifier is invalid or missing. */
  INVALID_WORKFLOW_ID = "INVALID_WORKFLOW_ID",
  /** The effective date range is invalid (start >= end, or end in the past). */
  INVALID_DATE_RANGE = "INVALID_DATE_RANGE",
  /** The effectiveFrom date is too far in the past. */
  EFFECTIVE_FROM_TOO_OLD = "EFFECTIVE_FROM_TOO_OLD",
  /** The effectiveUntil date is too far in the future. */
  EFFECTIVE_UNTIL_TOO_FAR = "EFFECTIVE_UNTIL_TOO_FAR",
  /** The original and delegated approver cannot be the same address. */
  SAME_APPROVER_ADDRESSES = "SAME_APPROVER_ADDRESSES",
  /** The assignment duration exceeds the maximum allowed. */
  DURATION_EXCEEDS_MAXIMUM = "DURATION_EXCEEDS_MAXIMUM",
  /** The original approver role is not authorized to delegate. */
  ORIGINAL_ROLE_CANNOT_DELEGATE = "ORIGINAL_ROLE_CANNOT_DELEGATE",
  /** The delegation expires after the delegating role's own expiry. */
  DELEGATION_EXCEEDS_PARENT_ROLE_EXPIRY = "DELEGATION_EXCEEDS_PARENT_ROLE_EXPIRY",
}

/**
 * Structured error thrown when delegated approver assignment validation fails.
 */
export class DelegatedApproverAssignmentError extends Error {
  constructor(
    message: string,
    public readonly code: DelegatedApproverAssignmentErrorCode,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "DelegatedApproverAssignmentError";
  }
}

/**
 * Input request for creating a delegated approver assignment.
 */
export interface DelegatedApproverAssignmentRequest {
  /** Unique identifier for this assignment (generated if not provided). */
  assignmentId?: string;
  /** Stellar address of the original approver delegating authority. */
  originalApprover: string;
  /** Stellar address of the delegated (acting) approver. */
  delegatedApprover: string;
  /** The payroll workflow/batch identifier this assignment applies to. */
  workflowId: string;
  /** Effective start timestamp in epoch milliseconds. */
  effectiveFrom: number;
  /** Effective end timestamp in epoch milliseconds. */
  effectiveUntil: number;
  /** Optional role of the original approver (for authorization checks). */
  originalApproverRole?: SignerRole;
  /**
   * Expiry timestamp (epoch ms) of the role held by the original approver.
   * When set, the delegation cannot remain active past this moment — a
   * delegate must never outlive the authority that created it.
   */
  parentRoleExpiresAt?: number;
}

/**
 * Normalized, validated assignment ready for contract submission.
 */
export interface DelegatedApproverAssignment {
  /** Unique assignment identifier. */
  assignmentId: string;
  /** Stellar address of the original approver. */
  originalApprover: string;
  /** Stellar address of the delegated approver. */
  delegatedApprover: string;
  /** Payroll workflow identifier. */
  workflowId: string;
  /** Effective start timestamp (epoch ms). */
  effectiveFrom: number;
  /** Effective end timestamp (epoch ms). */
  effectiveUntil: number;
  /** Original approver role if provided. */
  originalApproverRole?: SignerRole;
  /** Parent role expiry timestamp (epoch ms) if provided. */
  parentRoleExpiresAt?: number;
}

/**
 * Default maximum delegation duration: 30 days (in ms).
 */
export const DEFAULT_MAX_DELEGATION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Maximum allowed effectiveFrom in the past: 1 day (in ms).
 */
export const MAX_EFFECTIVE_FROM_PAST_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum allowed effectiveUntil in the future: 90 days (in ms).
 */
export const MAX_EFFECTIVE_UNTIL_FUTURE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Roles that are authorized to delegate their approval authority.
 */
export const DELEGATION_AUTHORIZED_ROLES: SignerRole[] = [
  "payroll_admin",
  "treasury_operator",
  "compliance_reviewer",
];

/**
 * Validates a Stellar address format (basic check).
 * Stellar public keys (G...) and contract IDs (C...) are 56 characters.
 */
function isValidStellarAddress(address: string): boolean {
  if (typeof address !== "string") return false;
  const trimmed = address.trim();
  // Stellar addresses are 56 characters starting with 'G' (public key)
  // or contract IDs starting with 'C'
  return /^[GC][0-9A-Z]{55}$/.test(trimmed);
}

/**
 * Generates a unique assignment ID if not provided.
 */
function generateAssignmentId(): string {
  return `del_appr_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Validates a delegated approver assignment request.
 *
 * Checks:
 * - All required fields are present
 * - Addresses are valid Stellar addresses
 * - Original and delegated approver are different
 * - Workflow ID is non-empty
 * - Date range is valid (effectiveFrom < effectiveUntil)
 * - Dates are within allowed bounds (not too far past/future)
 * - Duration does not exceed maximum
 * - Original approver role is authorized to delegate (if provided)
 *
 * @param request - The assignment request to validate.
 * @throws {DelegatedApproverAssignmentError} On any validation failure.
 */
export function assertValidDelegatedApproverAssignment(
  request: DelegatedApproverAssignmentRequest
): void {
  const now = Date.now();

  // Required fields
  if (!request.originalApprover || typeof request.originalApprover !== "string") {
    throw new DelegatedApproverAssignmentError(
      "originalApprover is required and must be a string.",
      DelegatedApproverAssignmentErrorCode.MISSING_FIELD,
      { field: "originalApprover" }
    );
  }
  if (!request.delegatedApprover || typeof request.delegatedApprover !== "string") {
    throw new DelegatedApproverAssignmentError(
      "delegatedApprover is required and must be a string.",
      DelegatedApproverAssignmentErrorCode.MISSING_FIELD,
      { field: "delegatedApprover" }
    );
  }
  if (!request.workflowId || typeof request.workflowId !== "string") {
    throw new DelegatedApproverAssignmentError(
      "workflowId is required and must be a string.",
      DelegatedApproverAssignmentErrorCode.MISSING_FIELD,
      { field: "workflowId" }
    );
  }
  if (typeof request.effectiveFrom !== "number" || !Number.isFinite(request.effectiveFrom)) {
    throw new DelegatedApproverAssignmentError(
      "effectiveFrom is required and must be a valid timestamp.",
      DelegatedApproverAssignmentErrorCode.MISSING_FIELD,
      { field: "effectiveFrom" }
    );
  }
  if (typeof request.effectiveUntil !== "number" || !Number.isFinite(request.effectiveUntil)) {
    throw new DelegatedApproverAssignmentError(
      "effectiveUntil is required and must be a valid timestamp.",
      DelegatedApproverAssignmentErrorCode.MISSING_FIELD,
      { field: "effectiveUntil" }
    );
  }

  // Address format validation
  if (!isValidStellarAddress(request.originalApprover)) {
    throw new DelegatedApproverAssignmentError(
      "originalApprover must be a valid Stellar address (G... or C...).",
      DelegatedApproverAssignmentErrorCode.INVALID_ORIGINAL_APPROVER,
      { field: "originalApprover" }
    );
  }
  if (!isValidStellarAddress(request.delegatedApprover)) {
    throw new DelegatedApproverAssignmentError(
      "delegatedApprover must be a valid Stellar address (G... or C...).",
      DelegatedApproverAssignmentErrorCode.INVALID_DELEGATED_APPROVER,
      { field: "delegatedApprover" }
    );
  }

  // Cannot delegate to self
  if (request.originalApprover.trim() === request.delegatedApprover.trim()) {
    throw new DelegatedApproverAssignmentError(
      "Original approver and delegated approver cannot be the same address.",
      DelegatedApproverAssignmentErrorCode.SAME_APPROVER_ADDRESSES,
      { field: "delegatedApprover" }
    );
  }

  // Workflow ID non-empty
  if (request.workflowId.trim() === "") {
    throw new DelegatedApproverAssignmentError(
      "workflowId cannot be empty.",
      DelegatedApproverAssignmentErrorCode.INVALID_WORKFLOW_ID,
      { field: "workflowId" }
    );
  }

  // Date range validation
  if (request.effectiveFrom >= request.effectiveUntil) {
    throw new DelegatedApproverAssignmentError(
      "effectiveFrom must be before effectiveUntil.",
      DelegatedApproverAssignmentErrorCode.INVALID_DATE_RANGE,
      {
        field: "effectiveFrom",
        effectiveFrom: request.effectiveFrom,
        effectiveUntil: request.effectiveUntil,
      }
    );
  }

  // EffectiveFrom not too far in the past
  if (now - request.effectiveFrom > MAX_EFFECTIVE_FROM_PAST_MS) {
    throw new DelegatedApproverAssignmentError(
      `effectiveFrom cannot be more than ${MAX_EFFECTIVE_FROM_PAST_MS / (24 * 60 * 60 * 1000)} day(s) in the past.`,
      DelegatedApproverAssignmentErrorCode.EFFECTIVE_FROM_TOO_OLD,
      { field: "effectiveFrom", effectiveFrom: request.effectiveFrom }
    );
  }

  // EffectiveUntil not too far in the future
  if (request.effectiveUntil - now > MAX_EFFECTIVE_UNTIL_FUTURE_MS) {
    throw new DelegatedApproverAssignmentError(
      `effectiveUntil cannot be more than ${MAX_EFFECTIVE_UNTIL_FUTURE_MS / (24 * 60 * 60 * 1000)} day(s) in the future.`,
      DelegatedApproverAssignmentErrorCode.EFFECTIVE_UNTIL_TOO_FAR,
      { field: "effectiveUntil", effectiveUntil: request.effectiveUntil }
    );
  }

  // Duration check
  const durationMs = request.effectiveUntil - request.effectiveFrom;
  if (durationMs > DEFAULT_MAX_DELEGATION_DURATION_MS) {
    throw new DelegatedApproverAssignmentError(
      `Delegation duration cannot exceed ${DEFAULT_MAX_DELEGATION_DURATION_MS / (24 * 60 * 60 * 1000)} days.`,
      DelegatedApproverAssignmentErrorCode.DURATION_EXCEEDS_MAXIMUM,
      { field: "effectiveUntil", durationMs, maxDurationMs: DEFAULT_MAX_DELEGATION_DURATION_MS }
    );
  }

  // Delegation cannot outlive the parent role's expiry
  if (request.parentRoleExpiresAt !== undefined) {
    if (
      typeof request.parentRoleExpiresAt !== "number" ||
      !Number.isFinite(request.parentRoleExpiresAt)
    ) {
      throw new DelegatedApproverAssignmentError(
        "parentRoleExpiresAt must be a valid timestamp when provided.",
        DelegatedApproverAssignmentErrorCode.MISSING_FIELD,
        { field: "parentRoleExpiresAt" }
      );
    }
    if (request.effectiveUntil > request.parentRoleExpiresAt) {
      throw new DelegatedApproverAssignmentError(
        "effectiveUntil cannot be later than the parent role's expiry.",
        DelegatedApproverAssignmentErrorCode.DELEGATION_EXCEEDS_PARENT_ROLE_EXPIRY,
        {
          field: "effectiveUntil",
          effectiveUntil: request.effectiveUntil,
          parentRoleExpiresAt: request.parentRoleExpiresAt,
        }
      );
    }
  }

  // Role authorization check (if role provided)
  if (request.originalApproverRole) {
    if (!DELEGATION_AUTHORIZED_ROLES.includes(request.originalApproverRole)) {
      throw new DelegatedApproverAssignmentError(
        `Role '${request.originalApproverRole}' is not authorized to delegate approval authority.`,
        DelegatedApproverAssignmentErrorCode.ORIGINAL_ROLE_CANNOT_DELEGATE,
        { field: "originalApproverRole", role: request.originalApproverRole }
      );
    }
  }
}

/**
 * Normalizes and builds a validated delegated approver assignment request.
 *
 * Generates an assignmentId if not provided. Returns a fully populated
 * {@link DelegatedApproverAssignment} ready for contract submission.
 *
 * @param request - The raw assignment request.
 * @returns A normalized assignment with generated ID if needed.
 * @throws {DelegatedApproverAssignmentError} If validation fails.
 */
export function buildDelegatedApproverAssignmentRequest(
  request: DelegatedApproverAssignmentRequest
): DelegatedApproverAssignment {
  assertValidDelegatedApproverAssignment(request);

  return {
    assignmentId: request.assignmentId?.trim() || generateAssignmentId(),
    originalApprover: request.originalApprover.trim(),
    delegatedApprover: request.delegatedApprover.trim(),
    workflowId: request.workflowId.trim(),
    effectiveFrom: request.effectiveFrom,
    effectiveUntil: request.effectiveUntil,
    originalApproverRole: request.originalApproverRole,
    parentRoleExpiresAt: request.parentRoleExpiresAt,
  };
}

/**
 * Non-throwing validation helper that returns a validation result.
 */
export function tryValidateDelegatedApproverAssignment(
  request: DelegatedApproverAssignmentRequest
):
  | { ok: true; value: DelegatedApproverAssignment }
  | { ok: false; error: DelegatedApproverAssignmentError } {
  try {
    const value = buildDelegatedApproverAssignmentRequest(request);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof DelegatedApproverAssignmentError) {
      return { ok: false, error: err };
    }
    throw err;
  }
}

/**
 * Checks if a delegated approver assignment is currently active.
 *
 * @param assignment - The assignment to check.
 * @param now        - Reference timestamp (defaults to Date.now()).
 * @returns True if the assignment is active at the given time.
 */
export function isDelegatedApproverActive(
  assignment: DelegatedApproverAssignment,
  now: number = Date.now()
): boolean {
  return assignment.effectiveFrom <= now && assignment.effectiveUntil > now;
}

/**
 * Gets the expiry state of a delegated approver assignment.
 */
export type DelegatedApproverExpiryState =
  "active" | "expiring_soon" | "expired" | "not_yet_active";

export interface DelegatedApproverExpiryStatus {
  state: DelegatedApproverExpiryState;
  label: string;
  description: string;
  variant: "default" | "success" | "warning" | "danger" | "info";
  remainingMs?: number;
}

const DEFAULT_EXPIRING_SOON_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getDelegatedApproverExpiryState(
  assignment: DelegatedApproverAssignment,
  now: number = Date.now(),
  expiringSoonThresholdMs: number = DEFAULT_EXPIRING_SOON_THRESHOLD_MS
): DelegatedApproverExpiryState {
  if (now < assignment.effectiveFrom) {
    return "not_yet_active";
  }
  if (now >= assignment.effectiveUntil) {
    return "expired";
  }
  const remainingMs = assignment.effectiveUntil - now;
  if (remainingMs <= expiringSoonThresholdMs) {
    return "expiring_soon";
  }
  return "active";
}

export function formatDelegatedApproverExpiry(
  assignment: DelegatedApproverAssignment,
  now: number = Date.now(),
  expiringSoonThresholdMs: number = DEFAULT_EXPIRING_SOON_THRESHOLD_MS
): DelegatedApproverExpiryStatus {
  const state = getDelegatedApproverExpiryState(assignment, now, expiringSoonThresholdMs);

  switch (state) {
    case "active": {
      const remainingMs = assignment.effectiveUntil - now;
      return {
        state,
        label: "Active",
        description: `Delegation active (expires in ${formatDurationMs(remainingMs)})`,
        variant: "success",
        remainingMs,
      };
    }
    case "expiring_soon": {
      const remainingMs = assignment.effectiveUntil - now;
      return {
        state,
        label: "Expiring Soon",
        description: `Delegation expiring soon (in ${formatDurationMs(remainingMs)})`,
        variant: "warning",
        remainingMs,
      };
    }
    case "expired":
      return {
        state,
        label: "Expired",
        description: "Delegation has expired",
        variant: "danger",
      };
    case "not_yet_active": {
      const untilActiveMs = assignment.effectiveFrom - now;
      return {
        state,
        label: "Not Yet Active",
        description: `Delegation starts in ${formatDurationMs(untilActiveMs)}`,
        variant: "info",
      };
    }
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
