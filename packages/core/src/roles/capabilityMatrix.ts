/**
 * Payroll Role Capability Matrix (#281).
 *
 * Provides a canonical mapping between payroll roles and supported SDK actions
 * (e.g., review, approve, submit, audit, export, configure, cancel).
 *
 * Designed for frontend dashboards, backend API guards, and SDK runtime checks.
 */

/**
 * Standard payroll roles recognized across the SDK.
 */
export type PayrollRole =
  | "payroll_admin"
  | "batch_creator"
  | "treasury_operator"
  | "compliance_reviewer"
  | "emergency_approver"
  | "auditor"
  | "employee"
  | "viewer";

/**
 * All recognized roles as a constant array.
 */
export const ALL_PAYROLL_ROLES: readonly PayrollRole[] = [
  "payroll_admin",
  "batch_creator",
  "treasury_operator",
  "compliance_reviewer",
  "emergency_approver",
  "auditor",
  "employee",
  "viewer",
];

/**
 * Standard SDK actions that roles can perform.
 */
export type PayrollAction =
  | "review"
  | "approve"
  | "submit"
  | "audit"
  | "export"
  | "configure"
  | "cancel";

/**
 * All recognized actions as a constant array.
 */
export const ALL_PAYROLL_ACTIONS: readonly PayrollAction[] = [
  "review",
  "approve",
  "submit",
  "audit",
  "export",
  "configure",
  "cancel",
];

/**
 * Granular capability permission level.
 */
export type CapabilityPermission = "allowed" | "denied" | "conditional";

/**
 * Error thrown when an assigned role attempts an unauthorized action.
 */
export class PayrollRolePermissionError extends Error {
  public readonly code = "INSUFFICIENT_ROLE_CAPABILITY";
  public readonly role: string;
  public readonly action: string;

  constructor(role: string, action: string, message?: string) {
    super(
      message ??
        `Role '${role}' lacks capability to perform action '${action}'. Action is restricted.`
    );
    this.name = "PayrollRolePermissionError";
    this.role = role;
    this.action = action;
  }
}

/**
 * Default role capability matrix defining permissions across all standard roles.
 */
export const DEFAULT_ROLE_CAPABILITY_MATRIX: Record<
  PayrollRole,
  Record<PayrollAction, CapabilityPermission>
> = {
  payroll_admin: {
    review: "allowed",
    approve: "allowed",
    submit: "allowed",
    audit: "allowed",
    export: "allowed",
    configure: "allowed",
    cancel: "allowed",
  },
  batch_creator: {
    review: "allowed",
    approve: "denied",
    submit: "allowed",
    audit: "denied",
    export: "allowed",
    configure: "denied",
    cancel: "conditional", // allowed only for uncommitted drafts
  },
  treasury_operator: {
    review: "allowed",
    approve: "allowed",
    submit: "allowed",
    audit: "conditional",
    export: "allowed",
    configure: "conditional",
    cancel: "conditional",
  },
  compliance_reviewer: {
    review: "allowed",
    approve: "conditional", // compliance release / hold sign-off
    submit: "denied",
    audit: "allowed",
    export: "allowed",
    configure: "denied",
    cancel: "conditional", // place compliance hold
  },
  emergency_approver: {
    review: "allowed",
    approve: "allowed",
    submit: "denied",
    audit: "conditional",
    export: "denied",
    configure: "denied",
    cancel: "allowed", // emergency stop
  },
  auditor: {
    review: "allowed",
    approve: "denied",
    submit: "denied",
    audit: "allowed",
    export: "allowed",
    configure: "denied",
    cancel: "denied",
  },
  employee: {
    review: "conditional", // self-service paystubs only
    approve: "denied",
    submit: "denied",
    audit: "denied",
    export: "conditional", // own receipt export only
    configure: "denied",
    cancel: "denied",
  },
  viewer: {
    review: "allowed", // read-only dashboard overview
    approve: "denied",
    submit: "denied",
    audit: "denied",
    export: "denied",
    configure: "denied",
    cancel: "denied",
  },
};

/**
 * Capability Matrix manager for evaluating role-action permissions.
 */
export class PayrollRoleCapabilityMatrix {
  private matrix: Record<string, Record<string, CapabilityPermission>>;

  constructor(
    customOverrides?: Partial<
      Record<PayrollRole, Partial<Record<PayrollAction, CapabilityPermission>>>
    >
  ) {
    // Deep clone the default matrix
    this.matrix = JSON.parse(JSON.stringify(DEFAULT_ROLE_CAPABILITY_MATRIX));

    if (customOverrides) {
      for (const [role, actions] of Object.entries(customOverrides)) {
        if (!this.matrix[role]) {
          this.matrix[role] = {} as Record<string, CapabilityPermission>;
        }
        for (const [action, perm] of Object.entries(actions ?? {})) {
          if (perm) {
            this.matrix[role][action] = perm;
          }
        }
      }
    }
  }

  /**
   * Checks whether a role has permission to perform an action.
   * By default, returns true for "allowed", and true for "conditional" if allowConditional is true.
   *
   * @param role - The role to inspect
   * @param action - The action to evaluate
   * @param allowConditional - Whether "conditional" counts as granted (default: true)
   */
  hasCapability(
    role: PayrollRole | string,
    action: PayrollAction | string,
    allowConditional = true
  ): boolean {
    const perm = this.getPermission(role, action);
    if (perm === "allowed") return true;
    if (perm === "conditional" && allowConditional) return true;
    return false;
  }

  /**
   * Gets the exact permission level ("allowed" | "denied" | "conditional") for a role and action.
   */
  getPermission(
    role: PayrollRole | string,
    action: PayrollAction | string
  ): CapabilityPermission {
    const roleMap = this.matrix[role];
    if (!roleMap) return "denied";
    return roleMap[action] ?? "denied";
  }

  /**
   * Asserts that a role can perform the action; throws PayrollRolePermissionError otherwise.
   */
  assertCapability(
    role: PayrollRole | string,
    action: PayrollAction | string,
    allowConditional = true
  ): void {
    if (!this.hasCapability(role, action, allowConditional)) {
      throw new PayrollRolePermissionError(role, action);
    }
  }

  /**
   * Returns all actions that a given role is permitted to perform.
   */
  getCapabilitiesForRole(
    role: PayrollRole | string,
    allowConditional = true
  ): PayrollAction[] {
    const roleMap = this.matrix[role];
    if (!roleMap) return [];

    return (Object.keys(roleMap) as PayrollAction[]).filter((action) => {
      const perm = roleMap[action];
      return perm === "allowed" || (perm === "conditional" && allowConditional);
    });
  }

  /**
   * Returns all roles that possess the given action capability.
   */
  getRolesWithCapability(
    action: PayrollAction | string,
    allowConditional = true
  ): PayrollRole[] {
    return (Object.keys(this.matrix) as PayrollRole[]).filter((role) =>
      this.hasCapability(role, action, allowConditional)
    );
  }

  /**
   * Checks whether a user with one or more assigned roles can perform an action.
   * Returns true if ANY assigned role has the capability (role union).
   */
  hasUserCapability(
    userRoles: (PayrollRole | string)[],
    action: PayrollAction | string,
    allowConditional = true
  ): boolean {
    if (!userRoles || userRoles.length === 0) return false;
    return userRoles.some((r) => this.hasCapability(r, action, allowConditional));
  }

  /**
   * Returns the deduplicated set union of all allowed actions for a multi-role user.
   */
  getEffectiveCapabilities(
    userRoles: (PayrollRole | string)[],
    allowConditional = true
  ): PayrollAction[] {
    if (!userRoles || userRoles.length === 0) return [];

    const actionsSet = new Set<PayrollAction>();
    for (const role of userRoles) {
      const actions = this.getCapabilitiesForRole(role, allowConditional);
      for (const a of actions) {
        actionsSet.add(a);
      }
    }

    return Array.from(actionsSet);
  }

  /**
   * Evaluates if a role has at least one of the specified actions.
   */
  hasAnyCapability(
    role: PayrollRole | string,
    actions: (PayrollAction | string)[],
    allowConditional = true
  ): boolean {
    return actions.some((act) => this.hasCapability(role, act, allowConditional));
  }

  /**
   * Evaluates if a role has all of the specified actions.
   */
  hasAllCapabilities(
    role: PayrollRole | string,
    actions: (PayrollAction | string)[],
    allowConditional = true
  ): boolean {
    return actions.every((act) => this.hasCapability(role, act, allowConditional));
  }

  /**
   * Returns a copy of the underlying matrix mapping.
   */
  toMatrixMap(): Record<string, Record<string, CapabilityPermission>> {
    return JSON.parse(JSON.stringify(this.matrix));
  }

  /**
   * Formats a clean ASCII table representation of the matrix for dashboards or documentation.
   */
  formatCapabilityTable(): string {
    const actions = [...ALL_PAYROLL_ACTIONS];
    const header = `| Role | ${actions.join(" | ")} |`;
    const separator = `| :--- | ${actions.map(() => ":---:").join(" | ")} |`;

    const rows = ALL_PAYROLL_ROLES.map((role) => {
      const cells = actions.map((act) => {
        const p = this.getPermission(role, act);
        if (p === "allowed") return "✅";
        if (p === "conditional") return "⚠️";
        return "❌";
      });
      return `| ${role} | ${cells.join(" | ")} |`;
    });

    return [header, separator, ...rows].join("\n");
  }
}

// ── Standalone Utility Helpers ──────────────────────────────────────────────

const defaultInstance = new PayrollRoleCapabilityMatrix();

/**
 * Checks if a role has capability for a given action using the default matrix.
 */
export function checkRoleCapability(
  role: PayrollRole | string,
  action: PayrollAction | string,
  allowConditional = true
): boolean {
  return defaultInstance.hasCapability(role, action, allowConditional);
}

/**
 * Retrieves all actions allowed for a role using the default matrix.
 */
export function getRoleActions(
  role: PayrollRole | string,
  allowConditional = true
): PayrollAction[] {
  return defaultInstance.getCapabilitiesForRole(role, allowConditional);
}

/**
 * Checks if a multi-role user has capability for an action using the default matrix.
 */
export function canUserPerform(
  userRoles: (PayrollRole | string)[],
  action: PayrollAction | string,
  allowConditional = true
): boolean {
  return defaultInstance.hasUserCapability(userRoles, action, allowConditional);
}
