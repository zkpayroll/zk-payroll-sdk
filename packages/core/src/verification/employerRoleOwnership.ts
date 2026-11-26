/**
 * Employer Role Ownership Verification & Refresh (#851)
 *
 * Enforces pre-submission verification and refresh of employer role ownership
 * in the SDK layer before payroll execution or batch submission.
 *
 * Guarantees that:
 * 1. The submitting operator or administrator possesses an active, unexpired,
 *    and unrevoked employer role.
 * 2. Role state is refreshed against the authoritative role resolver or state manager,
 *    preventing stale or revoked authorizations from executing payroll.
 * 3. Sensitive payroll data (employee identities, salaries, proof witnesses) is
 *    NEVER exposed in verification errors, logs, or diagnostic contexts.
 *
 * @module
 */

import { ZkPayrollError } from "../core/errors";
import {
  EmployerRoleStateManager,
  EmployerRoleChangeRecord,
} from "../access/employerRoleState";
import { EmployerRole } from "../access/employerRoleValidation";
import {
  EmployerRoleError,
  EmployerRoleErrorCode,
  SafeEmployerRoleIssue,
  formatSafeEmployerRoleError,
} from "../access/employerRoleErrors";

/** Allowed role statuses for an active employer role ownership. */
export type EmployerRoleOwnershipStatus = "ACTIVE" | "REVOKED" | "SUPERSEDED" | "EXPIRED";

/** Record describing an account's verified employer role ownership. */
export interface EmployerRoleOwnershipRecord {
  readonly employer: string;
  readonly targetAccount: string;
  readonly role: EmployerRole;
  readonly status: EmployerRoleOwnershipStatus;
  readonly effectiveAt: number;
  readonly expiresAt?: number;
  readonly revision?: number;
  readonly scopeId?: string;
}

/** Function or manager capable of providing refreshed employer role ownership. */
export type EmployerRoleOwnershipResolver =
  | EmployerRoleStateManager
  | ((
      account: string,
      scopeId?: string
    ) => Promise<
      | readonly EmployerRole[]
      | EmployerRoleOwnershipRecord
      | readonly EmployerRoleOwnershipRecord[]
      | EmployerRoleChangeRecord
      | readonly EmployerRoleChangeRecord[]
      | undefined
      | null
    >);

/** Options for refreshing and verifying employer role ownership. */
export interface RefreshEmployerRoleOwnershipOptions {
  /** Account address of the operator or administrator submitting payroll. */
  readonly account: string;
  /** Role(s) required to submit payroll. Defaults to PAYROLL_OPERATOR and EMPLOYER_ADMIN. */
  readonly requiredRole?: EmployerRole | readonly EmployerRole[];
  /** Organization or employer scope identifier. */
  readonly scopeId?: string;
  /** Employer address for verification. */
  readonly employer?: string;
  /** Authoritative resolver or state manager to refresh ownership against. */
  readonly resolver: EmployerRoleOwnershipResolver;
  /** Timestamp reference for checking expiration (defaults to Date.now()). */
  readonly now?: number;
}

/** Result of refreshing and verifying employer role ownership. */
export interface EmployerRoleOwnershipRefreshResult {
  readonly ok: boolean;
  readonly account: string;
  readonly activeRoles: readonly EmployerRole[];
  readonly record?: EmployerRoleOwnershipRecord;
  readonly errorCode?: EmployerRoleErrorCode;
  readonly message?: string;
}

/** Default roles authorized to submit payroll disbursements. */
export const DEFAULT_PAYROLL_SUBMISSION_ROLES: readonly EmployerRole[] = Object.freeze([
  "PAYROLL_OPERATOR",
  "EMPLOYER_ADMIN",
]);

/**
 * Privacy-preserving error thrown when employer role ownership verification fails.
 */
export class EmployerRoleOwnershipVerificationError extends ZkPayrollError {
  public readonly errorCode: EmployerRoleErrorCode;
  public readonly issues: readonly SafeEmployerRoleIssue[];

  constructor(
    code: EmployerRoleErrorCode,
    field: string = "account",
    customMessage?: string
  ) {
    const issue = formatSafeEmployerRoleError(code, field);
    const message = customMessage || issue.message;
    super(`[${code}] ${message}`, code, { field, code });
    this.name = "EmployerRoleOwnershipVerificationError";
    this.errorCode = code;
    this.issues = Object.freeze([issue]);
    Object.setPrototypeOf(this, EmployerRoleOwnershipVerificationError.prototype);
  }
}

function normalizeRoles(requiredRole?: EmployerRole | readonly EmployerRole[]): readonly EmployerRole[] {
  if (!requiredRole) return DEFAULT_PAYROLL_SUBMISSION_ROLES;
  return Array.isArray(requiredRole) ? requiredRole : [requiredRole as EmployerRole];
}

/**
 * Refreshes employer role ownership and evaluates whether the account is authorized
 * to submit payroll under the specified scope.
 */
export async function refreshEmployerRoleOwnership(
  options: RefreshEmployerRoleOwnershipOptions
): Promise<EmployerRoleOwnershipRefreshResult> {
  const account = options.account?.trim();
  if (!account) {
    return {
      ok: false,
      account: "",
      activeRoles: Object.freeze([]),
      errorCode: "INVALID_TARGET_ADDRESS",
      message: "Target account address must be a valid non-empty identifier",
    };
  }

  const now = options.now ?? Date.now();
  const required = normalizeRoles(options.requiredRole);
  const scopeId = options.scopeId?.trim() || options.employer?.trim() || "default";

  let activeRoles: EmployerRole[] = [];
  let matchingRecord: EmployerRoleOwnershipRecord | undefined;

  if (options.resolver instanceof EmployerRoleStateManager) {
    const stateManager = options.resolver;
    const assignedRoles = stateManager.activeRoles(scopeId, account);
    activeRoles = [...assignedRoles];

    // Check specific required roles for expiration
    for (const role of required) {
      const change = stateManager.latestChange(scopeId, account, role);
      if (change) {
        if (change.status === "ACTIVE") {
          if (change.expiresAt !== undefined && change.expiresAt <= now) {
            return {
              ok: false,
              account,
              activeRoles: Object.freeze(activeRoles.filter((r) => r !== role)),
              errorCode: "EXPIRED_ROLE_GRANT",
              message: "Role grant has expired and must be renewed prior to submission",
            };
          }
          matchingRecord = {
            employer: change.employer,
            targetAccount: change.targetAccount,
            role: change.role,
            status: change.status,
            effectiveAt: change.effectiveAt,
            expiresAt: change.expiresAt,
            revision: change.revision,
            scopeId: change.scopeId,
          };
          break;
        } else if (change.status === "REVOKED") {
          return {
            ok: false,
            account,
            activeRoles: Object.freeze([]),
            errorCode: "ROLE_NOT_ASSIGNED",
            message: "Employer role has been revoked for this account",
          };
        }
      }
    }
  } else if (typeof options.resolver === "function") {
    const resolved = await options.resolver(account, scopeId);
    if (!resolved) {
      return {
        ok: false,
        account,
        activeRoles: Object.freeze([]),
        errorCode: "ROLE_NOT_ASSIGNED",
        message: "No active employer role found for this account",
      };
    }

    if (Array.isArray(resolved)) {
      if (resolved.length === 0) {
        return {
          ok: false,
          account,
          activeRoles: Object.freeze([]),
          errorCode: "ROLE_NOT_ASSIGNED",
          message: "No active employer role found for this account",
        };
      }

      if (typeof resolved[0] === "string") {
        activeRoles = resolved as EmployerRole[];
      } else {
        const records = resolved as (EmployerRoleOwnershipRecord | EmployerRoleChangeRecord)[];
        for (const rec of records) {
          if (rec.status === "ACTIVE") {
            if (rec.expiresAt !== undefined && rec.expiresAt <= now) {
              continue;
            }
            activeRoles.push(rec.role);
            if (!matchingRecord && required.includes(rec.role)) {
              matchingRecord = {
                employer: rec.employer,
                targetAccount: rec.targetAccount,
                role: rec.role,
                status: "ACTIVE",
                effectiveAt: rec.effectiveAt,
                expiresAt: rec.expiresAt,
                revision: rec.revision,
                scopeId: (rec as EmployerRoleOwnershipRecord).scopeId,
              };
            }
          }
        }
      }
    } else {
      const rec = resolved as EmployerRoleOwnershipRecord | EmployerRoleChangeRecord;
      if (rec.status === "ACTIVE") {
        if (rec.expiresAt !== undefined && rec.expiresAt <= now) {
          return {
            ok: false,
            account,
            activeRoles: Object.freeze([]),
            errorCode: "EXPIRED_ROLE_GRANT",
            message: "Role grant has expired and must be renewed prior to submission",
          };
        }
        activeRoles.push(rec.role);
        matchingRecord = {
          employer: rec.employer,
          targetAccount: rec.targetAccount,
          role: rec.role,
          status: "ACTIVE",
          effectiveAt: rec.effectiveAt,
          expiresAt: rec.expiresAt,
          revision: rec.revision,
          scopeId: (rec as EmployerRoleOwnershipRecord).scopeId,
        };
      } else {
        return {
          ok: false,
          account,
          activeRoles: Object.freeze([]),
          errorCode: rec.status === "EXPIRED" ? "EXPIRED_ROLE_GRANT" : "ROLE_NOT_ASSIGNED",
          message: `Employer role is not active (current status: ${rec.status})`,
        };
      }
    }
  }

  const hasAuthorizedRole = activeRoles.some((role) => required.includes(role));
  if (!hasAuthorizedRole) {
    return {
      ok: false,
      account,
      activeRoles: Object.freeze([...activeRoles]),
      errorCode: "UNAUTHORIZED_ROLE_CHANGE",
      message: "Account does not possess the required active employer role for payroll submission",
    };
  }

  return {
    ok: true,
    account,
    activeRoles: Object.freeze([...activeRoles]),
    record: matchingRecord,
  };
}

/**
 * Asserts that the employer role ownership has been refreshed and is active
 * before payroll submission.
 *
 * @throws {EmployerRoleOwnershipVerificationError} if verification fails.
 */
export async function assertActiveEmployerRoleOwnership(
  options: RefreshEmployerRoleOwnershipOptions
): Promise<EmployerRoleOwnershipRefreshResult> {
  const result = await refreshEmployerRoleOwnership(options);
  if (!result.ok) {
    throw new EmployerRoleOwnershipVerificationError(
      result.errorCode || "UNAUTHORIZED_ROLE_CHANGE",
      "account",
      result.message
    );
  }
  return result;
}
