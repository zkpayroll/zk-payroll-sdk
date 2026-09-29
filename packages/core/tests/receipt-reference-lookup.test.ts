import {
  resolveReceiptTransactionReference,
  findReceiptByTransactionHash,
  redactReceiptReferenceForLogging,
  maskTransactionHash,
  ReceiptReferenceCode,
  type TransactionReferenceInput,
} from "../src/receipts/referenceLookup";
import type { PayrollReceipt, PayrollTransactionReference } from "../src/receipts/types";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = 1_757_000_000_000;

function reference(
  overrides: Partial<PayrollTransactionReference> = {}
): PayrollTransactionReference {
  return { txHash: HASH_A, network: "testnet", ...overrides };
}

function receipt(overrides: Partial<PayrollReceipt> = {}): PayrollReceipt {
  return {
    receiptId: "rcpt_1",
    payrollId: "pr_1",
    settlementStatus: "settled",
    transactionReference: reference(),
    metadataDigest: HASH_B,
    issuedAt: NOW,
    ...overrides,
  };
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

describe("Payroll receipt reference lookup (#560)", () => {
  describe("resolveReceiptTransactionReference", () => {
    it("resolves a structured reference", () => {
      const resolved = resolveReceiptTransactionReference(
        reference({ ledger: 1234, contractId: "CDUMMY" })
      );

      expect(resolved.isPresent).toBe(true);
      expect(resolved.isValidHash).toBe(true);
      expect(resolved.txHash).toBe(HASH_A);
      expect(resolved.network).toBe("testnet");
      expect(resolved.ledger).toBe(1234);
      expect(resolved.contractId).toBe("CDUMMY");
      expect(resolved.issues).toHaveLength(0);
    });

    it("resolves a bare hash string the same way", () => {
      const structured = resolveReceiptTransactionReference(reference());
      const bare = resolveReceiptTransactionReference(HASH_A);

      expect(bare.txHash).toBe(structured.txHash);
      expect(bare.isValidHash).toBe(structured.isValidHash);
    });

    it("normalises a numeric-string network to lowercase", () => {
      const resolved = resolveReceiptTransactionReference(reference({ network: "TESTNET" }));
      expect(resolved.network).toBe("testnet");
    });

    it("reports an absent reference without throwing", () => {
      for (const input of [null, undefined, ""] as TransactionReferenceInput[]) {
        const resolved = resolveReceiptTransactionReference(input);
        expect(resolved.isPresent).toBe(false);
        expect(resolved.isValidHash).toBe(false);
        expect(codes(resolved.issues)).toEqual([ReceiptReferenceCode.MISSING]);
      }
    });

    it("reports a structured reference with no hash as missing", () => {
      const resolved = resolveReceiptTransactionReference({ txHash: "   " });
      expect(resolved.isPresent).toBe(false);
      expect(codes(resolved.issues)).toEqual([ReceiptReferenceCode.MISSING]);
    });

    it("flags a malformed hash as critical but still reports it as present", () => {
      const resolved = resolveReceiptTransactionReference("not-a-hash");

      expect(resolved.isPresent).toBe(true);
      expect(resolved.isValidHash).toBe(false);
      expect(resolved.txHash).toBe("not-a-hash");
      expect(codes(resolved.issues)).toContain(ReceiptReferenceCode.TX_HASH_MALFORMED);
      expect(
        resolved.issues.find((i) => i.code === ReceiptReferenceCode.TX_HASH_MALFORMED)?.critical
      ).toBe(true);
    });

    it("flags an unrecognized network as a non-critical issue", () => {
      const resolved = resolveReceiptTransactionReference(reference({ network: "devnet" }));

      expect(resolved.network).toBeUndefined();
      const issue = resolved.issues.find(
        (i) => i.code === ReceiptReferenceCode.NETWORK_UNRECOGNIZED
      );
      expect(issue?.critical).toBe(false);
    });

    it("flags an invalid ledger as a non-critical issue", () => {
      const resolved = resolveReceiptTransactionReference(reference({ ledger: -1 }));

      expect(resolved.ledger).toBeUndefined();
      expect(codes(resolved.issues)).toContain(ReceiptReferenceCode.LEDGER_INVALID);
    });

    it("normalises timestamps from ms, numeric strings, and ISO-8601", () => {
      const iso = new Date(NOW).toISOString();
      const resolved = resolveReceiptTransactionReference(
        reference({ submittedAt: NOW, confirmedAt: iso })
      );

      expect(resolved.submittedAt).toBe(NOW);
      expect(resolved.confirmedAt).toBe(NOW);
    });

    it("flags an unparseable timestamp as a non-critical issue", () => {
      const resolved = resolveReceiptTransactionReference(reference({ submittedAt: "not-a-date" }));

      expect(resolved.submittedAt).toBeUndefined();
      expect(codes(resolved.issues)).toContain(ReceiptReferenceCode.TIMESTAMP_UNPARSEABLE);
    });

    it("flags confirmedAt earlier than submittedAt as critical", () => {
      const resolved = resolveReceiptTransactionReference(
        reference({ submittedAt: NOW, confirmedAt: NOW - 5_000 })
      );

      expect(codes(resolved.issues)).toContain(ReceiptReferenceCode.CONFIRMED_BEFORE_SUBMITTED);
      expect(
        resolved.issues.find((i) => i.code === ReceiptReferenceCode.CONFIRMED_BEFORE_SUBMITTED)
          ?.critical
      ).toBe(true);
    });
  });

  describe("findReceiptByTransactionHash", () => {
    it("finds the single receipt referencing a hash", () => {
      const result = findReceiptByTransactionHash(
        [
          receipt({ receiptId: "other", transactionReference: reference({ txHash: HASH_B }) }),
          receipt({ receiptId: "target" }),
        ],
        HASH_A
      );

      expect(result.isFound).toBe(true);
      expect(result.matchCount).toBe(1);
      expect(result.receipt?.receiptId).toBe("target");
      expect(result.resolved?.txHash).toBe(HASH_A);
    });

    it("matches case-insensitively", () => {
      const result = findReceiptByTransactionHash([receipt()], HASH_A.toUpperCase());
      expect(result.isFound).toBe(true);
      expect(result.queriedHash).toBe(HASH_A);
    });

    it("matches a bare-string reference", () => {
      const result = findReceiptByTransactionHash(
        [receipt({ transactionReference: HASH_B })],
        HASH_B
      );
      expect(result.isFound).toBe(true);
    });

    it("returns not-found for an unmatched hash", () => {
      const result = findReceiptByTransactionHash([receipt()], HASH_B);

      expect(result.isFound).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.receipt).toBeUndefined();
      expect(result.message).toMatch(/no receipt/i);
    });

    it("rejects a malformed query without scanning", () => {
      const result = findReceiptByTransactionHash([receipt()], "nope");

      expect(result.isFound).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.message).toMatch(/64-character hex/i);
    });

    it("surfaces an ambiguous match instead of picking one", () => {
      const result = findReceiptByTransactionHash(
        [receipt({ receiptId: "a" }), receipt({ receiptId: "b" })],
        HASH_A
      );

      expect(result.isFound).toBe(false);
      expect(result.matchCount).toBe(2);
      expect(result.receipt).toBeUndefined();
      expect(result.message).toMatch(/ambiguous/i);
    });

    it("ignores receipts whose own reference is malformed", () => {
      const result = findReceiptByTransactionHash(
        [receipt({ receiptId: "broken", transactionReference: "not-a-hash" }), receipt()],
        HASH_A
      );

      expect(result.isFound).toBe(true);
      expect(result.receipt?.receiptId).toBe("rcpt_1");
    });

    it("returns not-found for an empty receipt list", () => {
      const result = findReceiptByTransactionHash([], HASH_A);
      expect(result.isFound).toBe(false);
      expect(result.matchCount).toBe(0);
    });
  });

  describe("log safety", () => {
    it("masks the hash for logging", () => {
      const resolved = resolveReceiptTransactionReference(reference());
      const redacted = redactReceiptReferenceForLogging(resolved);

      expect(redacted.txHash).toBe(maskTransactionHash(HASH_A));
      expect(String(redacted.txHash)).not.toContain(HASH_A);
      expect(redacted.isValidHash).toBe(true);
      expect(redacted.hasSubmittedAt).toBe(false);
    });

    it("masks an absent reference with the placeholder", () => {
      const redacted = redactReceiptReferenceForLogging(resolveReceiptTransactionReference(null));
      expect(redacted.txHash).toBe("[REDACTED]");
    });

    it("never leaks payroll values from the receipt", () => {
      const resolved = resolveReceiptTransactionReference(
        receipt({
          totalAmount: 12_345_678n,
          currency: "XLM",
          recipientCount: 7,
          transactionReference: reference(),
        }).transactionReference
      );

      const serialized = JSON.stringify(redactReceiptReferenceForLogging(resolved));
      expect(serialized).not.toContain("12345678");
      expect(serialized).not.toContain("XLM");
      expect(serialized).not.toContain("pr_1");
    });

    it("masks short values entirely", () => {
      expect(maskTransactionHash("short")).toBe("****");
    });
  });
});
