/**
 * Payroll domain error definitions and permission mappers.
 */
export * from "../errors/permissions";

import {
  BatchCreatorPermissionError,
  BatchCreatorPermissionErrorCode,
  type BatchCreatorRole,
} from "../errors/permissions";
import type { ErrorContext } from "../core/errors";

export interface PayrollState {
  /** Unique identifier for the payroll batch. */
  batchId: string;
  /** Current lifecycle state of the payroll batch. */
  status: "PENDING" | "EXECUTING" | "COMPLETED" | "FAILED";
  /** Optional last modified timestamp (ms). */
  updatedAt?: number;
}

export type ExecutionInitiatorRole = BatchCreatorRole;

/**
 * Validates whether the execution initiator is authorized to start a payroll run.
 * This is intentionally non-throwing so callers can inspect the result and decide
 * how to surface it in dashboards and SDK consumers.
 */
export function validateExecutionInitiatorAuthorization(
  caller: string,
  callerRoles: string[] = [],
  requiredRoles: ExecutionInitiatorRole[] = ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"],
  context: ErrorContext = {}
): { isAuthorized: boolean; requiredRoles: readonly ExecutionInitiatorRole[]; caller: string } {
  if (!caller || typeof caller !== "string") {
    return {
      isAuthorized: false,
      requiredRoles,
      caller: caller || "",
    };
  }

  const normalizedRoles = callerRoles.map((role) => String(role).trim().toUpperCase());
  const required = requiredRoles.map((role) => role.toUpperCase() as ExecutionInitiatorRole);
  const isAuthorized = normalizedRoles.some((role) => required.includes(role as ExecutionInitiatorRole));

  return {
    isAuthorized,
    requiredRoles: required,
    caller,
  };
}

/**
 * Assert that the execution initiator holds a valid payroll role before the SDK
 * allows execution to proceed.
 */
export function assertExecutionInitiatorAuthorized(
  caller: string,
  callerRoles: string[] = [],
  requiredRoles: ExecutionInitiatorRole[] = ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"],
  context: ErrorContext = {}
): void {
  const { isAuthorized } = validateExecutionInitiatorAuthorization(caller, callerRoles, requiredRoles, context);
  if (!isAuthorized) {
    if (!caller || typeof caller !== "string") {
      throw new BatchCreatorPermissionError(
        "Caller address is required to verify execution initiator authorization",
        BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR,
        { ...context, caller: caller || "[empty]" },
        {
          attemptedCaller: caller,
          requiredRoles,
        }
      );
    }

    throw new BatchCreatorPermissionError(
      `Caller ${caller} is not authorized to initiate payroll execution. Required one of: ${requiredRoles.join(", ")}`,
      BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR,
      { ...context, caller },
      {
        attemptedCaller: caller,
        requiredRoles,
      }
    );
  }
}

export const PAYROLL_STATE_TRANSITIONS: Readonly<
  Record<PayrollState["status"], readonly PayrollState["status"][]>
> = {
  PENDING: ["EXECUTING", "FAILED"],
  EXECUTING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export class PayrollStateConsistencyError extends Error {
  public readonly code = "PAYROLL_STATE_INCONSISTENT" as const;
  public readonly context: ErrorContext;
  public readonly details: {
    batchId?: string;
    currentStatus?: PayrollState["status"];
    targetStatus?: PayrollState["status"];
    allowedTransitions?: readonly PayrollState["status"][];
  };

  constructor(
    message: string,
    context: ErrorContext = {},
    details: PayrollStateConsistencyError["details"] = {}
  ) {
    super(message);
    this.name = "PayrollStateConsistencyError";
    this.context = context;
    this.details = details;
  }
}

/**
 * Asserts that an executing caller possesses one of the required batch creator roles.
 * Throws a typed `BatchCreatorPermissionError` with actionable remediation if unauthorized.
 *
 * @param caller - Address of the caller attempting batch creation.
 * @param callerRoles - Array of roles currently held by the caller.
 * @param requiredRoles - Optional list of required roles (default: BATCH_CREATOR, PAYROLL_ADMIN, EMPLOYER).
 * @param context - Optional debugging context.
 */
export function assertBatchCreatorAuthorized(
  caller: string,
  callerRoles: string[] = [],
  requiredRoles: BatchCreatorRole[] = ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"],
  context: ErrorContext = {}
): void {
  if (!caller || typeof caller !== "string") {
    throw new BatchCreatorPermissionError(
      "Caller address is required to verify batch creator authorization",
      BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR,
      { ...context, caller: caller || "[empty]" },
      {
        attemptedCaller: caller,
        requiredRoles,
      }
    );
  }

  const isAuthorized = callerRoles.some((role) =>
    requiredRoles.includes(role.toUpperCase() as BatchCreatorRole)
  );

  if (!isAuthorized) {
    throw new BatchCreatorPermissionError(
      `Caller ${caller} is not authorized to create payroll batches. Required one of: ${requiredRoles.join(", ")}`,
      BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR,
      { ...context, caller },
      {
        attemptedCaller: caller,
        requiredRoles,
      }
    );
  }
}

/**
 * Asserts that a payroll batch state transition is consistent and allowed.
 * Throws a typed `PayrollStateConsistencyError` with actionable remediation if invalid.
 *
 * @param current - Current payroll state snapshot.
 * @param targetStatus - Desired next status.
 * @param context - Optional debugging context.
 */
export function assertPayrollStateTransition(
  current: PayrollState,
  targetStatus: PayrollState["status"],
  context: ErrorContext = {}
): void {
  if (!current || typeof current !== "object") {
    throw new PayrollStateConsistencyError(
      "Current payroll state is required to verify state consistency",
      context,
      { targetStatus }
    );
  }

  if (!current.batchId || typeof current.batchId !== "string") {
    throw new PayrollStateConsistencyError(
      "Payroll batch ID is required to verify state consistency",
      context,
      { currentStatus: current.status, targetStatus }
    );
  }

  const allowed = PAYROLL_STATE_TRANSITIONS[current.status] ?? [];

  if (!allowed.includes(targetStatus)) {
    throw new PayrollStateConsistencyError(
      `Invalid payroll state transition for batch ${current.batchId} from ${current.status} to ${targetStatus}. Allowed: ${allowed.length > 0 ? allowed.join(", ") : "none (terminal state)"}`,
      context,
      {
        batchId: current.batchId,
        currentStatus: current.status,
        targetStatus,
        allowedTransitions: allowed,
      }
    );
  }
}
