/**
 * Tests for Transaction Hash Normalization in Receipt Helpers (#991)
 */

import {
  normalizeTransactionHash,
  safeNormalizeTransactionHash,
  isValidTransactionHash,
  formatTransactionHash,
} from "../../src/receipts/hashNormalization";
import {
  resolveReceiptTransactionReference,
  findReceiptByTransactionHash,
} from "../../src/receipts/referenceLookup";
import type { PayrollReceipt } from "../../src/receipts/types";

const VALID_HASH_LOWER = "a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890";
const VALID_HASH_UPPER = "A1B2C3D4E5F67890A1B2C3D4E5F67890A1B2C3D4E5F67890A1B2C3D4E5F67890";
const VALID_HASH_0X = `0x${VALID_HASH_LOWER}`;
const VALID_HASH_0X_UPPER = `0X${VALID_HASH_UPPER}`;

describe("Transaction Hash Normalization (#991)", () => {
  describe("normalizeTransactionHash", () => {
    it("returns lowercase 64-character hex string as-is", () => {
      expect(normalizeTransactionHash(VALID_HASH_LOWER)).toBe(VALID_HASH_LOWER);
    });

    it("normalizes uppercase hex strings to lowercase", () => {
      expect(normalizeTransactionHash(VALID_HASH_UPPER)).toBe(VALID_HASH_LOWER);
    });

    it("strips 0x and 0X prefixes", () => {
      expect(normalizeTransactionHash(VALID_HASH_0X)).toBe(VALID_HASH_LOWER);
      expect(normalizeTransactionHash(VALID_HASH_0X_UPPER)).toBe(VALID_HASH_LOWER);
    });

    it("trims surrounding whitespace", () => {
      expect(normalizeTransactionHash(`  ${VALID_HASH_0X}  \n`)).toBe(VALID_HASH_LOWER);
    });

    it("throws TypeError on non-string inputs", () => {
      expect(() => normalizeTransactionHash(null)).toThrow(TypeError);
      expect(() => normalizeTransactionHash(12345)).toThrow(TypeError);
      expect(() => normalizeTransactionHash({})).toThrow(TypeError);
    });

    it("throws TypeError on malformed hex strings", () => {
      expect(() => normalizeTransactionHash("")).toThrow(TypeError);
      expect(() => normalizeTransactionHash("a".repeat(63))).toThrow(TypeError);
      expect(() => normalizeTransactionHash("a".repeat(65))).toThrow(TypeError);
      expect(() => normalizeTransactionHash("g".repeat(64))).toThrow(TypeError);
      expect(() => normalizeTransactionHash("not-a-hash")).toThrow(TypeError);
    });
  });

  describe("safeNormalizeTransactionHash", () => {
    it("returns null for malformed or non-string inputs", () => {
      expect(safeNormalizeTransactionHash(null)).toBeNull();
      expect(safeNormalizeTransactionHash("invalid")).toBeNull();
      expect(safeNormalizeTransactionHash("")).toBeNull();
    });

    it("returns normalized hash for valid inputs", () => {
      expect(safeNormalizeTransactionHash(VALID_HASH_0X_UPPER)).toBe(VALID_HASH_LOWER);
    });
  });

  describe("isValidTransactionHash", () => {
    it("returns true for standard, uppercase, and 0x-prefixed hashes", () => {
      expect(isValidTransactionHash(VALID_HASH_LOWER)).toBe(true);
      expect(isValidTransactionHash(VALID_HASH_UPPER)).toBe(true);
      expect(isValidTransactionHash(VALID_HASH_0X)).toBe(true);
      expect(isValidTransactionHash(VALID_HASH_0X_UPPER)).toBe(true);
    });

    it("returns false for invalid inputs", () => {
      expect(isValidTransactionHash("")).toBe(false);
      expect(isValidTransactionHash("123")).toBe(false);
      expect(isValidTransactionHash(null)).toBe(false);
    });
  });

  describe("formatTransactionHash", () => {
    it("formats hash with 0x prefix", () => {
      expect(formatTransactionHash(VALID_HASH_LOWER, { prefix0x: true })).toBe(
        `0x${VALID_HASH_LOWER}`
      );
    });

    it("formats hash in uppercase with 0x prefix", () => {
      expect(formatTransactionHash(VALID_HASH_LOWER, { prefix0x: true, uppercase: true })).toBe(
        `0x${VALID_HASH_UPPER}`
      );
    });
  });

  describe("integration with receipt reference lookup", () => {
    it("normalizes 0x-prefixed and uppercase references", () => {
      const resolved = resolveReceiptTransactionReference(VALID_HASH_0X_UPPER);
      expect(resolved.isPresent).toBe(true);
      expect(resolved.isValidHash).toBe(true);
      expect(resolved.txHash).toBe(VALID_HASH_LOWER);
      expect(resolved.issues).toHaveLength(0);
    });

    it("finds receipt when querying with 0x-prefixed or uppercase hash", () => {
      const mockReceipt: PayrollReceipt = {
        receiptId: "rcpt_1",
        payrollId: "pr_1",
        settlementStatus: "settled",
        transactionReference: VALID_HASH_LOWER,
        metadataDigest: "d".repeat(64),
        issuedAt: 1700000000,
      };

      const result = findReceiptByTransactionHash([mockReceipt], VALID_HASH_0X_UPPER);
      expect(result.isFound).toBe(true);
      expect(result.receipt?.receiptId).toBe("rcpt_1");
      expect(result.resolved?.txHash).toBe(VALID_HASH_LOWER);
    });
  });
});
