import {
  DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS,
  PayoutBatchRetryStateError,
  PayoutBatchRetryStateErrorCode,
  PayoutBatchRetryStateManager,
} from "../../src/batches/retryState";
import type {
  PayoutBatchRetryState,
  PayoutBatchRetryUpdateInput,
} from "../../src/batches/retryState";
import {
  assertValidPayoutBatchRetryState,
  assertValidPayoutBatchRetryUpdate,
  validatePayoutBatchRetryState,
  validatePayoutBatchRetryUpdate,
} from "../../src/batches/retryValidation";

const BASE_TIME = 1_700_000_000_000;
const ONE_MINUTE = 60 * 1000;

function newManager(maxAttempts = 3): PayoutBatchRetryStateManager {
  const manager = new PayoutBatchRetryStateManager();
  manager.initializeBatch("batch-1", ["item-a", "item-b", "item-c"], {
    updatedBy: "operator-1",
    maxAttempts,
    timestampMs: BASE_TIME,
  });
  return manager;
}

function retryCodeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof PayoutBatchRetryStateError ? error.retryCode : undefined;
  }
}

describe("Payout batch retry boundaries (#901)", () => {
  describe("attempt boundaries", () => {
    it("allows the retry that exactly consumes maxAttempts and rejects the next one", () => {
      const manager = newManager(1);

      const first = manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      expect(first.state.attempt).toBe(1);
      expect(first.state.attempt).toBe(first.state.maxAttempts);

      manager.update({
        batchId: "batch-1",
        expectedVersion: 2,
        targetStatus: "failed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 2 * ONE_MINUTE,
      });

      expect(
        retryCodeOf(() =>
          manager.update({
            batchId: "batch-1",
            expectedVersion: 3,
            targetStatus: "retrying",
            updatedBy: "operator-1",
            timestampMs: BASE_TIME + 3 * ONE_MINUTE,
          })
        )
      ).toBe(PayoutBatchRetryStateErrorCode.ATTEMPTS_EXHAUSTED);
    });

    it("accepts maxAttempts of exactly 1 and rejects zero, negatives, and fractions", () => {
      const manager = new PayoutBatchRetryStateManager();

      expect(() =>
        manager.initializeBatch("one", ["item-a"], { updatedBy: "operator-1", maxAttempts: 1 })
      ).not.toThrow();
      expect(() =>
        manager.initializeBatch("zero", ["item-a"], { updatedBy: "operator-1", maxAttempts: 0 })
      ).toThrow(PayoutBatchRetryStateError);
      expect(() =>
        manager.initializeBatch("negative", ["item-a"], {
          updatedBy: "operator-1",
          maxAttempts: -1,
        })
      ).toThrow(PayoutBatchRetryStateError);
      expect(() =>
        manager.initializeBatch("fraction", ["item-a"], {
          updatedBy: "operator-1",
          maxAttempts: 1.5,
        })
      ).toThrow(PayoutBatchRetryStateError);
    });
  });

  describe("timestamp boundaries", () => {
    it("accepts a timestamp exactly at the clock-skew limit and rejects one millisecond beyond", () => {
      const manager = newManager();
      const atLimit = BASE_TIME + DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS;

      expect(() =>
        manager.update(
          {
            batchId: "batch-1",
            expectedVersion: 1,
            targetStatus: "failed",
            updatedBy: "operator-1",
            timestampMs: atLimit,
          },
          { now: BASE_TIME }
        )
      ).not.toThrow();

      const second = newManager();
      expect(
        retryCodeOf(() =>
          second.update(
            {
              batchId: "batch-1",
              expectedVersion: 1,
              targetStatus: "failed",
              updatedBy: "operator-1",
              timestampMs: atLimit + 1,
            },
            { now: BASE_TIME }
          )
        )
      ).toBe(PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP);
    });

    it("accepts an unchanged timestamp and rejects one millisecond of regression", () => {
      const manager = newManager();
      const failedAt = BASE_TIME + ONE_MINUTE;
      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        timestampMs: failedAt,
      });

      expect(() =>
        manager.update(
          {
            batchId: "batch-1",
            expectedVersion: 2,
            targetStatus: "retrying",
            updatedBy: "operator-2",
            timestampMs: failedAt,
          },
          { now: failedAt }
        )
      ).not.toThrow();

      expect(
        retryCodeOf(() =>
          manager.update(
            {
              batchId: "batch-1",
              expectedVersion: 3,
              targetStatus: "failed",
              updatedBy: "operator-2",
              timestampMs: failedAt - 1,
            },
            { now: failedAt }
          )
        )
      ).toBe(PayoutBatchRetryStateErrorCode.TIMESTAMP_REGRESSION);
    });

    it("rejects zero, negative, and non-finite timestamps", () => {
      const manager = newManager();

      for (const timestampMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          retryCodeOf(() =>
            manager.update({
              batchId: "batch-1",
              expectedVersion: 1,
              targetStatus: "failed",
              updatedBy: "operator-1",
              timestampMs,
            })
          )
        ).toBe(PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP);
      }
    });
  });

  describe("identifier boundaries", () => {
    it("accepts an item id of exactly 200 characters and rejects 201", () => {
      const manager = new PayoutBatchRetryStateManager();
      const maxId = "i".repeat(200);

      expect(() =>
        manager.initializeBatch("batch-max", [maxId], { updatedBy: "operator-1" })
      ).not.toThrow();

      expect(
        retryCodeOf(() =>
          manager.initializeBatch("batch-too-long", ["i".repeat(201)], {
            updatedBy: "operator-1",
          })
        )
      ).toBe(PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET);
    });

    it("trims surrounding whitespace and rejects blank identifiers", () => {
      const manager = new PayoutBatchRetryStateManager();
      manager.initializeBatch("batch-trim", ["  item-a  "], { updatedBy: "operator-1" });

      expect(manager.getState("batch-trim")!.outstandingItemIds).toEqual(["item-a"]);
      expect(
        retryCodeOf(() =>
          manager.initializeBatch("batch-blank", ["   "], { updatedBy: "operator-1" })
        )
      ).toBe(PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET);
    });

    it("accepts a 64-character failure code and rejects 65 characters", () => {
      const manager = newManager();

      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "operator-1",
          lastErrorCode: "A".repeat(64),
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).not.toThrow();

      expect(
        retryCodeOf(() =>
          manager.update({
            batchId: "batch-1",
            expectedVersion: 2,
            targetStatus: "retrying",
            updatedBy: "operator-1",
            lastErrorCode: "A".repeat(65),
            timestampMs: BASE_TIME + 2 * ONE_MINUTE,
          })
        )
      ).toBe(PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE);
    });

    it("rejects lowercase or free-text failure codes", () => {
      const manager = newManager();

      for (const lastErrorCode of ["rpc_timeout", "failed to pay alice", "  SPACED  "]) {
        expect(
          retryCodeOf(() =>
            manager.update({
              batchId: "batch-1",
              expectedVersion: 1,
              targetStatus: "failed",
              updatedBy: "operator-1",
              lastErrorCode,
              timestampMs: BASE_TIME + ONE_MINUTE,
            })
          )
        ).toBe(PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE);
      }
    });
  });

  describe("version boundaries", () => {
    it("accepts the exact expected version and rejects one version either side", () => {
      const manager = newManager();

      expect(
        retryCodeOf(() =>
          manager.update({
            batchId: "batch-1",
            expectedVersion: 0,
            targetStatus: "failed",
            updatedBy: "operator-1",
            timestampMs: BASE_TIME + ONE_MINUTE,
          })
        )
      ).toBe(PayoutBatchRetryStateErrorCode.VERSION_MISMATCH);

      expect(
        retryCodeOf(() =>
          manager.update({
            batchId: "batch-1",
            expectedVersion: 2,
            targetStatus: "failed",
            updatedBy: "operator-1",
            timestampMs: BASE_TIME + ONE_MINUTE,
          })
        )
      ).toBe(PayoutBatchRetryStateErrorCode.VERSION_MISMATCH);

      const applied = manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      expect(applied.state.version).toBe(2);
    });
  });

  describe("item-set boundaries", () => {
    it("allows settling every outstanding item and completing with none left", () => {
      const manager = newManager();
      const retry = manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        settledItemIds: ["item-a", "item-b", "item-c"],
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      expect(retry.state.outstandingItemIds).toEqual([]);

      const completed = manager.update({
        batchId: "batch-1",
        expectedVersion: 2,
        targetStatus: "completed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 2 * ONE_MINUTE,
      });
      expect(completed.state.status).toBe("completed");
    });

    it("rejects a duplicate item id even when the duplicate differs only by whitespace", () => {
      const manager = newManager();

      expect(
        retryCodeOf(() =>
          manager.update({
            batchId: "batch-1",
            expectedVersion: 1,
            targetStatus: "failed",
            updatedBy: "operator-1",
            outstandingItemIds: ["item-a", "  item-a  "],
            timestampMs: BASE_TIME + ONE_MINUTE,
          })
        )
      ).toBe(PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET);
    });

    it("rejects an item that is both settled and outstanding in one update", () => {
      const manager = newManager();

      expect(
        retryCodeOf(() =>
          manager.update({
            batchId: "batch-1",
            expectedVersion: 1,
            targetStatus: "retrying",
            updatedBy: "operator-1",
            settledItemIds: ["item-a"],
            outstandingItemIds: ["item-a", "item-b"],
            timestampMs: BASE_TIME + ONE_MINUTE,
          })
        )
      ).toBe(PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED);
    });
  });

  describe("typed validation boundaries", () => {
    it("returns the resulting state for a valid update", () => {
      const manager = newManager();
      const current = manager.getState("batch-1");

      const result = validatePayoutBatchRetryUpdate(current, {
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        lastErrorCode: "RPC_TIMEOUT",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });

      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.state).toMatchObject({ status: "failed", version: 2 });
      expect(result.transition?.state).toBe(result.state);
    });

    it("returns a typed issue instead of throwing for an invalid update", () => {
      const manager = newManager();
      const current = manager.getState("batch-1");

      const result = validatePayoutBatchRetryUpdate(current, {
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        settledItemIds: ["not-outstanding"],
        timestampMs: BASE_TIME + ONE_MINUTE,
      });

      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(
        PayoutBatchRetryStateErrorCode.UNKNOWN_OUTSTANDING_ITEM
      );
      expect(result.state).toBeUndefined();
    });

    it("accumulates multiple structural problems in one update", () => {
      const result = validatePayoutBatchRetryUpdate(null, {
        batchId: "",
        expectedVersion: -1,
        targetStatus: "bogus",
        updatedBy: "",
        settledItemIds: ["item-a", "item-a"],
        lastErrorCode: "lowercase",
        timestampMs: 0,
      } as unknown as PayoutBatchRetryUpdateInput);
      const codes = result.issues.map((entry) => entry.code);

      expect(codes).toEqual(
        expect.arrayContaining([
          PayoutBatchRetryStateErrorCode.BATCH_ID_REQUIRED,
          PayoutBatchRetryStateErrorCode.ACTOR_REQUIRED,
          PayoutBatchRetryStateErrorCode.VERSION_MISMATCH,
          PayoutBatchRetryStateErrorCode.INVALID_STATUS,
          PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET,
          PayoutBatchRetryStateErrorCode.INVALID_ERROR_CODE,
          PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP,
        ])
      );
    });

    it("asserts a valid update and throws for an invalid one", () => {
      const manager = newManager();
      const current = manager.getState("batch-1");

      expect(() =>
        assertValidPayoutBatchRetryUpdate(current, {
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).not.toThrow();

      expect(() =>
        assertValidPayoutBatchRetryUpdate(current, {
          batchId: "batch-1",
          expectedVersion: 99,
          targetStatus: "failed",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).toThrow(PayoutBatchRetryStateError);
    });

    it("validates an untouched persisted snapshot", () => {
      const manager = newManager();
      const state = manager.getState("batch-1")!;

      expect(validatePayoutBatchRetryState(state)).toEqual({ isValid: true, issues: [] });
      expect(assertValidPayoutBatchRetryState(state)).toBe(state);
    });

    it("detects a hash mismatch at the boundary of a single changed field", () => {
      const manager = newManager();
      const state = manager.getState("batch-1")!;
      const tampered = { ...state, updatedBy: "operator-2" };

      const result = validatePayoutBatchRetryState(tampered);

      expect(result.isValid).toBe(false);
      expect(result.issues.map((entry) => entry.code)).toContain(
        PayoutBatchRetryStateErrorCode.INVALID_HASH
      );
      expect(() => assertValidPayoutBatchRetryState(tampered)).toThrow(
        PayoutBatchRetryStateError
      );
    });

    it("accumulates attempt, item, status, and identifier problems", () => {
      const manager = newManager();
      const state = manager.getState("batch-1")!;
      const invalid = {
        ...state,
        status: "bogus",
        attempt: 4,
        outstandingItemIds: ["item-a", "item-a"],
        updatedBy: "",
      } as unknown as PayoutBatchRetryState;

      const result = validatePayoutBatchRetryState(invalid);
      const codes = result.issues.map((entry) => entry.code);

      expect(result.isValid).toBe(false);
      expect(codes).toContain(PayoutBatchRetryStateErrorCode.INVALID_STATUS);
      expect(codes).toContain(PayoutBatchRetryStateErrorCode.ATTEMPTS_EXHAUSTED);
      expect(codes).toContain(PayoutBatchRetryStateErrorCode.INVALID_ITEM_SET);
      expect(codes).toContain(PayoutBatchRetryStateErrorCode.ACTOR_REQUIRED);
    });

    it("rejects malformed input objects without throwing", () => {
      expect(
        validatePayoutBatchRetryState(null as unknown as PayoutBatchRetryState)
      ).toMatchObject({ isValid: false });
      expect(
        validatePayoutBatchRetryUpdate(null, null as never)
      ).toMatchObject({ isValid: false });
    });
  });

  describe("history boundaries", () => {
    it("verifies the chain after the first and last allowed transition", () => {
      const manager = newManager();
      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        settledItemIds: ["item-a", "item-b", "item-c"],
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      manager.update({
        batchId: "batch-1",
        expectedVersion: 2,
        targetStatus: "completed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 2 * ONE_MINUTE,
      });

      expect(manager.getHistory("batch-1")).toHaveLength(3);
      expect(manager.verifyHistoryIntegrity("batch-1")).toEqual({ valid: true });
    });
  });
});
