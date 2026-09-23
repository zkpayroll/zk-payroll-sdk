import {
  validateSettlementReceiptId,
  assertValidSettlementReceiptId,
  isSettlementReceiptId,
  redactReceiptId,
  formatSettlementReceiptLabel,
  MIN_RECEIPT_ID_LENGTH,
  MAX_RECEIPT_ID_LENGTH,
  STANDARD_RECEIPT_PREFIXES,
} from "../src/settlement";

describe("Settlement Receipt ID Validator", () => {
  describe("redactReceiptId", () => {
    it("redacts receipt identifiers to protect sensitive settlement references", () => {
      expect(redactReceiptId("rcpt_9876543210abcdef")).toBe("rcp***def");
      expect(redactReceiptId("settle_12345678")).toBe("set***678");
      expect(redactReceiptId("abc")).toBe("[REDACTED_RECEIPT]");
      expect(redactReceiptId("")).toBe("[ANONYMOUS_RECEIPT]");
      expect(redactReceiptId(undefined)).toBe("[ANONYMOUS_RECEIPT]");
    });
  });

  describe("validateSettlementReceiptId — success paths", () => {
    it("accepts valid prefixed receipt identifiers", () => {
      const validIds = [
        "rcpt_1234567890",
        "settle_9876543210",
        "zkpay_batch_00123",
        "rcpt-payroll-2025-04",
      ];
      for (const id of validIds) {
        const res = validateSettlementReceiptId(id);
        expect(res.isValid).toBe(true);
        expect(res.sanitizedReceiptId).toBe(id);
        expect(res.error).toBeUndefined();
      }
    });

    it("accepts valid alphanumeric hash receipt IDs", () => {
      const hexHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const res = validateSettlementReceiptId(hexHash);
      expect(res.isValid).toBe(true);
      expect(res.sanitizedReceiptId).toBe(hexHash);
    });

    it("trims outer whitespace automatically", () => {
      const res = validateSettlementReceiptId("   rcpt_123456789   ");
      expect(res.isValid).toBe(true);
      expect(res.sanitizedReceiptId).toBe("rcpt_123456789");
    });
  });

  describe("validateSettlementReceiptId — failure paths", () => {
    it("rejects non-string types", () => {
      expect(validateSettlementReceiptId(12345678).code).toBe("INVALID_TYPE");
      expect(validateSettlementReceiptId(null).code).toBe("INVALID_TYPE");
      expect(validateSettlementReceiptId(undefined).code).toBe("INVALID_TYPE");
      expect(validateSettlementReceiptId({}).code).toBe("INVALID_TYPE");
    });

    it("rejects empty or whitespace-only strings", () => {
      expect(validateSettlementReceiptId("").code).toBe("EMPTY_INPUT");
      expect(validateSettlementReceiptId("    ").code).toBe("EMPTY_INPUT");
    });

    it("rejects strings shorter than MIN_RECEIPT_ID_LENGTH", () => {
      const short = "rcpt_1"; // 6 chars < 8
      const res = validateSettlementReceiptId(short);
      expect(res.isValid).toBe(false);
      expect(res.code).toBe("TOO_SHORT");
      expect(res.error).toContain(`at least ${MIN_RECEIPT_ID_LENGTH} characters`);
    });

    it("rejects strings longer than MAX_RECEIPT_ID_LENGTH", () => {
      const long = "a".repeat(MAX_RECEIPT_ID_LENGTH + 1);
      const res = validateSettlementReceiptId(long);
      expect(res.isValid).toBe(false);
      expect(res.code).toBe("TOO_LONG");
      expect(res.error).toContain(`cannot exceed ${MAX_RECEIPT_ID_LENGTH} characters`);
    });

    it("rejects invalid characters like spaces, symbols, and punctuation", () => {
      const invalidChars = [
        "rcpt 12345678",
        "rcpt@12345678",
        "rcpt$12345678",
        "rcpt!12345678",
        "rcpt#12345678",
      ];
      for (const id of invalidChars) {
        const res = validateSettlementReceiptId(id);
        expect(res.isValid).toBe(false);
        expect(res.code).toBe("INVALID_CHARACTERS");
      }
    });

    it("rejects leading or trailing punctuation", () => {
      expect(validateSettlementReceiptId("-rcpt_12345678").code).toBe("INVALID_FORMAT");
      expect(validateSettlementReceiptId("rcpt_12345678-").code).toBe("INVALID_FORMAT");
      expect(validateSettlementReceiptId("_rcpt_12345678").code).toBe("INVALID_FORMAT");
      expect(validateSettlementReceiptId(".rcpt_12345678").code).toBe("INVALID_FORMAT");
    });
  });

  describe("assertValidSettlementReceiptId", () => {
    it("returns sanitized receipt ID on valid input", () => {
      expect(assertValidSettlementReceiptId("rcpt_12345678")).toBe("rcpt_12345678");
    });

    it("throws an error on invalid input", () => {
      expect(() => assertValidSettlementReceiptId("short")).toThrow(
        /Invalid settlement receipt ID/
      );
    });
  });

  describe("isSettlementReceiptId & formatSettlementReceiptLabel", () => {
    it("checks validity with boolean predicate", () => {
      expect(isSettlementReceiptId("rcpt_12345678")).toBe(true);
      expect(isSettlementReceiptId("short")).toBe(false);
    });

    it("formats human-readable receipt label with optional redaction", () => {
      const id = "rcpt_9876543210abcdef";
      expect(formatSettlementReceiptLabel(id)).toBe(`Receipt #${id}`);
      expect(formatSettlementReceiptLabel(id, { redact: true })).toBe("Receipt #rcp***def");
    });

    it("exports standard prefixes for developer reference", () => {
      expect(STANDARD_RECEIPT_PREFIXES).toContain("rcpt_");
      expect(STANDARD_RECEIPT_PREFIXES).toContain("settle_");
    });
  });
});
