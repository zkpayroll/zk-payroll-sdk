import { createHash } from "crypto";
import {
  createProofInputSession,
  transitionToValidating,
  transitionToValidated,
  verifyProofInputSessionIntegrity,
} from "../../src/proofs/proofInputState";
import {
  ALLOWED_SALARY_COMMITMENT_VERSION_UPGRADES,
  LATEST_SALARY_COMMITMENT_VERSION,
  SalaryCommitmentVersionError,
  SalaryCommitmentVersionErrorCode,
  SalaryCommitmentVersionSnapshot,
  SalaryCommitmentVersionStateManager,
  assertSalaryCommitmentVersionMatches,
  assertWitnessCommitmentVersion,
  isSupportedSalaryCommitmentVersion,
  parseSalaryCommitmentVersion,
  verifySalaryCommitmentVersionSnapshotIntegrity,
} from "../../src/proofs/salaryCommitmentVersionState";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const NULLIFIER_A = "d".repeat(64);
const NULLIFIER_B = "e".repeat(64);
const RAW_SALARY = "SALARY_5000_EMPLOYEE_SECRET";

function expectVersionError(code: SalaryCommitmentVersionErrorCode): RegExp {
  return new RegExp(code);
}

describe("Salary Commitment Version State Handling (#893)", () => {
  describe("version header parsing boundaries", () => {
    it("accepts numeric versions and normalized string headers", () => {
      expect(parseSalaryCommitmentVersion(1)).toBe(1);
      expect(parseSalaryCommitmentVersion(2)).toBe(2);
      expect(parseSalaryCommitmentVersion("v3")).toBe(3);
      expect(parseSalaryCommitmentVersion(" V2 ")).toBe(2);
      expect(isSupportedSalaryCommitmentVersion(3)).toBe(true);
      expect(isSupportedSalaryCommitmentVersion("3")).toBe(false);
      expect(LATEST_SALARY_COMMITMENT_VERSION).toBe(3);
      expect(ALLOWED_SALARY_COMMITMENT_VERSION_UPGRADES[1]).toEqual([1, 2, 3]);
    });

    it.each([0, 4, 1.5, -1, "v4", "", "abc", null, undefined, {}])(
      "fails closed for unsupported header %p without echoing private data",
      (value) => {
        expect(() => parseSalaryCommitmentVersion(value)).toThrow(
          expectVersionError(SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION)
        );
        try {
          parseSalaryCommitmentVersion(value);
        } catch (error) {
          const typed = error as SalaryCommitmentVersionError;
          expect(typed.versionCode).toBe(SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION);
          expect(typed.message).not.toContain(RAW_SALARY);
          expect(JSON.stringify(typed.context)).not.toContain(RAW_SALARY);
        }
      }
    );

    it("rejects a witness with a missing or mismatched version header", () => {
      expect(() => assertWitnessCommitmentVersion({}, 2)).toThrow(
        expectVersionError(SalaryCommitmentVersionErrorCode.VERSION_HEADER_MISSING)
      );
      expect(() => assertWitnessCommitmentVersion({ commitmentVersion: 1 }, 2)).toThrow(
        expectVersionError(SalaryCommitmentVersionErrorCode.VERSION_MISMATCH)
      );
      expect(() => assertSalaryCommitmentVersionMatches("v2", 2)).not.toThrow();
    });
  });

  describe("snapshot registration and integrity", () => {
    it("registers an immutable active snapshot and is idempotent", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      const snapshot = manager.registerSnapshot({
        snapshotId: "snap_1",
        scopeId: "run_1",
        commitmentVersion: 1,
        commitmentDigest: `0x${DIGEST_A.toUpperCase()}`,
        nullifierDigest: NULLIFIER_A,
        now: 1000,
      });

      expect(snapshot.status).toBe("ACTIVE");
      expect(snapshot.revision).toBe(1);
      expect(snapshot.commitmentDigest).toBe(DIGEST_A);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(verifySalaryCommitmentVersionSnapshotIntegrity(snapshot)).toBe(true);
      expect(manager.verifyIntegrity("snap_1")).toBe(true);
      expect(manager.getActiveVersion("run_1")).toBe(1);
      expect(
        manager.registerSnapshot({
          snapshotId: "snap_1",
          scopeId: "run_1",
          commitmentVersion: "v1",
          commitmentDigest: DIGEST_A,
          nullifierDigest: NULLIFIER_A,
          expectedRevision: 1,
        })
      ).toEqual(snapshot);
    });

    it("detects tampered snapshot state", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      const snapshot = manager.registerSnapshot({
        snapshotId: "snap_tamper",
        scopeId: "run_tamper",
        commitmentVersion: 2,
        commitmentDigest: DIGEST_A,
        now: 1000,
      });
      const tampered = { ...snapshot, commitmentVersion: 3 } as SalaryCommitmentVersionSnapshot;
      expect(verifySalaryCommitmentVersionSnapshotIntegrity(tampered)).toBe(false);

      const internal = manager as unknown as {
        snapshots: Map<string, SalaryCommitmentVersionSnapshot>;
      };
      internal.snapshots.set("snap_tamper", tampered);
      expect(manager.verifyIntegrity("snap_tamper")).toBe(false);
      expect(() =>
        manager.assertWitnessVersion({
          scopeId: "run_tamper",
          commitmentVersion: 2,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.STATE_INTEGRITY_COMPROMISED));
    });

    it("rejects invalid identifiers and digests without leaking raw preimage values", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      const invalidInputs = [
        { snapshotId: "  ", scopeId: "run_1", commitmentVersion: 1, commitmentDigest: DIGEST_A },
        { snapshotId: "snap_2", scopeId: "", commitmentVersion: 1, commitmentDigest: DIGEST_A },
        {
          snapshotId: "snap_3",
          scopeId: "run_1",
          commitmentVersion: 1,
          commitmentDigest: RAW_SALARY,
        },
        {
          snapshotId: "snap_4",
          scopeId: "run_1",
          commitmentVersion: 1,
          commitmentDigest: "abc123",
        },
        {
          snapshotId: "snap_5",
          scopeId: "run_1",
          commitmentVersion: 1,
          commitmentDigest: DIGEST_A,
          nullifierDigest: RAW_SALARY,
        },
      ];

      for (const input of invalidInputs) {
        try {
          manager.registerSnapshot(input);
          throw new Error("Expected registerSnapshot to fail");
        } catch (error) {
          expect(error).toBeInstanceOf(SalaryCommitmentVersionError);
          const typed = error as SalaryCommitmentVersionError;
          expect([
            SalaryCommitmentVersionErrorCode.INVALID_IDENTIFIER,
            SalaryCommitmentVersionErrorCode.INVALID_DIGEST,
          ]).toContain(typed.versionCode);
          expect(typed.message).not.toContain(RAW_SALARY);
          expect(JSON.stringify(typed.context)).not.toContain(RAW_SALARY);
        }
      }
    });
  });

  describe("version transitions", () => {
    it("supersedes older versions with a tamper-evident chain", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      const v1 = manager.registerSnapshot({
        snapshotId: "snap_v1",
        scopeId: "payroll_1",
        commitmentVersion: 1,
        commitmentDigest: DIGEST_A,
        now: 1000,
      });
      const v2 = manager.registerSnapshot({
        snapshotId: "snap_v2",
        scopeId: "payroll_1",
        commitmentVersion: "v2",
        commitmentDigest: DIGEST_B,
        now: 2000,
      });
      const v3 = manager.registerSnapshot({
        snapshotId: "snap_v3",
        scopeId: "payroll_1",
        commitmentVersion: 3,
        commitmentDigest: DIGEST_C,
        now: 3000,
      });

      expect(v2.previousHash).toBe(v1.stateHash);
      expect(v3.previousHash).toBe(v2.stateHash);
      expect(manager.getSnapshot("snap_v1")?.status).toBe("SUPERSEDED");
      expect(manager.getSnapshot("snap_v1")?.revision).toBe(2);
      expect(manager.getSnapshot("snap_v2")?.status).toBe("SUPERSEDED");
      expect(manager.getActiveVersion("payroll_1")).toBe(3);
      expect(manager.getActiveSnapshot("payroll_1")?.snapshotId).toBe("snap_v3");
      expect(manager.verifyIntegrity("snap_v1")).toBe(true);
      expect(manager.verifyIntegrity("snap_v2")).toBe(true);
    });

    it("blocks downgrades and same-version digest rewrites", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      manager.registerSnapshot({
        snapshotId: "snap_v3",
        scopeId: "payroll_2",
        commitmentVersion: 3,
        commitmentDigest: DIGEST_C,
      });

      expect(() =>
        manager.registerSnapshot({
          snapshotId: "snap_downgrade",
          scopeId: "payroll_2",
          commitmentVersion: 2,
          commitmentDigest: DIGEST_B,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.VERSION_DOWNGRADE));
      expect(() =>
        manager.registerSnapshot({
          snapshotId: "snap_rewrite",
          scopeId: "payroll_2",
          commitmentVersion: 3,
          commitmentDigest: DIGEST_A,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.DIGEST_MISMATCH));
      expect(manager.getActiveVersion("payroll_2")).toBe(3);
    });

    it("rejects duplicate snapshot identifiers and stale revisions", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      manager.registerSnapshot({
        snapshotId: "snap_dup",
        scopeId: "payroll_3",
        commitmentVersion: 1,
        commitmentDigest: DIGEST_A,
      });
      expect(() =>
        manager.registerSnapshot({
          snapshotId: "snap_dup",
          scopeId: "other_payroll",
          commitmentVersion: 1,
          commitmentDigest: DIGEST_A,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.DUPLICATE_SNAPSHOT));
      expect(() =>
        manager.registerSnapshot({
          snapshotId: "snap_next",
          scopeId: "payroll_3",
          commitmentVersion: 2,
          commitmentDigest: DIGEST_B,
          expectedRevision: 99,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.STALE_REVISION));
    });

    it("enforces single-use nullifiers even across superseded snapshots", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      manager.registerSnapshot({
        snapshotId: "snap_n1",
        scopeId: "payroll_4",
        commitmentVersion: 1,
        commitmentDigest: DIGEST_A,
        nullifierDigest: NULLIFIER_A,
      });
      manager.registerSnapshot({
        snapshotId: "snap_n2",
        scopeId: "payroll_4",
        commitmentVersion: 2,
        commitmentDigest: DIGEST_B,
        nullifierDigest: NULLIFIER_B,
      });

      expect(() =>
        manager.registerSnapshot({
          snapshotId: "snap_n3",
          scopeId: "payroll_5",
          commitmentVersion: 2,
          commitmentDigest: DIGEST_C,
          nullifierDigest: NULLIFIER_A,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.NULLIFIER_REUSE));
    });
  });

  describe("witness version assertions", () => {
    it("asserts the active version, digest, and nullifier before witness compilation", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      manager.registerSnapshot({
        snapshotId: "snap_check",
        scopeId: "payroll_6",
        commitmentVersion: 2,
        commitmentDigest: DIGEST_B,
        nullifierDigest: NULLIFIER_B,
      });

      const snapshot = manager.assertWitnessVersion({
        scopeId: "payroll_6",
        commitmentVersion: "V2",
        commitmentDigest: `0x${DIGEST_B.toUpperCase()}`,
        nullifierDigest: NULLIFIER_B,
        snapshotId: "snap_check",
        expectedRevision: 1,
      });
      expect(snapshot.snapshotId).toBe("snap_check");

      expect(() =>
        manager.assertWitnessVersion({ scopeId: "payroll_6", commitmentVersion: 1 })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.VERSION_MISMATCH));
      expect(() =>
        manager.assertWitnessVersion({
          scopeId: "payroll_6",
          commitmentVersion: 2,
          commitmentDigest: DIGEST_A,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.DIGEST_MISMATCH));
      expect(() =>
        manager.assertWitnessVersion({
          scopeId: "payroll_6",
          commitmentVersion: 2,
          nullifierDigest: DIGEST_A,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.NULLIFIER_REUSE));
      expect(() =>
        manager.assertWitnessVersion({
          scopeId: "payroll_6",
          commitmentVersion: 2,
          snapshotId: "other",
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.SNAPSHOT_NOT_FOUND));
    });

    it("retires a snapshot and blocks further witness assertions", () => {
      const manager = new SalaryCommitmentVersionStateManager();
      manager.registerSnapshot({
        snapshotId: "snap_retire",
        scopeId: "payroll_7",
        commitmentVersion: 3,
        commitmentDigest: DIGEST_C,
      });

      const retired = manager.retireSnapshot("payroll_7", 1);
      expect(retired.status).toBe("RETIRED");
      expect(manager.verifyIntegrity("snap_retire")).toBe(true);
      expect(manager.getActiveSnapshot("payroll_7")).toBeUndefined();
      expect(() =>
        manager.assertWitnessVersion({ scopeId: "payroll_7", commitmentVersion: 3 })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.SNAPSHOT_NOT_FOUND));
      expect(() => manager.retireSnapshot("payroll_7")).toThrow(
        expectVersionError(SalaryCommitmentVersionErrorCode.SNAPSHOT_NOT_FOUND)
      );
    });
  });

  describe("proof input session integration", () => {
    it("keeps legacy session hashes stable", () => {
      const session = createProofInputSession({ sessionId: "legacy", now: 1000 });
      const legacyPayload = [
        "zkpayroll:proof-input-state:v1",
        "legacy",
        "",
        "payroll_batch_v1",
        "unvalidated",
        "1",
        "1000",
        "1000",
        "0",
        "no_witness",
      ].join("|");
      expect(session.stateHash).toBe(createHash("sha256").update(legacyPayload).digest("hex"));
      expect(verifyProofInputSessionIntegrity(session)).toBe(true);
    });

    it("binds version and snapshot to the session and validates witness headers", () => {
      const session = createProofInputSession({
        sessionId: "bound",
        commitmentVersion: "v2",
        commitmentSnapshotId: "snap_check",
        runId: "payroll_8",
        now: 1000,
      });
      expect(session.commitmentVersion).toBe(2);
      expect(session.commitmentSnapshotId).toBe("snap_check");
      expect(verifyProofInputSessionIntegrity(session)).toBe(true);

      const validating = transitionToValidating(session, { runStatus: "draft" });
      expect(verifyProofInputSessionIntegrity(validating)).toBe(true);
      expect(() => transitionToValidated(validating, { amount: "1000", asset: "native" })).toThrow(
        expectVersionError(SalaryCommitmentVersionErrorCode.VERSION_HEADER_MISSING)
      );
      expect(() =>
        transitionToValidated(validating, {
          amount: "1000",
          asset: "native",
          commitmentVersion: 1,
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.VERSION_MISMATCH));

      const validated = transitionToValidated(validating, {
        amount: "1000",
        asset: "native",
        commitmentVersion: "V2",
      });
      expect(validated.state).toBe("validated");
      expect(verifyProofInputSessionIntegrity(validated)).toBe(true);
    });

    it("requires version and snapshot identifiers together and rejects invalid versions", () => {
      expect(() => createProofInputSession({ sessionId: "partial", commitmentVersion: 1 })).toThrow(
        expectVersionError(SalaryCommitmentVersionErrorCode.INVALID_IDENTIFIER)
      );
      expect(() =>
        createProofInputSession({
          sessionId: "empty_snapshot",
          commitmentVersion: 1,
          commitmentSnapshotId: "  ",
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.INVALID_IDENTIFIER));
      expect(() =>
        createProofInputSession({
          sessionId: "bad_version",
          commitmentVersion: 9,
          commitmentSnapshotId: "snap_x",
        })
      ).toThrow(expectVersionError(SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION));
    });

    it("scrubs commitment and nullifier context from state errors", () => {
      const error = new SalaryCommitmentVersionError(
        `Rejected ${RAW_SALARY}`,
        SalaryCommitmentVersionErrorCode.NULLIFIER_REUSE,
        {
          commitmentDigest: DIGEST_A,
          nullifierDigest: NULLIFIER_A,
          employeeSalary: RAW_SALARY,
          snapshotId: "snap_private",
        }
      );
      expect(JSON.stringify(error.context)).not.toContain(DIGEST_A);
      expect(JSON.stringify(error.context)).not.toContain(NULLIFIER_A);
      expect(JSON.stringify(error.context)).not.toContain(RAW_SALARY);
      expect(error.context.snapshotId).toBe("snap_private");
    });
  });
});
