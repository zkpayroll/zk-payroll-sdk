import {
  PayrollRoleCapabilityMatrix,
  PayrollRolePermissionError,
  ALL_PAYROLL_ROLES,
  ALL_PAYROLL_ACTIONS,
  checkRoleCapability,
  getRoleActions,
  canUserPerform,
  PayrollRole,
  PayrollAction,
} from "../src/roles/capabilityMatrix";

describe("Payroll Role Capability Matrix (#281)", () => {
  let matrix: PayrollRoleCapabilityMatrix;

  beforeEach(() => {
    matrix = new PayrollRoleCapabilityMatrix();
  });

  describe("Default Permissions for Standard Roles", () => {
    it("grants payroll_admin all standard SDK actions", () => {
      for (const action of ALL_PAYROLL_ACTIONS) {
        expect(matrix.hasCapability("payroll_admin", action)).toBe(true);
        expect(matrix.getPermission("payroll_admin", action)).toBe("allowed");
      }
      expect(matrix.getCapabilitiesForRole("payroll_admin")).toEqual(
        expect.arrayContaining([...ALL_PAYROLL_ACTIONS])
      );
    });

    it("restricts auditor to read-only and audit actions", () => {
      expect(matrix.hasCapability("auditor", "review")).toBe(true);
      expect(matrix.hasCapability("auditor", "audit")).toBe(true);
      expect(matrix.hasCapability("auditor", "export")).toBe(true);

      expect(matrix.hasCapability("auditor", "approve")).toBe(false);
      expect(matrix.hasCapability("auditor", "submit")).toBe(false);
      expect(matrix.hasCapability("auditor", "configure")).toBe(false);
      expect(matrix.hasCapability("auditor", "cancel")).toBe(false);
    });

    it("allows batch_creator to submit, review, and export, but not approve or configure", () => {
      expect(matrix.hasCapability("batch_creator", "submit")).toBe(true);
      expect(matrix.hasCapability("batch_creator", "review")).toBe(true);
      expect(matrix.hasCapability("batch_creator", "export")).toBe(true);

      expect(matrix.hasCapability("batch_creator", "approve")).toBe(false);
      expect(matrix.hasCapability("batch_creator", "configure")).toBe(false);
      expect(matrix.hasCapability("batch_creator", "audit")).toBe(false);
    });

    it("evaluates viewer as read-only with only review permitted", () => {
      expect(matrix.hasCapability("viewer", "review")).toBe(true);
      expect(matrix.hasCapability("viewer", "export")).toBe(false);
      expect(matrix.hasCapability("viewer", "submit")).toBe(false);
      expect(matrix.hasCapability("viewer", "approve")).toBe(false);
    });
  });

  describe("Conditional Capability Handling", () => {
    it("distinguishes conditional permission when allowConditional is false", () => {
      // employee has conditional review (own records only)
      expect(matrix.getPermission("employee", "review")).toBe("conditional");

      // By default allowConditional is true
      expect(matrix.hasCapability("employee", "review", true)).toBe(true);

      // In strict mode without conditions met
      expect(matrix.hasCapability("employee", "review", false)).toBe(false);
    });

    it("handles batch_creator conditional cancellation", () => {
      expect(matrix.getPermission("batch_creator", "cancel")).toBe("conditional");
      expect(matrix.hasCapability("batch_creator", "cancel", true)).toBe(true);
      expect(matrix.hasCapability("batch_creator", "cancel", false)).toBe(false);
    });
  });

  describe("assertCapability", () => {
    it("does not throw when role has the capability", () => {
      expect(() => {
        matrix.assertCapability("payroll_admin", "submit");
      }).not.toThrow();
    });

    it("throws PayrollRolePermissionError when action is forbidden", () => {
      expect(() => {
        matrix.assertCapability("auditor", "submit");
      }).toThrow(PayrollRolePermissionError);

      try {
        matrix.assertCapability("auditor", "submit");
      } catch (err: any) {
        expect(err.code).toBe("INSUFFICIENT_ROLE_CAPABILITY");
        expect(err.role).toBe("auditor");
        expect(err.action).toBe("submit");
        expect(err.message).toContain("Role 'auditor' lacks capability");
      }
    });
  });

  describe("Multi-Role User Capabilities", () => {
    it("unions capabilities across multiple assigned roles", () => {
      const userRoles: PayrollRole[] = ["auditor", "batch_creator"];

      // auditor has audit, batch_creator does not
      expect(matrix.hasUserCapability(userRoles, "audit")).toBe(true);

      // batch_creator has submit, auditor does not
      expect(matrix.hasUserCapability(userRoles, "submit")).toBe(true);

      // neither has configure
      expect(matrix.hasUserCapability(userRoles, "configure")).toBe(false);
    });

    it("returns empty capabilities for empty role list", () => {
      expect(matrix.hasUserCapability([], "review")).toBe(false);
      expect(matrix.getEffectiveCapabilities([])).toEqual([]);
    });

    it("computes deduplicated effective capabilities", () => {
      const userRoles: PayrollRole[] = ["auditor", "viewer"];
      const effective = matrix.getEffectiveCapabilities(userRoles);

      expect(effective).toContain("review");
      expect(effective).toContain("audit");
      expect(effective).toContain("export");
      expect(effective).not.toContain("submit");

      // Verify no duplicates
      const uniqueCount = new Set(effective).size;
      expect(effective.length).toBe(uniqueCount);
    });
  });

  describe("Reverse Queries and Aggregations", () => {
    it("finds all roles with a specific capability", () => {
      const approvers = matrix.getRolesWithCapability("approve");
      expect(approvers).toContain("payroll_admin");
      expect(approvers).toContain("treasury_operator");
      expect(approvers).toContain("emergency_approver");
      expect(approvers).not.toContain("viewer");
      expect(approvers).not.toContain("auditor");
    });

    it("checks hasAnyCapability and hasAllCapabilities", () => {
      expect(
        matrix.hasAnyCapability("auditor", ["submit", "configure", "audit"])
      ).toBe(true);

      expect(
        matrix.hasAllCapabilities("auditor", ["audit", "export", "review"])
      ).toBe(true);

      expect(
        matrix.hasAllCapabilities("auditor", ["audit", "submit"])
      ).toBe(false);
    });
  });

  describe("Custom Overrides", () => {
    it("allows customizing matrix permissions via constructor", () => {
      const customMatrix = new PayrollRoleCapabilityMatrix({
        auditor: {
          submit: "allowed",
        },
        batch_creator: {
          submit: "denied",
        },
      });

      expect(customMatrix.hasCapability("auditor", "submit")).toBe(true);
      expect(customMatrix.hasCapability("batch_creator", "submit")).toBe(false);
    });
  });

  describe("Capability Table Formatting", () => {
    it("generates markdown formatted table with all roles and actions", () => {
      const table = matrix.formatCapabilityTable();
      expect(table).toContain("| Role |");
      expect(table).toContain("payroll_admin");
      expect(table).toContain("auditor");
      expect(table).toContain("✅");
      expect(table).toContain("❌");
      expect(table).toContain("⚠️");
    });
  });

  describe("Standalone Helper Functions", () => {
    it("checkRoleCapability works identically to default instance", () => {
      expect(checkRoleCapability("payroll_admin", "configure")).toBe(true);
      expect(checkRoleCapability("viewer", "configure")).toBe(false);
    });

    it("getRoleActions returns allowed actions for role", () => {
      const actions = getRoleActions("viewer");
      expect(actions).toEqual(["review"]);
    });

    it("canUserPerform checks multi-role permission correctly", () => {
      expect(canUserPerform(["viewer", "batch_creator"], "submit")).toBe(true);
      expect(canUserPerform(["viewer"], "submit")).toBe(false);
    });
  });
});
