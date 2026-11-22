import {
  applyRetentionPolicyUpdate,
  computeRetentionPolicyHash,
  DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS,
  RETENTION_GENESIS_PREVIOUS_HASH,
} from "../../src/retention/stateManager";
import {
  RetentionPolicyError,
  RetentionPolicyErrorCode,
  formatRetentionPolicyError,
  isRetentionPolicyError,
  redactPolicyActorId,
} from "../../src/retention/errors";
import {
  assertValidRetentionPolicyState,
  assertValidRetentionPolicyUpdate,
  MAX_RETENTION_POLICY_ID_LENGTH,
  MAX_RETENTION_REASON_LENGTH,
  validateRetentionPolicyState,
  validateRetentionPolicyUpdate,
} from "../../src/retention/validation";
import { RetentionPolicy, RetentionPolicyUpdateInput } from "../../src/retention/types";

const FIXED_NOW = 1700000000000;
const PRIVATE_VALUE = "EMPLOYEE_SALARY_5000_PREIMAGE";

const creation: RetentionPolicyUpdateInput = {
  policyId: "org-retention-01",
  expectedVersion: 0,
  retentionDays: DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS,
  minimumRetentionDays: DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS,
  legalHoldActive: false,
  status: "active",
  updatedBy: "compliance_admin_1",
  updateReason: "Initial statutory retention policy",
  timestampMs: FIXED_NOW,
};

function policy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  const result = applyRetentionPolicyUpdate(null, creation, { now: FIXED_NOW }).updatedPolicy;
  return { ...result, ...overrides };
}

describe("Retention policy typed validation, safe errors, and boundaries (#909, #910, #911, #912)", () => {
  describe("typed validation (#909)", () => {
    it("returns a transition and normalized policy for a valid update", () => {
      const current = policy();
      const result = validateRetentionPolicyUpdate(
        current,
        {
          policyId: current.policyId,
          expectedVersion: current.version,
          retentionDays: 2600,
          updatedBy: "auditor_2",
          updateReason: "Extend retention window for audit compliance",
          timestampMs: FIXED_NOW + 1000,
        },
        { now: FIXED_NOW + 5000 }
      );
      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.transition?.updatedPolicy.version).toBe(2);
      expect(result.policy?.previousHash).toBe(current.hash);
      expect(Object.isFrozen(result.issues)).toBe(true);
    });

    it("assert helper returns the transition and throws typed error for invalid input", () => {
      const current = policy();
      const transition = assertValidRetentionPolicyUpdate(
        current,
        {
          policyId: current.policyId,
          expectedVersion: current.version,
          retentionDays: 2600,
          updatedBy: "auditor_2",
          updateReason: "Extend retention window for audit compliance",
          timestampMs: FIXED_NOW + 1000,
        },
        { now: FIXED_NOW + 5000 }
      );
      expect(transition.success).toBe(true);

      expect(() => assertValidRetentionPolicyUpdate(current, null)).toThrow(RetentionPolicyError);
      try {
        assertValidRetentionPolicyUpdate(current, null);
      } catch (error) {
        const err = error as RetentionPolicyError;
        expect(err.retentionCode).toBe(RetentionPolicyErrorCode.POLICY_ID_REQUIRED);
        expect(err.issues.length).toBeGreaterThan(0);
      }
    });

    it("accumulates multiple issues without echoing rejected values", () => {
      const result = validateRetentionPolicyUpdate(
        null,
        {
          policyId: "",
          expectedVersion: -1,
          retentionDays: 1,
          minimumRetentionDays: -5,
          maximumRetentionDays: 0,
          updatedBy: "",
          updateReason: "",
          metadata: { employeeSalary: PRIVATE_VALUE },
        },
        { now: FIXED_NOW }
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.map((i) => i.code)).toEqual(
        expect.arrayContaining([
          RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
          RetentionPolicyErrorCode.ACTOR_REQUIRED,
          RetentionPolicyErrorCode.REASON_REQUIRED,
          RetentionPolicyErrorCode.VERSION_MISMATCH,
          RetentionPolicyErrorCode.INVALID_RETENTION_DAYS,
          RetentionPolicyErrorCode.STATUTORY_MINIMUM_VIOLATION,
          RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED,
        ])
      );
      expect(JSON.stringify(result.issues)).not.toContain(PRIVATE_VALUE);
    });
  });

  describe("safe errors (#910)", () => {
    it("provides actionable canonical messages without sensitive values", () => {
      const err = new RetentionPolicyError(
        "Version conflict for employee salary 9999",
        RetentionPolicyErrorCode.VERSION_MISMATCH,
        { policyId: "org-retention-01", employeeSalary: PRIVATE_VALUE, updateReason: PRIVATE_VALUE }
      );
      expect(isRetentionPolicyError(err)).toBe(true);
      expect(err.retentionCode).toBe(RetentionPolicyErrorCode.VERSION_MISMATCH);
      expect(err.context.policyId).toBe("org-retention-01");
      expect(err.context.employeeSalary).toBeUndefined();
      expect(err.context.updateReason).toBeUndefined();
      expect(formatRetentionPolicyError(err)).toContain(RetentionPolicyErrorCode.VERSION_MISMATCH);
      expect(formatRetentionPolicyError(err)).not.toContain(PRIVATE_VALUE);
      expect(
        formatRetentionPolicyError([
          {
            code: RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT,
            field: "retentionDays",
            message: "Do not reduce retentionDays during hold",
          },
        ])
      ).toContain("[retentionDays]");
    });

    it("redacts actor identifiers and rejects sensitive metadata keys", () => {
      expect(redactPolicyActorId("compliance_admin_1")).toBe("co***_1");
      expect(redactPolicyActorId("abc")).toBe("***");
      expect(redactPolicyActorId(undefined)).toBeUndefined();

      const result = validateRetentionPolicyUpdate(
        policy(),
        {
          policyId: "org-retention-01",
          expectedVersion: 1,
          retentionDays: 2600,
          updatedBy: "auditor_2",
          updateReason: "Extend retention for compliance",
          timestampMs: FIXED_NOW + 1000,
          metadata: { wage_band: "hidden" },
        },
        { now: FIXED_NOW + 5000 }
      );
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(RetentionPolicyErrorCode.SENSITIVE_DATA_DETECTED);
      expect(JSON.stringify(result.issues)).not.toContain("hidden");
    });
  });

  describe("boundaries (#911)", () => {
    it("accepts exact statutory floor and rejects one day below", () => {
      const exact = validateRetentionPolicyUpdate(null, creation, { now: FIXED_NOW });
      expect(exact.isValid).toBe(true);
      expect(exact.policy?.retentionDays).toBe(DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS);

      const below = validateRetentionPolicyUpdate(
        null,
        { ...creation, retentionDays: DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS - 1 },
        { now: FIXED_NOW }
      );
      expect(below.isValid).toBe(false);
      expect(below.issues[0].code).toBe(RetentionPolicyErrorCode.STATUTORY_MINIMUM_VIOLATION);
    });

    it("accepts equal min/max boundaries and rejects inverted max", () => {
      const current = policy({
        retentionDays: 2600,
        minimumRetentionDays: 2555,
        maximumRetentionDays: 3000,
      });
      const equal = validateRetentionPolicyUpdate(
        current,
        {
          policyId: current.policyId,
          expectedVersion: current.version,
          maximumRetentionDays: 3000,
          updatedBy: "auditor_2",
          updateReason: "Confirm maximum retention boundary",
          timestampMs: FIXED_NOW + 1000,
        },
        { now: FIXED_NOW + 5000 }
      );
      expect(equal.isValid).toBe(false);
      expect(equal.issues[0].code).toBe(RetentionPolicyErrorCode.NO_OP_UPDATE);

      const inverted = validateRetentionPolicyUpdate(
        current,
        {
          policyId: current.policyId,
          expectedVersion: current.version,
          maximumRetentionDays: 2599,
          updatedBy: "auditor_2",
          updateReason: "Lower maximum below current duration",
          timestampMs: FIXED_NOW + 1000,
        },
        { now: FIXED_NOW + 5000 }
      );
      expect(inverted.isValid).toBe(false);
      expect(inverted.issues.map((i) => i.code)).toContain(
        RetentionPolicyErrorCode.INVALID_RETENTION_DAYS
      );
    });

    it("respects clock skew and timestamp regression boundaries", () => {
      const current = policy();
      const atSkew = validateRetentionPolicyUpdate(
        null,
        { ...creation, timestampMs: FIXED_NOW + 5000 },
        { now: FIXED_NOW, maxClockSkewMs: 5000 }
      );
      expect(atSkew.isValid).toBe(true);

      const beyondSkew = validateRetentionPolicyUpdate(
        null,
        { ...creation, timestampMs: FIXED_NOW + 5001 },
        { now: FIXED_NOW, maxClockSkewMs: 5000 }
      );
      expect(beyondSkew.isValid).toBe(false);
      expect(beyondSkew.issues[0].code).toBe(RetentionPolicyErrorCode.INVALID_TIMESTAMP);

      const regression = validateRetentionPolicyUpdate(
        current,
        {
          policyId: current.policyId,
          expectedVersion: 1,
          retentionDays: 2600,
          updatedBy: "auditor_2",
          updateReason: "Extend retention window",
          timestampMs: current.updatedAtMs - 1,
        },
        { now: FIXED_NOW + 5000 }
      );
      expect(regression.isValid).toBe(false);
      expect(regression.issues.map((i) => i.code)).toContain(
        RetentionPolicyErrorCode.VERSION_REGRESSION
      );
    });

    it("respects identifier and justification length boundaries", () => {
      const maxId = "a".repeat(MAX_RETENTION_POLICY_ID_LENGTH);
      const maxReason = "b".repeat(MAX_RETENTION_REASON_LENGTH);
      expect(
        validateRetentionPolicyUpdate(
          null,
          { ...creation, policyId: maxId, updateReason: maxReason },
          { now: FIXED_NOW }
        ).isValid
      ).toBe(true);
      expect(
        validateRetentionPolicyUpdate(
          null,
          { ...creation, policyId: `${maxId}a`, updateReason: `${maxReason}b` },
          { now: FIXED_NOW }
        ).issues.map((i) => i.code)
      ).toEqual(
        expect.arrayContaining([
          RetentionPolicyErrorCode.POLICY_ID_REQUIRED,
          RetentionPolicyErrorCode.REASON_REQUIRED,
        ])
      );
    });

    it("rejects lifecycle transitions outside the allowed set", () => {
      const superseded = policy({ status: "superseded" });
      expect(
        validateRetentionPolicyUpdate(
          superseded,
          {
            policyId: superseded.policyId,
            expectedVersion: 1,
            retentionDays: 2600,
            updatedBy: "auditor_2",
            updateReason: "Attempt edit of terminal policy",
            timestampMs: FIXED_NOW + 1000,
          },
          { now: FIXED_NOW + 5000 }
        ).issues.map((i) => i.code)
      ).toContain(RetentionPolicyErrorCode.INVALID_STATE_TRANSITION);
    });

    it("rejects retention reduction while a legal hold is active", () => {
      const held = policy({
        legalHoldActive: true,
        retentionDays: 3000,
        minimumRetentionDays: 2555,
      });
      const result = validateRetentionPolicyUpdate(
        held,
        {
          policyId: held.policyId,
          expectedVersion: 1,
          retentionDays: 2600,
          updatedBy: "auditor_2",
          updateReason: "Reduce retention during active hold",
          timestampMs: FIXED_NOW + 1000,
        },
        { now: FIXED_NOW + 5000 }
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain(
        RetentionPolicyErrorCode.LEGAL_HOLD_CONFLICT
      );
    });
  });

  describe("snapshot validation (#909 boundary)", () => {
    it("accepts an authentic policy snapshot", () => {
      const current = policy();
      expect(validateRetentionPolicyState(current).isValid).toBe(true);
      expect(assertValidRetentionPolicyState(current)).toEqual(current);
    });

    it("detects tampered hash and broken genesis link without exposing values", () => {
      const current = policy();
      const tampered = validateRetentionPolicyState({ ...current, retentionDays: 9999 });
      expect(tampered.isValid).toBe(false);
      expect(tampered.issues.map((i) => i.code)).toContain(RetentionPolicyErrorCode.INVALID_HASH);

      const badGenesis = validateRetentionPolicyState({
        ...current,
        previousHash: "f".repeat(64),
        hash: computeRetentionPolicyHash({
          ...current,
          previousHash: "f".repeat(64),
          hash: undefined,
        } as any),
      });
      expect(badGenesis.issues.map((i) => i.code)).toContain(RetentionPolicyErrorCode.INVALID_HASH);
      expect(JSON.stringify(tampered.issues)).not.toContain(PRIVATE_VALUE);
      expect(current.previousHash).toBe(RETENTION_GENESIS_PREVIOUS_HASH);
    });
  });
});
