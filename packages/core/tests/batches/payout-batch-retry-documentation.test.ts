import {
  DEFAULT_PAYOUT_BATCH_MAX_RETRY_ATTEMPTS,
  DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS,
  PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES,
  PayoutBatchRetryStateError,
  PayoutBatchRetryStateErrorCode,
  PayoutBatchRetryStateManager,
} from "../../src/batches/retryState";
import {
  validatePayoutBatchRetryState,
  validatePayoutBatchRetryUpdate,
} from "../../src/batches/retryValidation";

const BASE_TIME = 1_700_000_000_000;
const BATCH_ID = "batch-docs";

function newManager(maxAttempts?: number): PayoutBatchRetryStateManager {
  const manager = new PayoutBatchRetryStateManager();
  manager.initializeBatch(BATCH_ID, ["payout-a", "payout-b"], {
    updatedBy: "operator-1",
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    timestampMs: BASE_TIME,
  });
  return manager;
}

function expectRetryError(fn: () => unknown): PayoutBatchRetryStateError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PayoutBatchRetryStateError) return error;
  }
  throw new Error("Expected a PayoutBatchRetryStateError.");
}

describe("Documented payout batch retry behavior (#902)", () => {
  it("exposes the documented retry API from the retry modules", () => {
    expect(DEFAULT_PAYOUT_BATCH_MAX_RETRY_ATTEMPTS).toBe(3);
    expect(DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS).toBe(5_000);
    expect(typeof PayoutBatchRetryStateManager).toBe("function");
    expect(typeof validatePayoutBatchRetryUpdate).toBe("function");
    expect(typeof validatePayoutBatchRetryState).toBe("function");
  });

  it("applies a documented retry transition with a valid hash chain", () => {
    const manager = newManager();

    const result = manager.update({
      batchId: BATCH_ID,
      expectedVersion: 1,
      targetStatus: "retrying",
      updatedBy: "operator-2",
      settledItemIds: ["payout-a"],
      lastErrorCode: "RPC_TIMEOUT",
      timestampMs: BASE_TIME + 1_000,
    });

    expect(result.state.version).toBe(2);
    expect(result.state.attempt).toBe(1);
    expect(result.state.outstandingItemIds).toEqual(["payout-b"]);
    expect(result.state.settledItemIds).toEqual(["payout-a"]);
    expect(result.state.previousHash).toBe(manager.getHistory(BATCH_ID)[0].hash);
    expect(manager.verifyHistoryIntegrity(BATCH_ID)).toEqual({ valid: true });
    expect(validatePayoutBatchRetryState(result.state).isValid).toBe(true);
  });

  it("reports stale versions with the documented safe message", () => {
    const manager = newManager();

    const error = expectRetryError(() =>
      manager.update({
        batchId: BATCH_ID,
        expectedVersion: 99,
        targetStatus: "retrying",
        updatedBy: "operator-2",
        timestampMs: BASE_TIME + 1_000,
      })
    );

    expect(error.retryCode).toBe(PayoutBatchRetryStateErrorCode.VERSION_MISMATCH);
    expect(error.message).toMatch(
      /Version conflict: expected version 99, but the batch is at version 1\./
    );
    expect(error.message).not.toContain("payout-a");
  });

  it("rejects free-text failure notes and settled items without leaking payroll data", () => {
    const manager = newManager();
    manager.update({
      batchId: BATCH_ID,
      expectedVersion: 1,
      targetStatus: "retrying",
      updatedBy: "operator-2",
      settledItemIds: ["payout-a"],
      timestampMs: BASE_TIME + 1_000,
    });

    const error = expectRetryError(() =>
      manager.update({
        batchId: BATCH_ID,
        expectedVersion: 2,
        targetStatus: "failed",
        updatedBy: "operator-2",
        lastErrorCode: "salary 4500 for jane",
        timestampMs: BASE_TIME + 2_000,
      })
    );

    expect(error.retryCode).toBe(PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE);
    expect(error.message).toBe(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE]
    );
    expect(error.message).not.toMatch(/jane|4500/i);

    const validation = validatePayoutBatchRetryUpdate(manager.getState(BATCH_ID)!, {
      batchId: BATCH_ID,
      expectedVersion: 2,
      targetStatus: "retrying",
      updatedBy: "operator-3",
      settledItemIds: ["payout-a"],
      timestampMs: BASE_TIME + 2_000,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.issues[0].code).toBe(PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED);
  });

  it("enforces the documented clock-skew and attempt boundaries", () => {
    const atLimit = newManager();
    expect(() =>
      atLimit.update(
        {
          batchId: BATCH_ID,
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS,
        },
        { now: BASE_TIME }
      )
    ).not.toThrow();

    const beyondLimit = newManager();
    expect(() =>
      beyondLimit.update(
        {
          batchId: BATCH_ID,
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS + 1,
        },
        { now: BASE_TIME }
      )
    ).toThrow(/future beyond allowed clock skew/);

    const bounded = newManager(1);
    bounded.update({
      batchId: BATCH_ID,
      expectedVersion: 1,
      targetStatus: "retrying",
      updatedBy: "operator-1",
      timestampMs: BASE_TIME + 1_000,
    });
    bounded.update({
      batchId: BATCH_ID,
      expectedVersion: 2,
      targetStatus: "failed",
      updatedBy: "operator-1",
      timestampMs: BASE_TIME + 2_000,
    });

    const error = expectRetryError(() =>
      bounded.update({
        batchId: BATCH_ID,
        expectedVersion: 3,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 3_000,
      })
    );

    expect(error.retryCode).toBe(PayoutBatchRetryStateErrorCode.ATTEMPTS_EXHAUSTED);
    expect(error.message).toBe(
      PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[PayoutBatchRetryStateErrorCode.ATTEMPTS_EXHAUSTED]
    );
  });
});
