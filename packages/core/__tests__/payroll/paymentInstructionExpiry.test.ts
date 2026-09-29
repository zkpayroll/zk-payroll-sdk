import {
  validatePaymentInstructionExpiry,
  validatePaymentInstructionExpiryBatch,
  isPaymentInstructionValid,
  getTimeUntilPaymentInstructionExpiry,
} from "../../src/payroll/paymentInstructionExpiry";

describe("Payment Instruction Expiry Helper", () => {
  const now = 1000000;

  describe("validatePaymentInstructionExpiry", () => {
    it("validates a non-expired instruction", () => {
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "INSTR001",
          expiryTimestamp: now + 10000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
      expect(result.timeUntilExpiry).toBe(10000);
    });

    it("rejects an expired instruction", () => {
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "INSTR001",
          expiryTimestamp: now - 5000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INSTRUCTION_EXPIRED");
      expect(result.violation?.message).toContain("expired");
    });

    it("handles invalid expiry timestamps", () => {
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "INSTR001",
          expiryTimestamp: NaN,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_EXPIRY_TIMESTAMP");
    });

    it("rejects expiry in the past", () => {
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "INSTR001",
          expiryTimestamp: -1000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("EXPIRY_IN_PAST");
    });

    it("applies grace period correctly", () => {
      const expiryTime = now - 5000;
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "INSTR001",
          expiryTimestamp: expiryTime,
        },
        { currentTime: now, gracePeriod: 10000 }
      );

      expect(result.isValid).toBe(true);
      expect(result.timeUntilExpiry).toBe(5000); // 10000 grace - 5000 expired
    });

    it("redacts instruction ID by default", () => {
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "INSTR001",
          expiryTimestamp: now - 5000,
        },
        { currentTime: now }
      );

      expect(result.violation?.redactedInstructionId).not.toContain("INSTR001");
      expect(result.violation?.message).toContain("INSTR001");
      expect(result.violation?.redactedMessage).not.toContain("INSTR001");
    });

    it("shows instruction ID when redaction is disabled", () => {
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "INSTR001",
          expiryTimestamp: now - 5000,
        },
        { currentTime: now, redactInstructionId: false }
      );

      expect(result.violation?.message).toContain("INSTR001");
      expect(result.violation?.redactedMessage).not.toContain("INSTR001");
    });

    it("handles missing instruction ID", () => {
      const result = validatePaymentInstructionExpiry(
        {
          expiryTimestamp: now + 5000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
    });
  });

  describe("validatePaymentInstructionExpiryBatch", () => {
    it("validates multiple instructions", () => {
      const entries = [
        { instructionId: "INSTR001", expiryTimestamp: now + 10000 },
        { instructionId: "INSTR002", expiryTimestamp: now + 20000 },
        { instructionId: "INSTR003", expiryTimestamp: now + 30000 },
      ];

      const results = validatePaymentInstructionExpiryBatch(entries, {
        currentTime: now,
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.isValid)).toBe(true);
    });

    it("reports violations for mixed valid and invalid", () => {
      const entries = [
        { instructionId: "INSTR001", expiryTimestamp: now + 10000 },
        { instructionId: "INSTR002", expiryTimestamp: now - 5000 },
        { instructionId: "INSTR003", expiryTimestamp: now + 30000 },
      ];

      const results = validatePaymentInstructionExpiryBatch(entries, {
        currentTime: now,
      });

      expect(results[0].isValid).toBe(true);
      expect(results[1].isValid).toBe(false);
      expect(results[2].isValid).toBe(true);
    });
  });

  describe("isPaymentInstructionValid", () => {
    it("returns true for non-expired instruction", () => {
      const isValid = isPaymentInstructionValid(now + 10000, now);
      expect(isValid).toBe(true);
    });

    it("returns false for expired instruction", () => {
      const isValid = isPaymentInstructionValid(now - 5000, now);
      expect(isValid).toBe(false);
    });

    it("respects grace period", () => {
      const isValid = isPaymentInstructionValid(now - 3000, now, 5000);
      expect(isValid).toBe(true);
    });
  });

  describe("getTimeUntilPaymentInstructionExpiry", () => {
    it("returns remaining time", () => {
      const remaining = getTimeUntilPaymentInstructionExpiry(now + 10000, now);
      expect(remaining).toBe(10000);
    });

    it("returns 0 for expired instruction", () => {
      const remaining = getTimeUntilPaymentInstructionExpiry(now - 5000, now);
      expect(remaining).toBe(0);
    });
  });

  describe("Privacy and security", () => {
    it("never exposes instruction ID in redacted messages", () => {
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "SECRET_INSTRUCTION_ID_12345",
          expiryTimestamp: now - 5000,
        },
        { currentTime: now }
      );

      expect(result.violation?.redactedMessage).not.toContain(
        "SECRET_INSTRUCTION_ID_12345"
      );
    });

    it("handles instructions with sensitive characters", () => {
      const result = validatePaymentInstructionExpiry(
        {
          instructionId: "INSTR@#$%^&*()",
          expiryTimestamp: now + 5000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
    });
  });
});
