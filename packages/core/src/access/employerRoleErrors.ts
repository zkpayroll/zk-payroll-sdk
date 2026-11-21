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
  | "MISSING_ROLE_INPUT";

export interface SafeEmployerRoleIssue {
  readonly code: EmployerRoleErrorCode;
  readonly field: string;
  readonly message: string;
}

export class EmployerRoleError extends Error {
  readonly code: EmployerRoleErrorCode;
  readonly issues: readonly SafeEmployerRoleIssue[];

  constructor(message: string, code: EmployerRoleErrorCode, issues: readonly SafeEmployerRoleIssue[] = []) {
    super(message);
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
export function formatSafeEmployerRoleError(code: EmployerRoleErrorCode, field: string): SafeEmployerRoleIssue {
  const safeMessages: Record<EmployerRoleErrorCode, string> = {
    INVALID_EMPLOYER_ADDRESS: "Employer address must be a valid 56-character Stellar public key (G...)",
    INVALID_TARGET_ADDRESS: "Target account address must be a valid 56-character Stellar public key (G...)",
    CANNOT_MODIFY_OWN_ADMIN: "Cannot revoke or transfer the primary employer administrator without an active successor",
    INVALID_ROLE: "Role must be one of: EMPLOYER_ADMIN, PAYROLL_OPERATOR, AUDITOR, SIGNER",
    INVALID_ACTION: "Action must be one of: GRANT, REVOKE, TRANSFER",
    ROLE_ALREADY_ASSIGNED: "The target account already possesses the specified role",
    ROLE_NOT_ASSIGNED: "The target account does not possess the role to revoke",
    EXPIRED_ROLE_GRANT: "Role grant expiration timestamp must be in the future relative to effective date",
    INVALID_TIMESTAMP: "Effective timestamp cannot be negative or regressive beyond acceptable clock skew",
    UNAUTHORIZED_ROLE_CHANGE: "Signer is not authorized to enact employer role changes",
    MISSING_ROLE_INPUT: "Required role change parameters are missing or incomplete",
  };

  return {
    code,
    field,
    message: safeMessages[code] || "Employer role operation failed validation",
  };
}
