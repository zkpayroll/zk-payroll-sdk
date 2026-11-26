import { EmployerRoleStateManager } from "../../src/access/employerRoleState";
import {
  EmployerRoleOwnershipVerificationError,
  assertActiveEmployerRoleOwnership,
  refreshEmployerRoleOwnership,
} from "../../src/verification/employerRoleOwnership";

describe("Employer role ownership pre-submission refresh (#851)", () => {
  const scopeId = "org-test-scope";
  const employer = "GBZXN7PIRZGNMHGA72XZBTWNTVANANCGICPOZS5JUU5PNO773VO4Q2L7";
  const operator = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
  const unassigned = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  let stateManager: EmployerRoleStateManager;

  beforeEach(() => {
    stateManager = new EmployerRoleStateManager();
    stateManager.grantRole({
      changeId: "grant-admin-01",
      employer,
      targetAccount: employer,
      role: "EMPLOYER_ADMIN",
      scopeId,
    });
    stateManager.grantRole({
      changeId: "grant-operator-01",
      employer,
      targetAccount: operator,
      role: "PAYROLL_OPERATOR",
      scopeId,
      expiresAt: Date.now() + 3600_000, // 1 hour in future
    });
  });

  describe("active role verification", () => {
    it("successfully verifies active PAYROLL_OPERATOR role", async () => {
      const result = await refreshEmployerRoleOwnership({
        account: operator,
        scopeId,
        resolver: stateManager,
      });

      expect(result.ok).toBe(true);
      expect(result.activeRoles).toContain("PAYROLL_OPERATOR");
      expect(result.record).toBeDefined();
      expect(result.record?.targetAccount).toBe(operator);

      const assertion = await assertActiveEmployerRoleOwnership({
        account: operator,
        scopeId,
        resolver: stateManager,
      });
      expect(assertion.ok).toBe(true);
    });

    it("successfully verifies active EMPLOYER_ADMIN role", async () => {
      const result = await refreshEmployerRoleOwnership({
        account: employer,
        scopeId,
        resolver: stateManager,
      });

      expect(result.ok).toBe(true);
      expect(result.activeRoles).toContain("EMPLOYER_ADMIN");
    });
  });

  describe("rejection and revocation", () => {
    it("rejects when role grant has expired", async () => {
      const pastTime = Date.now() + 7200_000; // 2 hours in future, after grant expires
      const result = await refreshEmployerRoleOwnership({
        account: operator,
        scopeId,
        resolver: stateManager,
        now: pastTime,
      });

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("EXPIRED_ROLE_GRANT");

      await expect(
        assertActiveEmployerRoleOwnership({
          account: operator,
          scopeId,
          resolver: stateManager,
          now: pastTime,
        })
      ).rejects.toThrow(EmployerRoleOwnershipVerificationError);
    });

    it("rejects when role was revoked", async () => {
      stateManager.revokeRole({
        changeId: "revoke-operator-01",
        employer,
        targetAccount: operator,
        role: "PAYROLL_OPERATOR",
        scopeId,
      });

      const result = await refreshEmployerRoleOwnership({
        account: operator,
        scopeId,
        resolver: stateManager,
      });

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("ROLE_NOT_ASSIGNED");

      await expect(
        assertActiveEmployerRoleOwnership({
          account: operator,
          scopeId,
          resolver: stateManager,
        })
      ).rejects.toThrow(EmployerRoleOwnershipVerificationError);
    });

    it("rejects an unassigned account", async () => {
      const result = await refreshEmployerRoleOwnership({
        account: unassigned,
        scopeId,
        resolver: stateManager,
      });

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("UNAUTHORIZED_ROLE_CHANGE");
    });

    it("rejects an account that holds AUDITOR but not PAYROLL_OPERATOR", async () => {
      const auditor = "GB3277ISCSWYGH72LMWY6TTRGNYM6V3EN7WSHHTF55SCLZ73U3GGLV26";
      stateManager.grantRole({
        changeId: "grant-auditor-01",
        employer,
        targetAccount: auditor,
        role: "AUDITOR",
        scopeId,
      });

      const result = await refreshEmployerRoleOwnership({
        account: auditor,
        scopeId,
        resolver: stateManager,
        requiredRole: "PAYROLL_OPERATOR",
      });

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("UNAUTHORIZED_ROLE_CHANGE");
    });
  });

  describe("custom async resolver", () => {
    it("refreshes role dynamically via async callback resolver", async () => {
      let isAllowed = true;
      const customResolver = async (account: string) => {
        if (!isAllowed) return [];
        return account === operator ? (["PAYROLL_OPERATOR"] as const) : [];
      };

      const result1 = await refreshEmployerRoleOwnership({
        account: operator,
        resolver: customResolver,
      });
      expect(result1.ok).toBe(true);

      // Now revoke dynamically
      isAllowed = false;
      const result2 = await refreshEmployerRoleOwnership({
        account: operator,
        resolver: customResolver,
      });
      expect(result2.ok).toBe(false);
      expect(result2.errorCode).toBe("ROLE_NOT_ASSIGNED");
    });
  });

  describe("privacy preservation", () => {
    it("never includes salary, employee, or sensitive data in verification errors", async () => {
      try {
        await assertActiveEmployerRoleOwnership({
          account: unassigned,
          scopeId,
          resolver: stateManager,
        });
        fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as EmployerRoleOwnershipVerificationError;
        expect(error.name).toBe("EmployerRoleOwnershipVerificationError");
        expect(error.message).not.toMatch(/salary|amount|witness|preimage/i);
        expect(JSON.stringify(error.context)).not.toMatch(/salary|amount|witness|preimage/i);
      }
    });
  });
});
