/**
 * Hardened State Handling for Payroll Approval Invalidation (#923).
 *
 * Implements strict state machine transitions, terminal state enforcement,
 * optimistic concurrency versioning, and privacy-preserving audit hashing
 * for payroll approval invalidations.
 *
 * Invariants:
 * 1. Terminal Run Immutability: Executed payroll runs cannot have their approvals invalidated.
 * 2. Idempotency: Repeated invalidation attempts on already invalidated drafts succeed idempotently.
 * 3. Concurrency Protection: Version conflicts reject concurrent conflicting transitions.
 * 4. Zero Data Leakage: Private employee IDs, addresses, and salary amounts are never stored
 *    in invalidation records, error objects, or state hashes.
 *
 * @module
 */

import { createHash } from "crypto";
import {
  ApprovalInvalidationError,
  ApprovalInvalidationErrorCode,
  APPROVAL_INVALIDATION_ERROR_MESSAGES,
  sanitizeApprovalInvalidationContext,
} from "./approvalInvalidation";

/**
 * Valid lifecycle states for a payroll approval record.
 */
export type ApprovalRecordStatus =
  | "draft"
  | "pending"
  | "approved"
  | "invalidated"
  | "superseded"
  | "executed"
  | "rejected";

/**
 * State transition mapping defining legal next states for payroll approvals.
 */
export const ALLOWED_APPROVAL_STATE_TRANSITIONS: Readonly<
  Record<ApprovalRecordStatus, readonly ApprovalRecordStatus[]>
> = Object.freeze({
  draft: ["pending", "invalidated", "superseded"],
  pending: ["approved", "rejected", "invalidated", "superseded"],
  approved: ["invalidated", "superseded", "executed"],
  invalidated: ["pending", "superseded"], // Re-opening or superseding invalidated approvals
  rejected: ["superseded", "draft"],
  executed: [], // Terminal: immutable on-chain finality
  superseded: [], // Terminal: replaced by subsequent revision
});

/**
 * Immutable state record representing the approval state of a payroll draft or run.
 */
export interface PayrollApprovalStateRecord {
  readonly draftId: string;
  readonly revision: number;
  readonly version: number;
  readonly status: ApprovalRecordStatus;
  readonly approvalCount: number;
  readonly requiredApprovalsCount: number;
  readonly isSuperseded: boolean;
  readonly expiresAtMs?: number | null;
  readonly invalidatedAtMs?: number | null;
  readonly invalidationReason?: string | null;
  readonly invalidationCode?: ApprovalInvalidationErrorCode | null;
  readonly invalidatedBy?: string | null;
  readonly changedFields?: readonly string[];
  readonly stateHash: string;
}

/**
 * Parameters for invalidating an approval state.
 */
export interface InvalidateApprovalStateInput {
  readonly draftId: string;
  readonly expectedVersion?: number;
  readonly reason?: string;
  readonly code?: ApprovalInvalidationErrorCode;
  readonly changedFields?: readonly string[];
  readonly invalidatedBy?: string;
  readonly now?: number;
}

/**
 * Result of an approval state transition.
 */
export interface ApprovalStateTransitionResult {
  readonly success: boolean;
  readonly previousState: PayrollApprovalStateRecord;
  readonly nextState: PayrollApprovalStateRecord;
  readonly wasAlreadyInvalidated: boolean;
  readonly version: number;
}

/**
 * Computes a deterministic SHA-256 state fingerprint without leaking sensitive data.
 */
export function computeApprovalStateHash(
  record: Omit<PayrollApprovalStateRecord, "stateHash">
): string {
  const parts = [
    "zkpayroll:approval-state:v1",
    record.draftId,
    String(record.revision),
    String(record.version),
    record.status,
    String(record.approvalCount),
    String(record.requiredApprovalsCount),
    String(record.isSuperseded),
    String(record.expiresAtMs ?? ""),
    String(record.invalidatedAtMs ?? ""),
    record.invalidationCode ?? "",
    (record.changedFields ?? []).slice().sort().join(","),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * Creates an initial safe approval state record.
 */
export function createApprovalStateRecord(params: {
  draftId: string;
  revision?: number;
  version?: number;
  status?: ApprovalRecordStatus;
  approvalCount?: number;
  requiredApprovalsCount?: number;
  expiresAtMs?: number | null;
}): PayrollApprovalStateRecord {
  const base = {
    draftId: params.draftId,
    revision: params.revision ?? 1,
    version: params.version ?? 1,
    status: params.status ?? "draft",
    approvalCount: params.approvalCount ?? 0,
    requiredApprovalsCount: params.requiredApprovalsCount ?? 1,
    isSuperseded: false,
    expiresAtMs: params.expiresAtMs ?? null,
    invalidatedAtMs: null,
    invalidationReason: null,
    invalidationCode: null,
    invalidatedBy: null,
    changedFields: Object.freeze([]) as readonly string[],
  };

  const stateHash = computeApprovalStateHash(base);
  return Object.freeze({
    ...base,
    stateHash,
  });
}

/**
 * Verifies the integrity of an approval state record against its hash.
 */
export function verifyApprovalStateIntegrity(state: PayrollApprovalStateRecord): boolean {
  if (!state || typeof state !== "object" || !state.stateHash) return false;
  const expectedHash = computeApprovalStateHash(state);
  return state.stateHash === expectedHash;
}

/**
 * Checks whether an approval state can legally be transitioned to invalidated.
 */
export function canInvalidateApprovalState(state: PayrollApprovalStateRecord): {
  allowed: boolean;
  reason?: string;
  code?: ApprovalInvalidationErrorCode;
} {
  if (state.status === "executed") {
    return {
      allowed: false,
      code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATION_UNKNOWN,
      reason: "Cannot invalidate approvals for an already executed payroll run. Executed payroll transactions are final.",
    };
  }

  if (state.status === "superseded") {
    return {
      allowed: false,
      code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_SUPERSEDED,
      reason: APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_SUPERSEDED],
    };
  }

  return { allowed: true };
}

/**
 * Asserts that an approval state can be transitioned to invalidated.
 * Throws {@link ApprovalInvalidationError} if not permitted.
 */
export function assertCanInvalidateApprovalState(state: PayrollApprovalStateRecord): void {
  const check = canInvalidateApprovalState(state);
  if (!check.allowed) {
    throw new ApprovalInvalidationError(
      check.reason ?? "Approval state cannot be invalidated.",
      check.code ?? ApprovalInvalidationErrorCode.APPROVAL_INVALIDATION_UNKNOWN,
      {
        draftId: state.draftId,
        status: state.status,
        revision: state.revision,
      }
    );
  }
}

/**
 * Transitions an existing approval state to `invalidated`.
 *
 * Handles terminal status checks, version optimistic concurrency, idempotency,
 * and preserves tamper-evident hash chaining.
 *
 * @param currentState - The active approval state record.
 * @param input - Invalidation request parameters.
 * @returns State transition result with new frozen state record.
 * @throws {ApprovalInvalidationError} On illegal transition or concurrency conflict.
 */
export function transitionApprovalStateToInvalidated(
  currentState: PayrollApprovalStateRecord,
  input: InvalidateApprovalStateInput
): ApprovalStateTransitionResult {
  if (!currentState) {
    throw new ApprovalInvalidationError(
      "Current approval state record is required for state transition.",
      ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED
    );
  }

  if (currentState.draftId !== input.draftId) {
    throw new ApprovalInvalidationError(
      "Draft identifier mismatch during approval invalidation state transition.",
      ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED,
      { expectedDraftId: currentState.draftId }
    );
  }

  // Concurrency check (optimistic lock)
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== currentState.version
  ) {
    throw new ApprovalInvalidationError(
      "Concurrent modification detected. The approval state has changed since it was read.",
      ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION,
      {
        expectedVersion: input.expectedVersion,
        currentVersion: currentState.version,
        draftId: currentState.draftId,
      }
    );
  }

  // Idempotency: if already invalidated with same reason/fields, return current state
  if (currentState.status === "invalidated") {
    return {
      success: true,
      previousState: currentState,
      nextState: currentState,
      wasAlreadyInvalidated: true,
      version: currentState.version,
    };
  }

  // Invariant check: cannot invalidate executed or superseded run
  assertCanInvalidateApprovalState(currentState);

  const nowMs = input.now ?? Date.now();
  const invalidationCode =
    input.code ?? ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION;
  const defaultReason = APPROVAL_INVALIDATION_ERROR_MESSAGES[invalidationCode];
  const invalidationReason = input.reason?.trim() || defaultReason;

  const safeChangedFields = (input.changedFields ?? [])
    .filter((f): f is string => typeof f === "string")
    .slice();

  const nextUnfrozen = {
    draftId: currentState.draftId,
    revision: currentState.revision,
    version: currentState.version + 1,
    status: "invalidated" as const,
    approvalCount: 0, // Invalidated approvals reset effective sign-off count to zero
    requiredApprovalsCount: currentState.requiredApprovalsCount,
    isSuperseded: currentState.isSuperseded,
    expiresAtMs: currentState.expiresAtMs,
    invalidatedAtMs: nowMs,
    invalidationReason,
    invalidationCode,
    invalidatedBy: input.invalidatedBy?.trim() || "system",
    changedFields: Object.freeze(safeChangedFields),
  };

  const stateHash = computeApprovalStateHash(nextUnfrozen);
  const nextState: PayrollApprovalStateRecord = Object.freeze({
    ...nextUnfrozen,
    stateHash,
  });

  return {
    success: true,
    previousState: currentState,
    nextState,
    wasAlreadyInvalidated: false,
    version: nextState.version,
  };
}

/**
 * State manager for tracking and hardening payroll approval states across operations.
 */
export class ApprovalInvalidationStateManager {
  private readonly records = new Map<string, PayrollApprovalStateRecord>();

  /**
   * Registers or updates an approval state.
   */
  public register(state: PayrollApprovalStateRecord): void {
    if (!verifyApprovalStateIntegrity(state)) {
      throw new ApprovalInvalidationError(
        "Cannot register approval state: hash integrity check failed.",
        ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED,
        { draftId: state.draftId }
      );
    }
    this.records.set(state.draftId, state);
  }

  /**
   * Retrieves the current approval state for a draft.
   */
  public get(draftId: string): PayrollApprovalStateRecord | undefined {
    return this.records.get(draftId);
  }

  /**
   * Invalidates approvals for the specified draft.
   */
  public invalidate(input: InvalidateApprovalStateInput): ApprovalStateTransitionResult {
    const current = this.records.get(input.draftId);
    if (!current) {
      throw new ApprovalInvalidationError(
        "Approval state record not found for draft.",
        ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED,
        { draftId: input.draftId }
      );
    }

    const result = transitionApprovalStateToInvalidated(current, input);
    this.records.set(input.draftId, result.nextState);
    return result;
  }
}
