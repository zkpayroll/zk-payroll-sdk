export type StaleApprovalCleanupEligibilityCode =
  | "ELIGIBLE"
  | "INVALID_STATUS"
  | "APPROVAL_NOT_STALE"
  | "MISSING_TIMESTAMP"
  | "ALREADY_EXECUTED"
  | "CLEANUP_NOT_REQUIRED";

export interface StaleApprovalCleanupEligibilityInput {
  status: unknown;
  expiresAt: unknown;
  executed: boolean;
  now?: number;
}

export interface StaleApprovalCleanupEligibility {
  isEligible: boolean;
  code: StaleApprovalCleanupEligibilityCode;
  reason: string;
  suggestedFix?: string;
}

function blocked(
  code: StaleApprovalCleanupEligibilityCode,
  reason: string,
  suggestedFix?: string
): StaleApprovalCleanupEligibility {
  return { isEligible: false, code, reason, suggestedFix };
}

/**
 * Determines whether a stale approval can be safely cleaned up.
 * 
 * Clear validation and operational states make payroll safer to run without 
 * exposing sensitive employee or salary information.
 */
export function evaluateStaleApprovalCleanupEligibility(
  input: StaleApprovalCleanupEligibilityInput
): StaleApprovalCleanupEligibility {
  if (typeof input.status !== "string" || input.status.trim() === "") {
    return blocked(
      "INVALID_STATUS",
      "An approval status is required.",
      "Fetch the latest normalized approval status before deciding whether to clean up."
    );
  }

  if (input.executed) {
    return blocked(
      "ALREADY_EXECUTED",
      "The approval has already been executed.",
      "No cleanup is required for executed approvals."
    );
  }

  const status = input.status.trim().toLowerCase();
  
  if (status !== "approved" && status !== "pending" && status !== "expired" && status !== "rejected") {
    return blocked(
      "INVALID_STATUS",
      "The approval status is not recognized.",
      "Provide a valid approval status."
    );
  }
  
  if (status === "rejected") {
    return blocked(
      "CLEANUP_NOT_REQUIRED",
      "Rejected approvals do not require cleanup.",
      "No action needed."
    );
  }

  if (!input.expiresAt) {
    return blocked(
      "MISSING_TIMESTAMP",
      "An expiration timestamp is required to determine staleness.",
      "Provide a valid expiration timestamp."
    );
  }

  const expiresAt = new Date(input.expiresAt as string | number | Date).getTime();
  if (isNaN(expiresAt)) {
    return blocked(
      "MISSING_TIMESTAMP",
      "The provided expiration timestamp is invalid.",
      "Provide a valid expiration timestamp."
    );
  }

  const now = input.now ?? Date.now();
  if (now <= expiresAt && status !== "expired") {
    return blocked(
      "APPROVAL_NOT_STALE",
      "The approval is not yet stale.",
      "Wait for the approval to expire before attempting cleanup."
    );
  }

  return {
    isEligible: true,
    code: "ELIGIBLE",
    reason: "The approval is stale and can be safely cleaned up.",
    suggestedFix: "Proceed with the cleanup operation.",
  };
}
