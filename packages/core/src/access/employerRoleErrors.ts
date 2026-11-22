/**
 * Safe Error Types for Employer Role Changes (#885).
 *
 * Implements privacy-preserving, strongly-typed error representations
 * for employer role administrative transitions (grants, revocations, transfers).
 * Error messages never reveal sensitive company details, salary amounts,
 * or employee identities.
 *
 * @module
 */

export type EmployerRoleErrorCode =
  | "INVALID_EMPLOYER_ADDRESS"
  | "INVALID_TARGET_ADDRESS"
  | "CANNOT_MODIFY_OWN_ADMIN"
  | "INVALID_ROLE"
  | "INVALID_ACTION"
  | "ROLE_ALREADY_ASSIGNED"
  | "ROLE_NOT_ASSIGNED"
  | "EXPIRED_ROLE_GRANT"
  | "INVALID_TIMESTAMP"
  | "UNAUTHORIZED_ROLE_CHANGE"
  | "MISSING_ROLE_INPUT"
  | "INVALID_CHANGE_ID"
  | "INVALID_SCOPE_ID"
  | "DUPLICATE_CHANGE"
  | "CHANGE_NOT_FOUND"
  | "INVALID_CHANGE_STATE"
  | "STALE_REVISION"
  | "STATE_INTEGRITY_COMPROMISED"
  | "LAST_ADMIN_REMOVAL"
  | "SAME_ACCOUNT_TRANSFER";

export interface SafeEmployerRoleIssue {
  readonly code: EmployerRoleErrorCode;
  readonly field: string;
  readonly message: string;
}

export class EmployerRoleError extends Error {
  readonly code: EmployerRoleErrorCode;
  readonly issues: readonly SafeEmployerRoleIssue[];

  constructor(
    message: string,
    code: EmployerRoleErrorCode,
    issues: readonly SafeEmployerRoleIssue[] = []
  ) {
    super(`[${code}] ${message}`);
    this.name = "EmployerRoleError";
    this.code = code;
    this.issues = Object.freeze([...issues]);
    Object.setPrototypeOf(this, EmployerRoleError.prototype);
  }
}

/**
 * Sanitizes and formats an error message for employer role changes,
 * guaranteeing no sensitive data is leaked.
 */
export function formatSafeEmployerRoleError(
  code: EmployerRoleErrorCode,
  field: string
): SafeEmployerRoleIssue {
  const safeMessages: Record<EmployerRoleErrorCode, string> = {
    INVALID_EMPLOYER_ADDRESS:
      "Employer address must be a valid 56-character Stellar public key (G...)",
    INVALID_TARGET_ADDRESS:
      "Target account address must be a valid 56-character Stellar public key (G...)",
    CANNOT_MODIFY_OWN_ADMIN:
      "Cannot revoke or transfer the primary employer administrator without an active successor",
    INVALID_ROLE: "Role must be one of: EMPLOYER_ADMIN, PAYROLL_OPERATOR, AUDITOR, SIGNER",
    INVALID_ACTION: "Action must be one of: GRANT, REVOKE, TRANSFER",
    ROLE_ALREADY_ASSIGNED: "The target account already possesses the specified role",
    ROLE_NOT_ASSIGNED: "The target account does not possess the role to revoke",
    EXPIRED_ROLE_GRANT:
      "Role grant expiration timestamp must be in the future relative to effective date",
    INVALID_TIMESTAMP:
      "Effective timestamp cannot be negative or regressive beyond acceptable clock skew",
    UNAUTHORIZED_ROLE_CHANGE: "Signer is not authorized to enact employer role changes",
    MISSING_ROLE_INPUT: "Required role change parameters are missing or incomplete",
    INVALID_CHANGE_ID: "Role change identifier must be a non-empty string",
    INVALID_SCOPE_ID: "Organization scope identifier must be a non-empty string",
    DUPLICATE_CHANGE:
      "A different role change already uses this identifier. Use a new identifier or retry with the original parameters.",
    CHANGE_NOT_FOUND:
      "No role change record exists for this identifier. Reload the current role state.",
    INVALID_CHANGE_STATE:
      "The role change is not valid in the current assignment state. Refresh role assignments before retrying.",
    STALE_REVISION:
      "Concurrent role change detected. Reload the current revision and retry with the updated value.",
    STATE_INTEGRITY_COMPROMISED:
      "Role state integrity check failed. Reload the trusted role state instead of using the local copy.",
    LAST_ADMIN_REMOVAL:
      "The last active employer administrator cannot be removed. Assign a successor administrator first.",
    SAME_ACCOUNT_TRANSFER: "A role transfer requires different source and target accounts",
  };

  return {
    code,
    field,
    message: safeMessages[code] || "Employer role operation failed validation",
  };
}
