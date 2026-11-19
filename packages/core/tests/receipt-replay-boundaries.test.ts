/**
 * Boundary tests for settlement receipt replay protection.
 *
 * Covers acceptance, duplicate-ID replays, receipt-ID collisions, transaction
 * reuse, normalization, capacity boundaries and verification integration.
 * All decision messages are checked for privacy (no receipt values).
 */

import {
  ReceiptReplayGuard,
  RECEIPT_REPLAY_CODES,
  ReceiptVerificationCode,
  type PayrollReceipt,
  verifyPayrollReceipt,
  verifyPayrollReceiptAsync,
  verifyPayrollReceiptBatch,
} from "../src/receipts";

const TX_HASH = "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0";
const OTHER_TX_HASH = "b1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef1";
const DIGEST = "c".repeat(64);
const OTHER_DIGEST = "d".repeat(64);
const SECRET = "employee-Ada-salary-999999";
const NOW = 1_800_000_000_000;

function makeReceipt(overrides: Partial<PayrollReceipt> = {}): PayrollReceipt {
  return {
    receiptId: "rcpt_boundary_0001",
    payrollId: "pr_run_2026_11",
    settlementStatus: "settled",
    transactionReference: { txHash: TX_HASH, network: "testnet" },
    metadataDigest: DIGEST,
    issuedAt: NOW,
    ...overrides,
  };
}

function expectPrivateDecision(decision: { accepted: boolean; message: string }): void {
  expect(decision.message).not.toContain(SECRET);
  expect(decision.message).not.toContain(TX_HASH);
  expect(decision.message).not.toContain(DIGEST);
}

describe("Settlement receipt replay boundaries", () => {
  describe("input boundaries", () => {
    it("rejects malformed receipts without changing the window", () => {
      const guard = new ReceiptReplayGuard();
      const invalid: unknown[] = [
        null,
        undefined,
        "rcpt_123",
        {},
        { ...makeReceipt(), receiptId: "  " },
        { ...makeReceipt(), payrollId: "" },
        { ...makeReceipt(), settlementStatus: "" },
        { ...makeReceipt(), metadataDigest: "" },
        { ...makeReceipt(), transactionReference: { txHash: "   " } },
      ];

      for (const candidate of invalid) {
        const decision = guard.inspect(candidate);
        expect(decision.accepted).toBe(false);
        expect(decision.code).toBe(RECEIPT_REPLAY_CODES.INVALID_RECEIPT);
        expectPrivateDecision(decision);
      }
      expect(guard.size).toBe(0);
    });

    it("rejects out-of-range capacity configuration", () => {
      const invalid = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 100_001];
      for (const maxEntries of invalid) {
        expect(() => new ReceiptReplayGuard({ maxEntries })).toThrow(RangeError);
      }
      expect(() => new ReceiptReplayGuard({ maxEntries: 1 })).not.toThrow();
      expect(() => new ReceiptReplayGuard({ maxEntries: 100_000 })).not.toThrow();
    });
  });

  describe("replay decisions", () => {
    it("accepts a first receipt and rejects an identical replay", () => {
      const guard = new ReceiptReplayGuard();
      const receipt = makeReceipt();

      expect(guard.record(receipt).code).toBe(RECEIPT_REPLAY_CODES.ACCEPTED);
      expect(guard.size).toBe(1);

      const replay = guard.record({ ...receipt, metadata: { employee: SECRET } });
      expect(replay.accepted).toBe(false);
      expect(replay.code).toBe(RECEIPT_REPLAY_CODES.DUPLICATE_RECEIPT_ID);
      expectPrivateDecision(replay);
      expect(guard.size).toBe(1);
    });

    it("normalizes whitespace in receipt IDs and case in transaction hashes", () => {
      const guard = new ReceiptReplayGuard();
      expect(
        guard.record(makeReceipt({ transactionReference: { txHash: TX_HASH.toUpperCase() } })).code
      ).toBe(RECEIPT_REPLAY_CODES.ACCEPTED);

      const replay = guard.record(
        makeReceipt({
          receiptId: "  rcpt_boundary_0001  ",
          transactionReference: TX_HASH,
        })
      );
      expect(replay.code).toBe(RECEIPT_REPLAY_CODES.DUPLICATE_RECEIPT_ID);
      expectPrivateDecision(replay);
    });

    it("rejects a reused transaction hash under a different receipt ID", () => {
      const guard = new ReceiptReplayGuard();
      guard.record(makeReceipt());

      const reused = guard.record(makeReceipt({ receiptId: "rcpt_boundary_0002" }));
      expect(reused.code).toBe(RECEIPT_REPLAY_CODES.DUPLICATE_TRANSACTION);
      expectPrivateDecision(reused);
      expect(guard.size).toBe(1);
    });

    it("rejects conflicting details for the same receipt ID", () => {
      const guard = new ReceiptReplayGuard({ maxEntries: 10 });
      guard.record(makeReceipt());

      const changedStatus = guard.record(makeReceipt({ settlementStatus: "pending" }));
      expect(changedStatus.code).toBe(RECEIPT_REPLAY_CODES.CONFLICTING_RECEIPT);

      const changedDigest = guard.record(makeReceipt({ metadataDigest: OTHER_DIGEST }));
      expect(changedDigest.code).toBe(RECEIPT_REPLAY_CODES.CONFLICTING_RECEIPT);

      const changedTx = guard.record(
        makeReceipt({ transactionReference: { txHash: OTHER_TX_HASH } })
      );
      expect(changedTx.code).toBe(RECEIPT_REPLAY_CODES.CONFLICTING_RECEIPT);

      expect(guard.size).toBe(1);
    });

    it("does not mutate on inspect and clears on reset", () => {
      const guard = new ReceiptReplayGuard();
      const receipt = makeReceipt();

      expect(guard.inspect(receipt).code).toBe(RECEIPT_REPLAY_CODES.ACCEPTED);
      expect(guard.size).toBe(0);
      guard.record(receipt);
      expect(guard.inspect(receipt).code).toBe(RECEIPT_REPLAY_CODES.DUPLICATE_RECEIPT_ID);
      guard.reset();
      expect(guard.size).toBe(0);
      expect(guard.inspect(receipt).code).toBe(RECEIPT_REPLAY_CODES.ACCEPTED);
    });
  });

  describe("window capacity", () => {
    it("evicts the oldest receipt at the exact capacity boundary", () => {
      const guard = new ReceiptReplayGuard({ maxEntries: 2 });
      const first = makeReceipt({ receiptId: "rcpt_boundary_0001" });
      const second = makeReceipt({
        receiptId: "rcpt_boundary_0002",
        transactionReference: { txHash: OTHER_TX_HASH },
      });
      const third = makeReceipt({
        receiptId: "rcpt_boundary_0003",
        transactionReference: { txHash: "e".repeat(64) },
      });

      expect(guard.record(first).accepted).toBe(true);
      expect(guard.record(second).accepted).toBe(true);
      expect(guard.record(third).accepted).toBe(true);
      expect(guard.size).toBe(2);

      // The evicted receipt can no longer be detected from the in-memory window.
      expect(guard.inspect(first).code).toBe(RECEIPT_REPLAY_CODES.ACCEPTED);
      expect(guard.inspect(second).code).toBe(RECEIPT_REPLAY_CODES.DUPLICATE_RECEIPT_ID);
    });
  });

  describe("verification integration", () => {
    const options = { replayGuard: new ReceiptReplayGuard(), currentTimestamp: NOW };

    beforeEach(() => options.replayGuard.reset());

    it("rejects a replayed receipt with a value-free verification issue", () => {
      const receipt = makeReceipt();
      const first = verifyPayrollReceipt(receipt, options);
      expect(first.isValid).toBe(true);

      const second = verifyPayrollReceipt(receipt, options);
      expect(second.isValid).toBe(false);
      const replayIssue = second.issues.find(
        (issue) => issue.code === ReceiptVerificationCode.RECEIPT_REPLAY
      );
      expect(replayIssue).toBeDefined();
      expect(replayIssue?.critical).toBe(true);
      expect(replayIssue?.message).not.toContain(SECRET);
      expect(replayIssue?.message).not.toContain(receipt.receiptId);
      expect(second.errors).toContain(replayIssue?.message);
    });

    it("records the receipt exactly once in async verification", async () => {
      const receipt = makeReceipt();
      const first = await verifyPayrollReceiptAsync(receipt, options);
      expect(first.isValid).toBe(true);
      expect(options.replayGuard.size).toBe(1);

      const replay = await verifyPayrollReceiptAsync(receipt, options);
      expect(replay.isValid).toBe(false);
      expect(options.replayGuard.size).toBe(1);
    });

    it("verifies each batch entry against the same window", () => {
      const receipt = makeReceipt();
      const other = makeReceipt({
        receiptId: "rcpt_boundary_0002",
        transactionReference: { txHash: OTHER_TX_HASH },
      });

      const results = verifyPayrollReceiptBatch([receipt, other, receipt], options);
      expect(results.map((result) => result.isValid)).toEqual([true, true, false]);
      expect(options.replayGuard.size).toBe(2);
    });
  });
});
