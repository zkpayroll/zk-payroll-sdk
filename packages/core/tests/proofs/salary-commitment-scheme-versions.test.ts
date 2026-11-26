import {
  SALARY_COMMITMENT_SCHEMES,
  SUPPORTED_SALARY_COMMITMENT_SCHEMES,
  SUPPORTED_SALARY_COMMITMENT_SCHEME_VERSIONS,
  assertSupportedSalaryCommitmentSchemeVersion,
  getSalaryCommitmentSchemeInfo,
  isSupportedSalaryCommitmentScheme,
  isSupportedSalaryCommitmentSchemeVersion,
  validateSalaryCommitmentSchemeVersion,
} from "../../src/proofs/salaryCommitmentSchemeValidation";
import { SalaryCommitmentVersionValidationError } from "../../src/proofs/salaryCommitmentVersionErrors";
import { SalaryCommitmentVersionError } from "../../src/proofs/salaryCommitmentVersionState";

describe("Salary commitment scheme version rejection (#850)", () => {
  describe("supported scheme versions", () => {
    it.each([
      [1, 1, "pedersen"],
      [2, 2, "poseidon"],
      [3, 3, "multi-asset-poseidon"],
      ["v1", 1, "pedersen"],
      ["v2", 2, "poseidon"],
      ["v3", 3, "multi-asset-poseidon"],
      [" 1 ", 1, "pedersen"],
      ["V2", 2, "poseidon"],
      [" V3 ", 3, "multi-asset-poseidon"],
    ])("accepts supported scheme version %p and resolves to %p", (input, expectedVersion, expectedScheme) => {
      const result = validateSalaryCommitmentSchemeVersion(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.version).toBe(expectedVersion);
      }

      const verified = assertSupportedSalaryCommitmentSchemeVersion(input);
      expect(verified).toBe(expectedVersion);

      const info = getSalaryCommitmentSchemeInfo(input);
      expect(info.version).toBe(expectedVersion);
      expect(info.scheme).toBe(expectedScheme);
    });

    it("verifies supported scheme constants", () => {
      expect(SUPPORTED_SALARY_COMMITMENT_SCHEME_VERSIONS).toEqual([1, 2, 3]);
      expect(SUPPORTED_SALARY_COMMITMENT_SCHEMES).toEqual([
        "pedersen",
        "poseidon",
        "multi-asset-poseidon",
      ]);
      expect(isSupportedSalaryCommitmentScheme("pedersen")).toBe(true);
      expect(isSupportedSalaryCommitmentScheme("POSEIDON")).toBe(true);
      expect(isSupportedSalaryCommitmentScheme("multi-asset-poseidon")).toBe(true);
      expect(isSupportedSalaryCommitmentScheme("unsupported-scheme")).toBe(false);
    });
  });

  describe("rejection of unsupported scheme versions", () => {
    it.each([
      [0, "UNSUPPORTED"],
      [4, "UNSUPPORTED"],
      [-1, "UNSUPPORTED"],
      [99, "UNSUPPORTED"],
      ["v0", "UNSUPPORTED"],
      ["v4", "UNSUPPORTED"],
      ["v10", "UNSUPPORTED"],
      ["invalid", "UNSUPPORTED"],
      [undefined, "HEADER_MISSING"],
      [null, "HEADER_MISSING"],
      ["", "HEADER_MISSING"],
      ["   ", "HEADER_MISSING"],
      [1.5, "TYPE_INVALID"],
      [true, "TYPE_INVALID"],
      [{}, "TYPE_INVALID"],
      [[], "TYPE_INVALID"],
    ])("rejects unsupported/invalid scheme version %p with issue code %s", (input, expectedIssueCode) => {
      const result = validateSalaryCommitmentSchemeVersion(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues[0].code).toBe(expectedIssueCode);
      }

      expect(() => assertSupportedSalaryCommitmentSchemeVersion(input)).toThrow(
        SalaryCommitmentVersionValidationError
      );
    });

    it("throws typed SalaryCommitmentVersionError from getSalaryCommitmentSchemeInfo on unsupported version", () => {
      expect(() => getSalaryCommitmentSchemeInfo(4)).toThrow(SalaryCommitmentVersionError);
      try {
        getSalaryCommitmentSchemeInfo(4);
      } catch (error) {
        expect(error).toBeInstanceOf(SalaryCommitmentVersionError);
        expect((error as SalaryCommitmentVersionError).versionCode).toBe(
          "SALARY_COMMITMENT_VERSION_UNSUPPORTED"
        );
      }
    });
  });

  describe("boundary cases and constraints", () => {
    it("enforces expected version constraint when specified", () => {
      // Correct version matching expected
      const okResult = validateSalaryCommitmentSchemeVersion(2, 2);
      expect(okResult.ok).toBe(true);

      // Version mismatch
      const mismatchResult = validateSalaryCommitmentSchemeVersion(1, 2);
      expect(mismatchResult.ok).toBe(false);
      if (!mismatchResult.ok) {
        expect(mismatchResult.issues[0].code).toBe("MISMATCH");
      }

      expect(() => assertSupportedSalaryCommitmentSchemeVersion(1, 2)).toThrow(
        SalaryCommitmentVersionValidationError
      );
    });

    it("isSupportedSalaryCommitmentSchemeVersion strictly checks integer numbers", () => {
      expect(isSupportedSalaryCommitmentSchemeVersion(1)).toBe(true);
      expect(isSupportedSalaryCommitmentSchemeVersion(2)).toBe(true);
      expect(isSupportedSalaryCommitmentSchemeVersion(3)).toBe(true);
      expect(isSupportedSalaryCommitmentSchemeVersion(0)).toBe(false);
      expect(isSupportedSalaryCommitmentSchemeVersion(4)).toBe(false);
      expect(isSupportedSalaryCommitmentSchemeVersion(1.0001)).toBe(false);
      expect(isSupportedSalaryCommitmentSchemeVersion("1")).toBe(false);
      expect(isSupportedSalaryCommitmentSchemeVersion(null)).toBe(false);
    });
  });

  describe("privacy preservation", () => {
    it("does not leak salary or employee data in rejection errors", () => {
      const sensitiveContext = {
        salary: "5000000000",
        employeeId: "GABC1234SECRET",
        blinder: "secret_blinder_999",
      };

      try {
        assertSupportedSalaryCommitmentSchemeVersion(999);
        fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as SalaryCommitmentVersionValidationError;
        expect(error.name).toBe("SalaryCommitmentVersionValidationError");
        expect(error.message).not.toContain("5000000000");
        expect(error.message).not.toContain("GABC1234SECRET");
        expect(error.message).not.toContain("secret_blinder_999");
        expect(JSON.stringify(error.context)).not.toContain("5000000000");
        expect(JSON.stringify(error.context)).not.toContain("GABC1234SECRET");
      }
    });
  });
});
