import {
  SalaryCommitmentVersionErrorCode,
  SalaryCommitmentVersionStateManager,
} from "../../src/proofs/salaryCommitmentVersionState";
import {
  SalaryCommitmentVersionIssueCode,
  SalaryCommitmentVersionValidationError,
  formatSafeSalaryCommitmentVersionIssue,
} from "../../src/proofs/salaryCommitmentVersionErrors";
import {
  assertValidSalaryCommitmentVersion,
  assertValidWitnessCommitmentVersion,
  validateSalaryCommitmentVersion,
  validateWitnessCommitmentVersion,
} from "../../src/proofs/salaryCommitmentVersionValidation";

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const NULLIFIER = "d".repeat(64);
const PRIVATE_VALUE = "EMPLOYEE_SALARY_5000_PREIMAGE";

function expectVersionCode(code: SalaryCommitmentVersionErrorCode): RegExp {
  return new RegExp(code);
}

describe("Salary commitment version boundaries (#889, #890, #891)", () => {
  describe("typed validation boundaries", () => {
    it.each([
      [1, 1],
      [2, 2],
      [3, 3],
      ["v1", 1],
      [" V2 ", 2],
      ["V3", 3],
    ])("accepts supported header %p", (value, expected) => {
      const result = validateSalaryCommitmentVersion(value, expected as 1 | 2 | 3);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.version).toBe(expected);
      expect(result.issues).toHaveLength(0);
    });

    it.each([
      [undefined, "HEADER_MISSING"],
      [null, "HEADER_MISSING"],
      ["", "HEADER_MISSING"],
      [1.5, "TYPE_INVALID"],
      [true, "TYPE_INVALID"],
      [[], "TYPE_INVALID"],
      [{}, "TYPE_INVALID"],
      [0, "UNSUPPORTED"],
      [4, "UNSUPPORTED"],
      [-1, "UNSUPPORTED"],
      ["v4", "UNSUPPORTED"],
      ["01", "UNSUPPORTED"],
    ])("rejects header %p with code %s", (value, code) => {
      const result = validateSalaryCommitmentVersion(value);
      expect(result.ok).toBe(false);
      expect(result.issues[0].code).toBe(code);
      expect(JSON.stringify(result.issues)).not.toContain(PRIVATE_VALUE);
    });

    it("reports a mismatch against the active snapshot version", () => {
      const result = validateSalaryCommitmentVersion("V3", 1);
      expect(result.ok).toBe(false);
      expect(result.issues[0].code).toBe("MISMATCH");
      expect(result.issues[0].field).toBe("commitmentVersion");
    });

    it("validates witness objects without reading untrusted values into issues", () => {
      expect(validateWitnessCommitmentVersion(null).issues[0].code).toBe("HEADER_MISSING");
      expect(validateWitnessCommitmentVersion([]).issues[0].code).toBe("HEADER_MISSING");
      expect(validateWitnessCommitmentVersion({ amount: "100" }).issues[0].code).toBe(
        "HEADER_MISSING"
      );
      expect(validateWitnessCommitmentVersion({ commitmentVersion: 2 }, 2).ok).toBe(true);
      expect(
        validateWitnessCommitmentVersion({ commitmentVersion: PRIVATE_VALUE }, 2).issues[0].code
      ).toBe("UNSUPPORTED");
    });
  });

  describe("safe error exposure", () => {
    it("maps each issue to a stable safe error code", () => {
      const cases: ReadonlyArray<
        [SalaryCommitmentVersionIssueCode, SalaryCommitmentVersionErrorCode]
      > = [
        ["HEADER_MISSING", SalaryCommitmentVersionErrorCode.VERSION_HEADER_MISSING],
        ["TYPE_INVALID", SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION],
        ["UNSUPPORTED", SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION],
        ["MISMATCH", SalaryCommitmentVersionErrorCode.VERSION_MISMATCH],
      ];
      for (const [issueCode, errorCode] of cases) {
        const issue = formatSafeSalaryCommitmentVersionIssue(issueCode, "commitmentVersion");
        expect(issue.message).not.toContain(PRIVATE_VALUE);
        expect(() =>
          assertValidSalaryCommitmentVersion(undefined, undefined, "commitmentVersion")
        ).toThrow();
        try {
          throw new SalaryCommitmentVersionValidationError([issue], {
            field: "commitmentVersion",
            employeeSalary: PRIVATE_VALUE,
            commitmentDigest: DIGEST,
            nullifierDigest: NULLIFIER,
          });
        } catch (error) {
          const typed = error as SalaryCommitmentVersionValidationError;
          expect(typed.versionCode).toBe(errorCode);
          expect(typed.issues).toEqual([issue]);
          expect(Object.isFrozen(typed.issues)).toBe(true);
          expect(typed.message).not.toContain(PRIVATE_VALUE);
          expect(JSON.stringify(typed.context)).not.toContain(PRIVATE_VALUE);
          expect(JSON.stringify(typed.context)).not.toContain(DIGEST);
          expect(JSON.stringify(typed.context)).not.toContain(NULLIFIER);
        }
      }
    });

    it("throws safe typed errors from assertion helpers", () => {
      expect(() => assertValidSalaryCommitmentVersion(4, 2)).toThrow(
        expectVersionCode(SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION)
      );
      expect(() => assertValidSalaryCommitmentVersion(1, 2)).toThrow(
        expectVersionCode(SalaryCommitmentVersionErrorCode.VERSION_MISMATCH)
      );
      expect(() => assertValidWitnessCommitmentVersion({}, 2)).toThrow(
        SalaryCommitmentVersionValidationError
      );
      expect(assertValidWitnessCommitmentVersion({ commitmentVersion: "v2" }, 2)).toBe(2);
      expect(() => assertValidSalaryCommitmentVersion(PRIVATE_VALUE)).toThrow(
        expectVersionCode(SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION)
      );
      try {
        assertValidSalaryCommitmentVersion(PRIVATE_VALUE);
      } catch (error) {
        expect(JSON.stringify(error)).not.toContain(PRIVATE_VALUE);
      }
    });
  });

  describe("snapshot state boundaries", () => {
    it("accepts exact 32-byte digests and rejects off-by-one lengths", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      const registered = manager.registerSnapshot({
        snapshotId: "boundary_exact",
        scopeId: "scope_exact",
        commitmentVersion: 3,
        commitmentDigest: `0X${DIGEST.toUpperCase()}`,
        now: 1000,
      });
      expect(registered.commitmentDigest).toBe(DIGEST);
      expect(() =>
        manager.registerSnapshot({
          snapshotId: "short_digest",
          scopeId: "scope_short",
          commitmentVersion: 1,
          commitmentDigest: DIGEST.slice(0, 63),
        })
      ).toThrow(expectVersionCode(SalaryCommitmentVersionErrorCode.INVALID_DIGEST));
      expect(() =>
        manager.registerSnapshot({
          snapshotId: "long_digest",
          scopeId: "scope_long",
          commitmentVersion: 1,
          commitmentDigest: `${DIGEST}0`,
        })
      ).toThrow(expectVersionCode(SalaryCommitmentVersionErrorCode.INVALID_DIGEST));
    });

    it("enforces revision boundaries and single-use nullifiers", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      manager.registerSnapshot({
        snapshotId: "boundary_revision",
        scopeId: "scope_revision",
        commitmentVersion: 1,
        commitmentDigest: DIGEST,
        nullifierDigest: NULLIFIER,
        now: 1000,
      });
      expect(() =>
        manager.assertWitnessVersion({
          scopeId: "scope_revision",
          commitmentVersion: 1,
          expectedRevision: 0,
        })
      ).toThrow(expectVersionCode(SalaryCommitmentVersionErrorCode.STALE_REVISION));
      expect(
        manager.assertWitnessVersion({
          scopeId: "scope_revision",
          commitmentVersion: "V1",
          expectedRevision: 1,
        }).snapshotId
      ).toBe("boundary_revision");

      manager.registerSnapshot({
        snapshotId: "boundary_next",
        scopeId: "scope_revision",
        commitmentVersion: 2,
        commitmentDigest: OTHER_DIGEST,
        now: 2000,
      });
      expect(() =>
        manager.registerSnapshot({
          snapshotId: "boundary_reuse",
          scopeId: "scope_other",
          commitmentVersion: 3,
          commitmentDigest: OTHER_DIGEST,
          nullifierDigest: NULLIFIER,
        })
      ).toThrow(expectVersionCode(SalaryCommitmentVersionErrorCode.NULLIFIER_REUSE));
    });

    it("fails closed at the retired-state boundary", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      manager.registerSnapshot({
        snapshotId: "boundary_retire",
        scopeId: "scope_retire",
        commitmentVersion: 3,
        commitmentDigest: DIGEST,
        now: 1000,
      });
      const retired = manager.retireSnapshot("scope_retire", 1);
      expect(retired.status).toBe("RETIRED");
      expect(() =>
        manager.assertWitnessVersion({ scopeId: "scope_retire", commitmentVersion: 3 })
      ).toThrow(expectVersionCode(SalaryCommitmentVersionErrorCode.SNAPSHOT_NOT_FOUND));
      expect(() =>
        manager.registerSnapshot({
          snapshotId: "boundary_downgrade",
          scopeId: "scope_retire",
          commitmentVersion: 2,
          commitmentDigest: OTHER_DIGEST,
        })
      ).not.toThrow();
    });
  });
});
