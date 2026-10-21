import {
  validateCommitmentReplacementRequest,
  CommitmentReplacementReason,
  CommitmentReplacementResultCode,
  type CommitmentReplacementRequest,
} from "./commitmentReplacement";

const BASE_REQUEST: CommitmentReplacementRequest = {
  employeeId: "emp-001",
  newCommitmentHash: "abc123def456",
  reason: CommitmentReplacementReason.WALLET_ROTATION,
  requestedAt: Date.now(),
};

describe("validateCommitmentReplacementRequest (#759)", () => {
  it("accepts a valid request", () => {
    const result = validateCommitmentReplacementRequest(BASE_REQUEST);
    expect(result.accepted).toBe(true);
    expect(result.code).toBe(CommitmentReplacementResultCode.ACCEPTED);
    expect(result.request).toBe(BASE_REQUEST);
  });

  it("rejects when newCommitmentHash is empty", () => {
    const result = validateCommitmentReplacementRequest({
      ...BASE_REQUEST,
      newCommitmentHash: "   ",
    });
    expect(result.accepted).toBe(false);
    expect(result.code).toBe(CommitmentReplacementResultCode.REJECTED_MISSING_COMMITMENT);
  });

  it("rejects when reason is not a valid CommitmentReplacementReason", () => {
    const result = validateCommitmentReplacementRequest({
      ...BASE_REQUEST,
      reason: "NOT_A_REASON" as CommitmentReplacementReason,
    });
    expect(result.accepted).toBe(false);
    expect(result.code).toBe(CommitmentReplacementResultCode.REJECTED_INVALID_REASON);
  });

  it("rejects when a payroll run is active", () => {
    const result = validateCommitmentReplacementRequest(BASE_REQUEST, { runIsActive: true });
    expect(result.accepted).toBe(false);
    expect(result.code).toBe(CommitmentReplacementResultCode.REJECTED_RUN_ACTIVE);
  });

  it("rejects when new hash matches an existing commitment hash", () => {
    const result = validateCommitmentReplacementRequest(BASE_REQUEST, {
      existingCommitmentHashes: [BASE_REQUEST.newCommitmentHash],
    });
    expect(result.accepted).toBe(false);
    expect(result.code).toBe(CommitmentReplacementResultCode.REJECTED_DUPLICATE);
  });

  it("accepts all valid replacement reasons", () => {
    for (const reason of Object.values(CommitmentReplacementReason)) {
      const result = validateCommitmentReplacementRequest({ ...BASE_REQUEST, reason });
      expect(result.accepted).toBe(true);
    }
  });

  it("result message never contains salary or nullifier literals", () => {
    const result = validateCommitmentReplacementRequest(BASE_REQUEST);
    expect(result.message).not.toMatch(/salary|nullifier/i);
  });
});
