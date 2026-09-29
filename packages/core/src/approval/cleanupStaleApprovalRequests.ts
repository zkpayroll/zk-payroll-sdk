import type { PayrollApprovalRequest } from "./types";

/** Returns approval requests that have not expired at the supplied time. */
export function cleanupStaleApprovalRequests(
  requests: readonly PayrollApprovalRequest[],
  now: number = Date.now(),
): PayrollApprovalRequest[] {
  if (!Number.isFinite(now)) {
    throw new RangeError("Current time must be a finite timestamp.");
  }

  return requests.filter(
    (request) => Number.isFinite(request.expiresAt) && request.expiresAt > now,
  );
}