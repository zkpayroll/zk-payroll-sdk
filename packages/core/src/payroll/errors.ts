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
