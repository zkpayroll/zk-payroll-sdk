import {
  PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES,
  PayoutBatchRetryStateError,
  PayoutBatchRetryStateErrorCode,
  PayoutBatchRetryStateManager,
  formatPayoutBatchRetryStateError,
  getPayoutBatchRetryStateErrorMessage,
  isPayoutBatchRetryStateError,
} from "../../src/batches/retryState";
import { assertValidPayoutBatchRetryUpdate } from "../../src/batches/retryValidation";

const BASE_TIME = 1_700_000_000_000;
const SECRET = "SECRET-EMPLOYEE-RECIPIENT";

function newManager(): PayoutBatchRetryStateManager {
  const manager = new PayoutBatchRetryStateManager();
  manager.initializeBatch("batch-1", ["item-a"], {
    updatedBy: "operator-1",
    timestampMs: BASE_TIME,
  });
  return manager;
}

describe("Payout batch retry safe errors (#900)", () => {
  describe("detection and canonical messages", () => {
    it("recognizes typed and serialized retry-state errors", () => {
      const typed = new PayoutBatchRetryStateError(
        "raw detail",
        PayoutBatchRetryStateErrorCode.VERSION_MISMATCH
      );
      const serialized = { retryCode: PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED };

      expect(isPayoutBatchRetryStateError(typed)).toBe(true);
      expect(isPayoutBatchRetryStateError(serialized)).toBe(true);
      expect(getPayoutBatchRetryStateErrorMessage(typed)).toBe(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[PayoutBatchRetryStateErrorCode.VERSION_MISMATCH]
      );
      expect(getPayoutBatchRetryStateErrorMessage(serialized)).toBe(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED]
      );
    });

    it("never forwards arbitrary error text", () => {
      const fallback = getPayoutBatchRetryStateErrorMessage(new Error(SECRET));
      expect(fallback).toContain("payout batch retry error");
      expect(fallback).not.toContain(SECRET);
      expect(formatPayoutBatchRetryStateError(new Error(SECRET))).not.toContain(SECRET);
    });

    it("formats structured issues without echoing their raw message", () => {
      const formatted = formatPayoutBatchRetryStateError([
        {
          code: PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP,
          field: "timestampMs",
          message: SECRET,
        },
      ]);

      expect(formatted).toContain("[timestampMs]");
      expect(formatted).toContain(
        PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES[PayoutBatchRetryStateErrorCode.INVALID_TIMESTAMP]
      );
      expect(formatted).not.toContain(SECRET);
    });
  });

  describe("privacy-safe context", () => {
    it("drops non-allowlisted context keys", () => {
      const error = new PayoutBatchRetryStateError(
        "Retry context",
        PayoutBatchRetryStateErrorCode.VERSION_MISMATCH,
        {
          field: "expectedVersion",
          version: 4,
          recipient: SECRET,
          amount: 9_999,
        }
      );

      const serialized = JSON.stringify(error.context);
      expect(serialized).toContain("expectedVersion");
      expect(serialized).toContain("4");
      expect(serialized).not.toContain("recipient");
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain("amount");
      expect(serialized).not.toContain("9999");
    });

    it("attaches safe issues from typed validation assertions", () => {
      const manager = newManager();
      const current = manager.getState("batch-1")!;
      let thrown: unknown;
      try {
        assertValidPayoutBatchRetryUpdate(current, {
          batchId: "batch-1",
          expectedVersion: current.version + 1,
          targetStatus: "retrying",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + 1,
        });
      } catch (error) {
        thrown = error;
      }

      expect(isPayoutBatchRetryStateError(thrown)).toBe(true);
      const typed = thrown as PayoutBatchRetryStateError;
      expect(typed.retryCode).toBe(PayoutBatchRetryStateErrorCode.VERSION_MISMATCH);
      expect(typed.issues.length).toBeGreaterThan(0);
      expect(formatPayoutBatchRetryStateError(typed)).toContain("[");
    });
  });

  describe("integrity diagnostics", () => {
    it("reports hash-chain breaks with the actionable prefix", () => {
      const manager = newManager();
      const state = manager.getState("batch-1")!;
      manager.registerState({ ...state, status: "failed" });

      const report = manager.verifyHistoryIntegrity("batch-1");
      expect(report.valid).toBe(false);
      expect(report.reason).toContain("Integrity check failed: hash link broken at revision");
      expect(report.reason).not.toContain(SECRET);
    });
  });
});
