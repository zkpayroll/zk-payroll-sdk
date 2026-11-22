import {
  applyRetentionPolicyUpdate,
  RetentionPolicyStateManager,
  DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS,
  RETENTION_GENESIS_PREVIOUS_HASH,
} from "../../src/retention/stateManager";
import {
  RetentionPolicyError,
  RetentionPolicyErrorCode,
  RETENTION_POLICY_ERROR_MESSAGES,
  isRetentionPolicyError,
  getRetentionPolicyErrorMessage,
} from "../../src/retention/errors";
import { RetentionPolicy, RetentionPolicyUpdateInput } from "../../src/retention/types";

describe("Hardened Retention Policy State Handling (#913)", () => {
  const fixedNow = 1700000000000;

  const sampleCreationInput: RetentionPolicyUpdateInput = {
    policyId: "org-retention-01",
    expectedVersion: 0,
    retentionDays: 2555,
    minimumRetentionDays: 2555,
    legalHoldActive: false,
    updatedBy: "compliance_admin_1",
    updateReason: "Initial statutory retention policy",
    timestampMs: fixedNow,
    status: "active",
  };

  describe("Policy Creation & Transition Success Cases", () => {
    it("creates a valid initial retention policy with genesis previousHash", () => {
      const result = applyRetentionPolicyUpdate(null, sampleCreationInput, { now: fixedNow });
      expect(result.success).toBe(true);
      expect(result.updatedPolicy.policyId).toBe("org-retention-01");
      expect(result.updatedPolicy.version).toBe(1);
      expect(result.updatedPolicy.retentionDays).toBe(2555);
      expect(result.updatedPolicy.minimumRetentionDays).toBe(2555);
      expect(result.updatedPolicy.status).toBe("active");
      expect(result.updatedPolicy.previousHash).toBe(RETENTION_GENESIS_PREVIOUS_HASH);
      expect(result.updatedPolicy.hash).toHaveLength(64);
      expect(Object.isFrozen(result.updatedPolicy)).toBe(true);
    });

    it("applies valid version transition incrementing version and linking hashes", () => {
      const initial = applyRetentionPolicyUpdate(null, sampleCreationInput, {
        now: fixedNow,
      }).updatedPolicy;

      const updateInput: RetentionPolicyUpdateInput = {
        policyId: "org-retention-01",
        expectedVersion: 1,
        retentionDays: 2600,
        updatedBy: "compliance_admin_2",
        updateReason: "Extending retention for audit compliance",
        timestampMs: fixedNow + 1000,
      };

      const result = applyRetentionPolicyUpdate(initial, updateInput, { now: fixedNow + 5000 });
      expect(result.success).toBe(true);
      expect(result.updatedPolicy.version).toBe(2);
      expect(result.updatedPolicy.retentionDays).toBe(2600);
      expect(result.updatedPolicy.previousHash).toBe(initial.hash);
      expect(result.updatedPolicy.updatedBy).toBe("compliance_admin_2");
    });

    it("StateManager registers, updates, and verifies hash-chain history integrity", async () => {
      const manager = new RetentionPolicyStateManager();
      const res1 = await manager.updatePolicy(sampleCreationInput, { now: fixedNow });
      expect(res1.updatedPolicy.version).toBe(1);

      const res2 = await manager.updatePolicy(
        {
          policyId: "org-retention-01",
          expectedVersion: 1,
          retentionDays: 3000,
          updatedBy: "auditor",
          updateReason: "Expanding retention window",
          timestampMs: fixedNow + 1000,
        },
        { now: fixedNow + 5000 }
      );
      expect(res2.updatedPolicy.version).toBe(2);

      const history = manager.getHistory("org-retention-01");
      expect(history).toHaveLength(2);

      const integrity = manager.verifyHistoryIntegrity("org-retention-01");
      expect(integrity.valid).toBe(true);
    });
  });

  describe("Failure & Concurrency Guard Cases", () => {
    it("rejects creation if expectedVersion is not 0", () => {
      expect(() =>
        applyRetentionPolicyUpdate(
          null,
          { ...sampleCreationInput, expectedVersion: 1 },
          { now: fixedNow }
        )
      ).toThrow(RetentionPolicyError);
    });

    it("rejects update when expectedVersion does not match current version (concurrency conflict)", () => {
      const initial = applyRetentionPolicyUpdate(null, sampleCreationInput, {
        now: fixedNow,
      }).updatedPolicy;
      expect(() =>
        applyRetentionPolicyUpdate(
          initial,
          {
            policyId: "org-retention-01",
            expectedVersion: 99,
            retentionDays: 2600,
            updatedBy: "admin",
            updateReason: "outdated update",
          },
          { now: fixedNow + 5000 }
        )
      ).toThrow(RetentionPolicyError);
    });

    it("rejects empty actor or reason", () => {
      expect(() =>
        applyRetentionPolicyUpdate(
          null,
          { ...sampleCreationInput, updatedBy: "" },
          { now: fixedNow }
        )
      ).toThrow(RetentionPolicyError);

      expect(() =>
        applyRetentionPolicyUpdate(
          null,
          { ...sampleCreationInput, updateReason: "   " },
          { now: fixedNow }
        )
      ).toThrow(RetentionPolicyError);
    });

    it("rejects no-op updates where no configuration changed", () => {
      const initial = applyRetentionPolicyUpdate(null, sampleCreationInput, {
        now: fixedNow,
      }).updatedPolicy;
      expect(() =>
        applyRetentionPolicyUpdate(
          initial,
          {
            policyId: "org-retention-01",
            expectedVersion: 1,
            retentionDays: initial.retentionDays,
            minimumRetentionDays: initial.minimumRetentionDays,
            updatedBy: "admin",
            updateReason: "re-applying same settings",
            timestampMs: fixedNow + 1000,
          },
          { now: fixedNow + 5000 }
        )
      ).toThrow(RetentionPolicyError);
    });

    it("rejects updates to superseded terminal policies", () => {
      const initial = applyRetentionPolicyUpdate(null, sampleCreationInput, {
        now: fixedNow,
      }).updatedPolicy;
      const superseded = applyRetentionPolicyUpdate(
        initial,
        {
          policyId: "org-retention-01",
          expectedVersion: 1,
          status: "superseded",
          updatedBy: "admin",
          updateReason: "Superseding policy",
          timestampMs: fixedNow + 1000,
        },
        { now: fixedNow + 5000 }
      ).updatedPolicy;

      expect(() =>
        applyRetentionPolicyUpdate(
          superseded,
          {
            policyId: "org-retention-01",
            expectedVersion: 2,
            retentionDays: 3000,
            updatedBy: "admin",
            updateReason: "Attempting to edit superseded policy",
            timestampMs: fixedNow + 2000,
          },
          { now: fixedNow + 5000 }
        )
      ).toThrow(RetentionPolicyError);
    });
  });

  describe("Boundary & Compliance Checks", () => {
    it("rejects retention reduction below statutory floor", () => {
      expect(() =>
        applyRetentionPolicyUpdate(
          null,
          {
            ...sampleCreationInput,
            retentionDays: 100, // less than 2555
          },
          { now: fixedNow }
        )
      ).toThrow(RetentionPolicyError);
    });

    it("blocks retention reduction when active legal hold is enabled", () => {
      const initialWithHold = applyRetentionPolicyUpdate(
        null,
        { ...sampleCreationInput, legalHoldActive: true, retentionDays: 3000 },
        { now: fixedNow }
      ).updatedPolicy;

      expect(() =>
        applyRetentionPolicyUpdate(
          initialWithHold,
          {
            policyId: "org-retention-01",
            expectedVersion: 1,
            retentionDays: 2555, // reducing from 3000 during hold
            updatedBy: "admin",
            updateReason: "Trying to reduce retention under hold",
            timestampMs: fixedNow + 1000,
          },
          { now: fixedNow + 5000 }
        )
      ).toThrow(RetentionPolicyError);
    });

    it("requires allowLegalHoldRelease flag to release active legal hold", () => {
      const initialWithHold = applyRetentionPolicyUpdate(
        null,
        { ...sampleCreationInput, legalHoldActive: true },
        { now: fixedNow }
      ).updatedPolicy;

      expect(() =>
        applyRetentionPolicyUpdate(
          initialWithHold,
          {
            policyId: "org-retention-01",
            expectedVersion: 1,
            legalHoldActive: false,
            updatedBy: "admin",
            updateReason: "Unauthorized release of legal hold",
            timestampMs: fixedNow + 1000,
          },
          { now: fixedNow + 5000, allowLegalHoldRelease: false }
        )
      ).toThrow(RetentionPolicyError);

      const releaseResult = applyRetentionPolicyUpdate(
        initialWithHold,
        {
          policyId: "org-retention-01",
          expectedVersion: 1,
          legalHoldActive: false,
          updatedBy: "admin",
          updateReason: "Authorized release of legal hold with court clearance",
          timestampMs: fixedNow + 1000,
        },
        { now: fixedNow + 5000, allowLegalHoldRelease: true }
      );
      expect(releaseResult.updatedPolicy.legalHoldActive).toBe(false);
    });

    it("rejects future timestamp beyond clock skew", () => {
      expect(() =>
        applyRetentionPolicyUpdate(
          null,
          { ...sampleCreationInput, timestampMs: fixedNow + 50000 },
          { now: fixedNow, maxClockSkewMs: 5000 }
        )
      ).toThrow(RetentionPolicyError);
    });

    it("rejects sensitive data in updateReason", () => {
      expect(() =>
        applyRetentionPolicyUpdate(
          null,
          { ...sampleCreationInput, updateReason: "Update policy for salary adjustment" },
          { now: fixedNow }
        )
      ).toThrow(RetentionPolicyError);
    });

    it("isRetentionPolicyError and getRetentionPolicyErrorMessage work properly", () => {
      const err = new RetentionPolicyError(
        "Version conflict",
        RetentionPolicyErrorCode.VERSION_MISMATCH
      );
      expect(isRetentionPolicyError(err)).toBe(true);
      expect(isRetentionPolicyError(new Error("Generic"))).toBe(false);
      expect(getRetentionPolicyErrorMessage(err)).toBe("Version conflict");
      expect(
        getRetentionPolicyErrorMessage({ code: RetentionPolicyErrorCode.ACTOR_REQUIRED })
      ).toBe(RETENTION_POLICY_ERROR_MESSAGES[RetentionPolicyErrorCode.ACTOR_REQUIRED]);
      expect(getRetentionPolicyErrorMessage(null)).toMatch(/retention policy error/i);
    });

    it("detects tampered history in StateManager", async () => {
      const manager = new RetentionPolicyStateManager();
      await manager.updatePolicy(sampleCreationInput, { now: fixedNow });
      const p1 = manager.getPolicy("org-retention-01")!;

      // Tamper entry manually in a copy
      const tamperedEntry: RetentionPolicy = {
        ...p1,
        retentionDays: 9999,
      };

      const managerTampered = new RetentionPolicyStateManager([tamperedEntry]);
      const check = managerTampered.verifyHistoryIntegrity("org-retention-01");
      expect(check.valid).toBe(false);
      expect(check.brokenAt).toBe(1);
    });
  });
});
