import {
  AuditReceipt,
  serializeAuditReceipt,
  deserializeAuditReceipt,
  validateAuditReceiptShape,
} from "../src/audit/auditReceiptSerializer";

describe("auditReceiptSerializer", () => {
  const mockReceipt: AuditReceipt = {
    receiptId: "rcpt_12345",
    payrollId: "pay_98765",
    timestamp: "2026-07-27T12:00:00.000Z",
    totalAmount: "15000000000",
    currency: "USDC",
    recipientCount: 25,
    viewKeyId: "vk_abc123",
    complianceHash: "0xabcdef1234567890",
    redacted: false,
    metadata: {
      department: "Engineering",
      auditorEmail: "audit@company.com",
    },
  };

  describe("validateAuditReceiptShape", () => {
    it("validates valid AuditReceipt shape", () => {
      expect(validateAuditReceiptShape(mockReceipt)).toBe(true);
    });

    it("rejects invalid or incomplete shapes", () => {
      expect(validateAuditReceiptShape(null)).toBe(false);
      expect(validateAuditReceiptShape({ receiptId: "123" })).toBe(false);
    });
  });

  describe("serializeAuditReceipt", () => {
    it("serializes receipt to JSON string", () => {
      const json = serializeAuditReceipt(mockReceipt);
      expect(typeof json).toBe("string");
      const parsed = JSON.parse(json);
      expect(parsed.receiptId).toBe("rcpt_12345");
      expect(parsed.redacted).toBe(false);
    });

    it("redacts PII fields when redactPII option is true", () => {
      const json = serializeAuditReceipt(mockReceipt, { redactPII: true });
      const parsed = JSON.parse(json);
      expect(parsed.redacted).toBe(true);
      expect(parsed.metadata.auditorEmail).toBe("[REDACTED]");
      expect(parsed.metadata.department).toBe("Engineering");
    });
  });

  describe("deserializeAuditReceipt", () => {
    it("deserializes valid JSON string back to AuditReceipt", () => {
      const json = serializeAuditReceipt(mockReceipt);
      const restored = deserializeAuditReceipt(json);
      expect(restored).toEqual(mockReceipt);
    });

    it("throws error for malformed JSON or invalid schema", () => {
      expect(() => deserializeAuditReceipt("{ bad json")).toThrow();
      expect(() => deserializeAuditReceipt(JSON.stringify({ random: "data" }))).toThrow();
    });
  });
});
