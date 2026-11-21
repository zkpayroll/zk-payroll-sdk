/**
 * Unit and boundary tests for employer role changes (#886).
 *
 * Covers success cases, failure cases, boundary constraints,
 * and privacy-safe error handling.
 */

import {
  validateEmployerRoleChange,
  assertValidEmployerRoleChange,
  EmployerRoleError,
  EmployerRoleChangeInput,
} from "../../src/access";

const VALID_EMPLOYER = "GBZXN7PIRZGNMHGA72XZBTWNTVANANCGICPOZS5JUU5PNO773VO4Q2L7";
const VALID_TARGET = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const CONFIDENTIAL_DATA = "SensitiveCompany$500kSalarySecret";

describe("Employer Role Changes (#884, #885, #886)", () => {
  const now = 1_700_000_000_000;

  describe("Validation Success Cases", () => {
    it("validates a legitimate role grant", () => {
      const input: EmployerRoleChangeInput = {
        employer: VALID_EMPLOYER,
        targetAccount: VALID_TARGET,
        role: "PAYROLL_OPERATOR",
        action: "GRANT",
        effectiveAt: now,
        expiresAt: now + 3600 * 1000,
        existingRoles: [],
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(() => assertValidEmployerRoleChange(input, now)).not.toThrow();
    });

    it("validates a legitimate role revocation", () => {
      const input: EmployerRoleChangeInput = {
        employer: VALID_EMPLOYER,
        targetAccount: VALID_TARGET,
        role: "AUDITOR",
        action: "REVOKE",
        existingRoles: ["AUDITOR"],
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(true);
    });

    it("validates role transfer to another account", () => {
      const input: EmployerRoleChangeInput = {
        employer: VALID_EMPLOYER,
        targetAccount: VALID_TARGET,
        role: "EMPLOYER_ADMIN",
        action: "TRANSFER",
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(true);
    });
  });

  describe("Boundary & Failure Cases (#886)", () => {
    it("rejects invalid Stellar address length (55 characters)", () => {
      const shortAddr = VALID_EMPLOYER.slice(0, 55);
      const input: EmployerRoleChangeInput = {
        employer: shortAddr,
        targetAccount: VALID_TARGET,
        role: "SIGNER",
        action: "GRANT",
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("INVALID_EMPLOYER_ADDRESS");
    });

    it("rejects target address with non-base32 character", () => {
      const invalidTarget = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVS08"; // '0' and '8' invalid in RFC 4648 base32
      const input: EmployerRoleChangeInput = {
        employer: VALID_EMPLOYER,
        targetAccount: invalidTarget,
        role: "SIGNER",
        action: "GRANT",
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("INVALID_TARGET_ADDRESS");
    });

    it("prevents self-admin revocation without successor", () => {
      const input: EmployerRoleChangeInput = {
        employer: VALID_EMPLOYER,
        targetAccount: VALID_EMPLOYER,
        role: "EMPLOYER_ADMIN",
        action: "REVOKE",
        currentAdmin: VALID_EMPLOYER,
        existingRoles: ["EMPLOYER_ADMIN"],
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === "CANNOT_MODIFY_OWN_ADMIN")).toBe(true);
    });

    it("rejects grant when role is already assigned", () => {
      const input: EmployerRoleChangeInput = {
        employer: VALID_EMPLOYER,
        targetAccount: VALID_TARGET,
        role: "PAYROLL_OPERATOR",
        action: "GRANT",
        existingRoles: ["PAYROLL_OPERATOR"],
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("ROLE_ALREADY_ASSIGNED");
    });

    it("rejects revoke when role is not assigned", () => {
      const input: EmployerRoleChangeInput = {
        employer: VALID_EMPLOYER,
        targetAccount: VALID_TARGET,
        role: "SIGNER",
        action: "REVOKE",
        existingRoles: ["AUDITOR"],
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("ROLE_NOT_ASSIGNED");
    });

    it("rejects expiresAt equal to or before effectiveAt", () => {
      const input: EmployerRoleChangeInput = {
        employer: VALID_EMPLOYER,
        targetAccount: VALID_TARGET,
        role: "AUDITOR",
        action: "GRANT",
        effectiveAt: now,
        expiresAt: now, // boundary: equal
      };

      const result = validateEmployerRoleChange(input, now);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("EXPIRED_ROLE_GRANT");
    });

    it("guarantees error message never leaks sensitive data (#885)", () => {
      try {
        assertValidEmployerRoleChange({
          employer: "invalid",
          targetAccount: VALID_TARGET,
          role: "AUDITOR",
          action: "GRANT",
          // Inject dummy sensitive context
          ...({ note: CONFIDENTIAL_DATA } as any),
        });
      } catch (err) {
        expect(err).toBeInstanceOf(EmployerRoleError);
        const error = err as EmployerRoleError;
        expect(error.message).not.toContain(CONFIDENTIAL_DATA);
        expect(JSON.stringify(error.issues)).not.toContain(CONFIDENTIAL_DATA);
      }
    });
  });
});
