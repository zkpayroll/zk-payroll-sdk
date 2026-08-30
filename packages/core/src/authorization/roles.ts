import { SignerRole } from "./types";

/**
 * Typed SDK wrapper around admin role list reads (#368), so the role
 * settings UI consumes one predictable response shape instead of raw
 * contract data.
 */

/** Every role group the SDK recognizes, in a stable display order. */
export const SIGNER_ROLE_GROUPS: readonly SignerRole[] = [
  "payroll_admin",
  "treasury_operator",
  "compliance_reviewer",
  "emergency_approver",
];

export interface RoleMember {
  address: string;
  assignedAt?: number;
}

/** Role members grouped by role, normalized so every supported role group is always present (as an empty array if unassigned). */
export type RoleGroupMap = Record<SignerRole, RoleMember[]>;

export interface RoleListResponse {
  roles: RoleGroupMap;
  /** Total members across all role groups, for convenience. */
  totalMembers: number;
}

export class RoleListError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "RoleListError";
  }
}

function emptyRoleGroupMap(): RoleGroupMap {
  const map = {} as RoleGroupMap;
  for (const role of SIGNER_ROLE_GROUPS) {
    map[role] = [];
  }
  return map;
}

/** Raw shape a contract/backend role read might return, before normalization. */
export interface RawRoleAssignment {
  role: string;
  address: string;
  assignedAt?: number;
}

/**
 * Fetches admin role lists via `fetchRaw` (typically a contract read or API
 * call supplied by the caller) and normalizes the result: unrecognized role
 * strings are dropped, every supported role group is present even when
 * empty, and any thrown error is wrapped in a `RoleListError` with the
 * original error preserved as `cause`.
 */
export async function listAdminRoles(
  fetchRaw: () => Promise<RawRoleAssignment[]>
): Promise<RoleListResponse> {
  let raw: RawRoleAssignment[];
  try {
    raw = await fetchRaw();
  } catch (err) {
    throw new RoleListError("Failed to fetch admin role list", err);
  }

  const roles = emptyRoleGroupMap();
  let totalMembers = 0;

  for (const entry of raw ?? []) {
    if (!isSignerRole(entry.role)) continue;
    roles[entry.role].push({
      address: entry.address,
      assignedAt: entry.assignedAt,
    });
    totalMembers += 1;
  }

  return { roles, totalMembers };
}

function isSignerRole(value: string): value is SignerRole {
  return (SIGNER_ROLE_GROUPS as readonly string[]).includes(value);
}
