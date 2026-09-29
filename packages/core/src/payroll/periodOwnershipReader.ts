/**
 * Payroll Period Ownership Reader
 *
 * Determines and reads ownership information for payroll periods, including
 * who owns the period, when ownership was established, and any constraints
 * on ownership transfer. Provides clear operational information without
 * exposing sensitive payroll data.
 *
 * ## Privacy & Security Guarantees
 * - Owner identifiers may be masked depending on context.
 * - Payroll amounts and employee data are never included in ownership information.
 * - Access control is enforced at the integration point.
 */

/** A payroll period ownership record. */
export interface PayrollPeriodOwnership {
  /** Payroll period identifier. */
  periodId: string;
  /** Owner identifier (typically an account or principal). */
  ownerId: string;
  /** Redacted owner identifier for safe logging. */
  redactedOwnerId: string;
  /** Timestamp when ownership was established. */
  ownershipTimestamp: number;
  /** Type of ownership (e.g., "principal", "organization", "delegate"). */
  ownershipType: "principal" | "organization" | "delegate" | "trustee";
  /** Whether ownership is transferable. */
  isTransferable: boolean;
  /** Current status of the ownership. */
  status: "active" | "suspended" | "transferred" | "revoked";
}

/** Detailed ownership read result. */
export interface PeriodOwnershipReadResult {
  /** Period ownership information. */
  ownership: PayrollPeriodOwnership;
  /** Whether the current reader has access to this information. */
  hasAccess: boolean;
  /** Accessors/delegates who have rights to the period. */
  accessors?: string[];
  /** Constraints on the ownership (e.g., expiry, conditions). */
  constraints?: OwnershipConstraint[];
}

/** A constraint on period ownership. */
export interface OwnershipConstraint {
  /** Type of constraint. */
  type: "TRANSFER_DEADLINE" | "APPROVAL_REQUIRED" | "ROLE_RESTRICTED" | "CUSTOM";
  /** Description of the constraint. */
  description: string;
  /** When the constraint expires or is enforced. */
  timestamp?: number;
  /** Whether the constraint is currently active. */
  isActive: boolean;
}

/** Options for reading period ownership. */
export interface PeriodOwnershipReadOptions {
  /** Include accessor information. Defaults to true. */
  includeAccessors?: boolean;
  /** Include ownership constraints. Defaults to true. */
  includeConstraints?: boolean;
  /** Redact owner ID in results. Defaults to false for internal use. */
  redactOwnerId?: boolean;
  /** Validate access permissions. Defaults to true. */
  validateAccess?: boolean;
}

/** Error codes for ownership read operations. */
export type PeriodOwnershipErrorCode =
  | "PERIOD_NOT_FOUND"
  | "OWNERSHIP_NOT_FOUND"
  | "ACCESS_DENIED"
  | "INVALID_PERIOD_ID"
  | "REVOKED_OWNERSHIP";

/** Exception thrown when ownership read fails. */
export interface PeriodOwnershipError {
  code: PeriodOwnershipErrorCode;
  message: string;
  periodId?: string;
  timestamp: number;
}

function redactOwnerId(id: string): string {
  if (!id || id.trim().length === 0) return "[UNKNOWN_OWNER]";
  const clean = id.trim();
  if (clean.length <= 4) return "[REDACTED_OWNER]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Create a payroll period ownership record.
 */
export function createPeriodOwnership(
  periodId: string,
  ownerId: string,
  options: {
    ownershipType?: "principal" | "organization" | "delegate" | "trustee";
    isTransferable?: boolean;
    status?: "active" | "suspended" | "transferred" | "revoked";
    ownershipTimestamp?: number;
  } = {}
): PayrollPeriodOwnership {
  const {
    ownershipType = "principal",
    isTransferable = true,
    status = "active",
    ownershipTimestamp = Date.now(),
  } = options;

  return {
    periodId,
    ownerId,
    redactedOwnerId: redactOwnerId(ownerId),
    ownershipTimestamp,
    ownershipType,
    isTransferable,
    status,
  };
}

/**
 * Read period ownership information.
 * Note: This is a pure function for demonstration. In actual implementation,
 * this would integrate with contract/database queries.
 */
export function readPeriodOwnership(
  periodId: string,
  ownership: PayrollPeriodOwnership,
  options: PeriodOwnershipReadOptions = {}
): PeriodOwnershipReadResult {
  const {
    includeAccessors = true,
    includeConstraints = true,
    validateAccess = true,
  } = options;

  // Validate period exists
  if (!periodId || periodId.trim().length === 0) {
    throw {
      code: "INVALID_PERIOD_ID",
      message: "Period ID must not be empty.",
      timestamp: Date.now(),
    } as PeriodOwnershipError;
  }

  // Check for revoked ownership
  if (ownership.status === "revoked") {
    throw {
      code: "REVOKED_OWNERSHIP",
      message: "This period's ownership has been revoked.",
      periodId,
      timestamp: Date.now(),
    } as PeriodOwnershipError;
  }

  // Build constraints if requested
  const constraints: OwnershipConstraint[] = [];
  if (includeConstraints) {
    if (!ownership.isTransferable) {
      constraints.push({
        type: "ROLE_RESTRICTED",
        description: "Ownership transfer is not allowed.",
        isActive: true,
      });
    }
  }

  return {
    ownership,
    hasAccess: true,
    accessors: includeAccessors ? [ownership.ownerId] : undefined,
    constraints: includeConstraints && constraints.length > 0 ? constraints : undefined,
  };
}

/**
 * Check if an owner has authority over a period.
 */
export function hasOwnershipAuthority(
  ownership: PayrollPeriodOwnership,
  potentialOwnerId: string
): boolean {
  if (ownership.status !== "active") {
    return false;
  }

  return ownership.ownerId === potentialOwnerId;
}

/**
 * Determine if ownership can be transferred.
 */
export function canTransferOwnership(
  ownership: PayrollPeriodOwnership,
  constraints?: OwnershipConstraint[]
): boolean {
  if (!ownership.isTransferable || ownership.status !== "active") {
    return false;
  }

  if (constraints && constraints.length > 0) {
    return !constraints.some((c) => c.isActive && c.type === "TRANSFER_DEADLINE");
  }

  return true;
}

/**
 * Get the effective owner for authorization checks.
 */
export function getEffectiveOwner(
  ownership: PayrollPeriodOwnership,
  accessors?: string[]
): string {
  if (ownership.status === "active") {
    return ownership.ownerId;
  }

  if (ownership.status === "transferred" && accessors && accessors.length > 0) {
    return accessors[0];
  }

  return ownership.ownerId;
}

/**
 * Check if ownership status is valid for operations.
 */
export function isOwnershipValid(
  ownership: PayrollPeriodOwnership
): boolean {
  return (
    ownership.status === "active" &&
    ownership.ownerId &&
    ownership.ownerId.trim().length > 0 &&
    ownership.ownershipTimestamp <= Date.now()
  );
}
