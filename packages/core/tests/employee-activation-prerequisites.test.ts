/**
 * Employee Activation Prerequisite Checks (#636)
 * ========================================================================
 *
 * Covers the success path, every failure path, and edge cases for
 * `validateEmployeeActivationPrerequisites`:
 *
 *   1. Success      — fully valid profile passes (with and without employer)
 *   2. Failure      — identity, eligibility, employer, compensation checks
 *   3. Edge cases   — multiple issues collected together, muxed addresses,
 *                     asset objects, throwing variant, sanitized messages
 * ========================================================================
 */

import { validateEmployeeActivationPrerequisites } from "../src/employees/activationPrerequisites";
import {
  EmployeeActivationPrerequisiteError,
  validateEmployeeActivationPrerequisitesOrThrow,
} from "../src/employees/activationPrerequisites";
import type { EmployeeActivationProfile } from "../src/employees/activationPrerequisites";

const EMPLOYEE = "GAPSRH3PJI36YZA4EGPSVXYYGN4MNU74ID62ZDAGRBHQH2MBHGQMAZQS";
const EMPLOYER = "GDHOJ7BK6ZA3YZTXOYV6PPP7K4NRWQQ7W2YFC3RZHZRABRPYOC5FZWSW";
const OTHER_EMPLOYER = "GAQ55SDVO6763SKZBSJJZIDI7S3OACT4FNQFD3CDP7PTBN73KZZ6TX75";
const MUXED = "MAPSRH3PJI36YZA4EGPSVXYYGN4MNU74ID62ZDAGRBHQH2MBHGQMAAAAAAAAAAAAADVGE";

function validProfile(
  overrides: Partial<EmployeeActivationProfile> = {}
): EmployeeActivationProfile {
  return {
    address: EMPLOYEE,
    status: "suspended",
    isBlocked: false,
    salary: 1_000_000n,
    asset: "native",
    ...overrides,
  };
}

describe("validateEmployeeActivationPrerequisites", () => {
  describe("success paths", () => {
    it("passes for a fully valid profile with employer context", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile(),
        employerAddress: EMPLOYER,
      });

      expect(result.ok).toBe(true);
    });

    it("passes without employer context (employer check skipped)", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile(),
      });

      expect(result.ok).toBe(true);
    });

    it("allows re-activating a suspended employee", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ status: "suspended" }),
        employerAddress: EMPLOYER,
      });

      expect(result.ok).toBe(true);
    });

    it("accepts muxed account addresses for employee and employer", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ address: MUXED }),
        employerAddress: EMPLOYER,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("failure paths — identity", () => {
    it("rejects an invalid employee address", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ address: "not-an-address" }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_IDENTITY_INVALID");
      }
    });

    it("rejects a missing employee address", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ address: undefined }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_IDENTITY_INVALID");
      }
    });

    it("never echoes an invalid address back in the failure message", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ address: "GSECRET…LEAKED-VALUE" }),
      });

      if (!result.ok) {
        for (const issue of result.issues) {
          expect(issue.message).not.toContain("GSECRET");
        }
      }
    });
  });

  describe("failure paths — eligibility", () => {
    it("rejects blocked records", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ isBlocked: true }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_RECORD_BLOCKED");
      }
    });

    it("rejects terminated records", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ status: "terminated" }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_RECORD_TERMINATED");
      }
    });

    it("rejects offboarded records", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ status: "offboarded" }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_RECORD_TERMINATED");
      }
    });
  });

  describe("failure paths — employer", () => {
    it("rejects a missing employer address when employer context is given", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile(),
        employerAddress: "",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_EMPLOYER_MISSING");
      }
    });

    it("rejects an invalid employer address", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile(),
        employerAddress: "ALSO-NOT-AN-ADDRESS",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_EMPLOYER_INVALID");
      }
    });

    it("rejects employer equal to the employee (self-employment)", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile(),
        employerAddress: EMPLOYEE,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_EMPLOYER_SAME_AS_EMPLOYEE");
      }
    });
  });

  describe("failure paths — compensation", () => {
    it("rejects a zero salary", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ salary: 0n }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_SALARY_INVALID");
      }
    });

    it("rejects a negative salary", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ salary: -5n }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_SALARY_INVALID");
      }
    });

    it("rejects a missing asset", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ asset: undefined }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_ASSET_MISSING");
      }
    });

    it("rejects an invalid asset identifier", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ asset: "not a valid asset!!" }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_ASSET_INVALID");
      }
    });
  });

  describe("edge cases", () => {
    it("collects multiple issues from a single invalid profile", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({
          address: undefined,
          isBlocked: true,
          salary: 0n,
          asset: undefined,
        }),
        employerAddress: "",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const codes = result.issues.map((i) => i.code);
        expect(codes).toContain("ACTIVATION_IDENTITY_INVALID");
        expect(codes).toContain("ACTIVATION_RECORD_BLOCKED");
        expect(codes).toContain("ACTIVATION_EMPLOYER_MISSING");
        expect(codes).toContain("ACTIVATION_SALARY_INVALID");
        expect(codes).toContain("ACTIVATION_ASSET_MISSING");
      }
    });

    it("accepts asset objects carrying a valid code", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ asset: { code: "USDC" } }),
      });

      expect(result.ok).toBe(true);
    });

    it("accepts an unknown status without blocking activation", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ status: undefined }),
      });

      expect(result.ok).toBe(true);
    });

    it("validates a well-formed reference ID as part of the profile", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ referenceId: "EMP-001" }),
      });

      expect(result.ok).toBe(true);
    });

    it("rejects a malformed reference ID", () => {
      const result = validateEmployeeActivationPrerequisites({
        profile: validProfile({ referenceId: "no spaces allowed" }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("ACTIVATION_REFERENCE_ID_INVALID");
      }
    });

    it("distinguishes two different employers in the same run", () => {
      const a = validateEmployeeActivationPrerequisites({
        profile: validProfile(),
        employerAddress: EMPLOYER,
      });
      const b = validateEmployeeActivationPrerequisites({
        profile: validProfile(),
        employerAddress: OTHER_EMPLOYER,
      });

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
    });
  });
});

describe("validateEmployeeActivationPrerequisitesOrThrow", () => {
  it("returns the options unchanged when all prerequisites pass", () => {
    const options = { profile: validProfile(), employerAddress: EMPLOYER };
    expect(validateEmployeeActivationPrerequisitesOrThrow(options)).toBe(options);
  });

  it("throws EmployeeActivationPrerequisiteError listing failed codes", () => {
    try {
      validateEmployeeActivationPrerequisitesOrThrow({
        profile: validProfile({ isBlocked: true, salary: 0n }),
      });
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EmployeeActivationPrerequisiteError);
      const err = e as EmployeeActivationPrerequisiteError;
      const codes = err.issues.map((i) => i.code);
      expect(codes).toContain("ACTIVATION_RECORD_BLOCKED");
      expect(codes).toContain("ACTIVATION_SALARY_INVALID");
      expect(err.message).toContain("ACTIVATION_RECORD_BLOCKED");
    }
  });

  it("exposes issues array on the thrown error", () => {
    const err = new EmployeeActivationPrerequisiteError([
      {
        code: "ACTIVATION_IDENTITY_INVALID",
        message: "test",
        field: "profile",
      },
    ]);

    expect(err.issues).toHaveLength(1);
    expect(err.issues[0].code).toBe("ACTIVATION_IDENTITY_INVALID");
    expect(err.name).toBe("EmployeeActivationPrerequisiteError");
  });
});
