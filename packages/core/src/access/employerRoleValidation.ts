/**
 * Typed Validation for Employer Role Changes (#884).
 *
 * Implements pure SDK-layer validation for role grants, revocations,
 * and transfers within the employer authorization hierarchy.
 *
 * @module
 */

import {
  EmployerRoleError,
  EmployerRoleErrorCode,
  SafeEmployerRoleIssue,
  formatSafeEmployerRoleError,
} from "./employerRoleErrors";

export type EmployerRole = "EMPLOYER_ADMIN" | "PAYROLL_OPERATOR" | "AUDITOR" | "SIGNER";
export type EmployerRoleAction = "GRANT" | "REVOKE" | "TRANSFER";

export interface EmployerRoleChangeInput {
  readonly employer: string;
  readonly targetAccount: string;
  readonly role: EmployerRole;
  readonly action: EmployerRoleAction;
  readonly effectiveAt?: number;
  readonly expiresAt?: number;
  readonly currentAdmin?: string;
  readonly existingRoles?: readonly EmployerRole[];
}

export interface EmployerRoleValidationResult {
  readonly isValid: boolean;
  readonly issues: readonly SafeEmployerRoleIssue[];
}

/** Regex for validating standard Stellar public keys (G... 56 chars). */
const STELLAR_PUBKEY_REGEX = /^G[A-Z2-7]{55}$/;

/**
 * Validates whether a string is a well-formed Stellar public key.
 */
export function isValidStellarAddress(address: unknown): boolean {
  return typeof address === "string" && STELLAR_PUBKEY_REGEX.test(address);
}

const VALID_ROLES = new Set<EmployerRole>([
  "EMPLOYER_ADMIN",
  "PAYROLL_OPERATOR",
  "AUDITOR",
  "SIGNER",
]);

const VALID_ACTIONS = new Set<EmployerRoleAction>([
  "GRANT",
  "REVOKE",
  "TRANSFER",
]);

/** Maximum acceptable clock skew in milliseconds (5 minutes). */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Validates a proposed employer role change against structural and domain rules.
 */
export function validateEmployerRoleChange(
  input: EmployerRoleChangeInput,
  referenceTimeMs: number = Date.now()
): EmployerRoleValidationResult {
  const issues: SafeEmployerRoleIssue[] = [];

  if (!input || typeof input !== "object") {
    issues.push(formatSafeEmployerRoleError("MISSING_ROLE_INPUT", "input"));
    return { isValid: false, issues: Object.freeze(issues) };
  }

  // 1. Validate Employer address
  if (!isValidStellarAddress(input.employer)) {
    issues.push(formatSafeEmployerRoleError("INVALID_EMPLOYER_ADDRESS", "employer"));
  }

  // 2. Validate Target Account address
  if (!isValidStellarAddress(input.targetAccount)) {
    issues.push(formatSafeEmployerRoleError("INVALID_TARGET_ADDRESS", "targetAccount"));
  }

  // 3. Validate Role
  if (!VALID_ROLES.has(input.role)) {
    issues.push(formatSafeEmployerRoleError("INVALID_ROLE", "role"));
  }

  // 4. Validate Action
  if (!VALID_ACTIONS.has(input.action)) {
    issues.push(formatSafeEmployerRoleError("INVALID_ACTION", "action"));
  }

  // 5. Timestamps validation
  const effectiveAt = input.effectiveAt ?? referenceTimeMs;
  if (!Number.isFinite(effectiveAt) || effectiveAt < 0) {
    issues.push(formatSafeEmployerRoleError("INVALID_TIMESTAMP", "effectiveAt"));
  } else if (effectiveAt < referenceTimeMs - MAX_CLOCK_SKEW_MS) {
    issues.push(formatSafeEmployerRoleError("INVALID_TIMESTAMP", "effectiveAt"));
  }

  if (input.expiresAt !== undefined) {
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= effectiveAt) {
      issues.push(formatSafeEmployerRoleError("EXPIRED_ROLE_GRANT", "expiresAt"));
    }
  }

  // 6. Action-specific domain guards
  if (input.action === "GRANT" && input.existingRoles && input.existingRoles.includes(input.role)) {
    issues.push(formatSafeEmployerRoleError("ROLE_ALREADY_ASSIGNED", "role"));
  }

  if (input.action === "REVOKE" && input.existingRoles && !input.existingRoles.includes(input.role)) {
    issues.push(formatSafeEmployerRoleError("ROLE_NOT_ASSIGNED", "role"));
  }

  // Self-admin protection: cannot revoke admin from oneself without successor
  if (
    input.role === "EMPLOYER_ADMIN" &&
    input.action === "REVOKE" &&
    input.currentAdmin &&
    input.targetAccount === input.currentAdmin
  ) {
    issues.push(formatSafeEmployerRoleError("CANNOT_MODIFY_OWN_ADMIN", "targetAccount"));
  }

  // Transfer must target a different account
  if (input.action === "TRANSFER" && input.employer === input.targetAccount) {
    issues.push(formatSafeEmployerRoleError("INVALID_TARGET_ADDRESS", "targetAccount"));
  }

  return {
    isValid: issues.length === 0,
    issues: Object.freeze(issues),
  };
}

/**
 * Asserts that a proposed employer role change is valid, throwing EmployerRoleError if not.
 */
export function assertValidEmployerRoleChange(
  input: EmployerRoleChangeInput,
  referenceTimeMs: number = Date.now()
): void {
  const result = validateEmployerRoleChange(input, referenceTimeMs);
  if (!result.isValid) {
    const firstIssue = result.issues[0];
    throw new EmployerRoleError(
      firstIssue ? firstIssue.message : "Employer role validation failed",
      firstIssue ? firstIssue.code : "MISSING_ROLE_INPUT",
      result.issues
    );
  }
}
