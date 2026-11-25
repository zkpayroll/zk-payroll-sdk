import {
  applyRetentionPolicyUpdate,
  RETENTION_GENESIS_PREVIOUS_HASH,
} from "../../src/retention/stateManager";
import { RetentionPolicyErrorCode } from "../../src/retention/errors";
import { validateRetentionPolicyState } from "../../src/retention/validation";
import { RetentionPolicy } from "../../src/retention/types";

const FIXED_NOW = 1700000000000;
const POLICY_ID = "org-retention-revisions";

function buildRevisionChain(): { genesis: RetentionPolicy; revision2: RetentionPolicy } {
  const genesis = applyRetentionPolicyUpdate(
    null,
    {
      policyId: POLICY_ID,
      expectedVersion: 0,
      retentionDays: 2555,
      minimumRetentionDays: 2555,
      legalHoldActive: false,
      updatedBy: "compliance_admin_1",
      updateReason: "Initial statutory retention policy",
      timestampMs: FIXED_NOW,
      status: "active",
    },
    { now: FIXED_NOW }
  ).updatedPolicy;

  const revision2 = applyRetentionPolicyUpdate(
    genesis,
    {
      policyId: POLICY_ID,
      expectedVersion: 1,
      retentionDays: 2600,
      updatedBy: "compliance_admin_2",
      updateReason: "Extending retention for audit compliance",
      timestampMs: FIXED_NOW + 1000,
    },
    { now: FIXED_NOW + 5000 }
  ).updatedPolicy;

  return { genesis, revision2 };
}

describe("retention policy revision references (#983)", () => {
  it("accepts a genesis revision that uses the genesis previousHash", () => {
    const { genesis } = buildRevisionChain();
    expect(genesis.previousHash).toBe(RETENTION_GENESIS_PREVIOUS_HASH);
    expect(validateRetentionPolicyState(genesis).isValid).toBe(true);
  });

  it("accepts a later revision that links to its real predecessor", () => {
    const { revision2 } = buildRevisionChain();
    expect(validateRetentionPolicyState(revision2).isValid).toBe(true);
  });

  it("rejects a non-genesis revision that points back at the genesis sentinel", () => {
    const { revision2 } = buildRevisionChain();
    const detached = { ...revision2, previousHash: RETENTION_GENESIS_PREVIOUS_HASH };

    const result = validateRetentionPolicyState(detached);

    expect(result.isValid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: RetentionPolicyErrorCode.INVALID_HASH,
        field: "previousHash",
        message:
          "Non-genesis retention policy revision must reference the previous revision hash.",
      })
    );
  });

  it("rejects a revision that references its own hash as the predecessor", () => {
    const { revision2 } = buildRevisionChain();
    const selfReferencing = { ...revision2, previousHash: revision2.hash };

    const result = validateRetentionPolicyState(selfReferencing);

    expect(result.isValid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: RetentionPolicyErrorCode.INVALID_HASH,
        field: "previousHash",
        message: "Retention policy revision cannot reference its own hash as the previous revision.",
      })
    );
  });

  it("does not leak the referenced hashes into the issue messages", () => {
    const { revision2 } = buildRevisionChain();
    const selfReferencing = { ...revision2, previousHash: revision2.hash };

    const serialized = JSON.stringify(validateRetentionPolicyState(selfReferencing).issues);
    expect(serialized).not.toContain(revision2.hash);
  });
});
