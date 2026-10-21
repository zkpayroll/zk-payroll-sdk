import {
  validatePaymentInstructionExpiry,
  validatePaymentInstructionExpiryBatch,
  isPaymentInstructionValid,
  getTimeUntilPaymentInstructionExpiry,
  validatePayrollAdjustmentApprovalExpiry,
  validatePayoutPrecision,
  validatePayoutPrecisionBatch,
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

  describe("validatePayrollAdjustmentApprovalExpiry", () => {
    it("validates a non-expired approval", () => {
      const result = validatePayrollAdjustmentApprovalExpiry(
        {
          adjustmentId: "ADJ001",
          approvalExpiryTimestamp: now + 10000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
      expect(result.timeUntilExpiry).toBe(10000);
    });

    it("rejects an expired approval", () => {
      const result = validatePayrollAdjustmentApprovalExpiry(
        {
          adjustmentId: "ADJ001",
          approvalExpiryTimestamp: now - 5000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("APPROVAL_EXPIRED");
      expect(result.violation?.message).toContain("expired");
    });

    it("handles invalid approval expiry timestamps", () => {
      const result = validatePayrollAdjustmentApprovalExpiry(
        {
          adjustmentId: "ADJ001",
          approvalExpiryTimestamp: NaN,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_EXPIRY_TIMESTAMP");
    });

    it("rejects approval expiry in the past", () => {
      const result = validatePayrollAdjustmentApprovalExpiry(
        {
          adjustmentId: "ADJ001",
          approvalExpiryTimestamp: -1000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("EXPIRY_IN_PAST");
    });

    it("applies grace period correctly", () => {
      const result = validatePayrollAdjustmentApprovalExpiry(
        {
          adjustmentId: "ADJ001",
          approvalExpiryTimestamp: now - 5000,
        },
        { currentTime: now, gracePeriod: 10000 }
      );

      expect(result.isValid).toBe(true);
      expect(result.timeUntilExpiry).toBe(5000);
    });

    it("redacts adjustment ID by default", () => {
      const result = validatePayrollAdjustmentApprovalExpiry(
        {
          adjustmentId: "ADJ_SECRET_001",
          approvalExpiryTimestamp: now - 5000,
        },
        { currentTime: now }
      );

      expect(result.violation?.redactedInstructionId).not.toContain(
        "ADJ_SECRET_001"
      );
      expect(result.violation?.message).toContain("ADJ_SECRET_001");
      expect(result.violation?.redactedMessage).not.toContain("ADJ_SECRET_001");
    });

    it("shows adjustment ID when redaction is disabled", () => {
      const result = validatePayrollAdjustmentApprovalExpiry(
        {
          adjustmentId: "ADJ001",
          approvalExpiryTimestamp: now - 5000,
        },
        { currentTime: now, redactInstructionId: false }
      );

      expect(result.violation?.message).toContain("ADJ001");
      expect(result.violation?.redactedMessage).not.toContain("ADJ001");
    });

    it("handles missing adjustment ID", () => {
      const result = validatePayrollAdjustmentApprovalExpiry(
        {
          approvalExpiryTimestamp: now + 5000,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
    });
  });

  describe("validatePayoutPrecision", () => {
    it("validates a payout amount with exact precision", () => {
      const result = validatePayoutPrecision(
        {
          instructionId: "INSTR001",
          amount: 1234.56,
          decimals: 2,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
      expect(result.normalizedAmount).toBe("1234.56");
    });

    it("rejects a payout amount with excess precision", () => {
      const result = validatePayoutPrecision(
        {
          instructionId: "INSTR001",
          amount: 1234.567,
          decimals: 2,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("EXCESS_PRECISION");
      expect(result.violation?.message).toContain("precision");
    });

    it("rejects invalid payout amounts", () => {
      const result = validatePayoutPrecision(
        {
          instructionId: "INSTR001",
          amount: NaN,
          decimals: 2,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_AMOUNT");
    });

    it("rejects negative payout amounts", () => {
      const result = validatePayoutPrecision(
        {
          instructionId: "INSTR001",
          amount: -10,
          decimals: 2,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_AMOUNT");
    });

    it("rejects invalid decimals configuration", () => {
      const result = validatePayoutPrecision(
        {
          instructionId: "INSTR001",
          amount: 10,
          decimals: -1,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_DECIMALS");
    });

    it("redacts instruction ID by default", () => {
      const result = validatePayoutPrecision(
        {
          instructionId: "SECRET_PAYOUT_ID_12345",
          amount: 1.234,
          decimals: 2,
        },
        { currentTime: now }
      );

      expect(result.violation?.redactedInstructionId).not.toContain(
        "SECRET_PAYOUT_ID_12345"
      );
      expect(result.violation?.message).toContain("SECRET_PAYOUT_ID_12345");
      expect(result.violation?.redactedMessage).not.toContain(
        "SECRET_PAYOUT_ID_12345"
      );
    });

    it("shows instruction ID when redaction is disabled", () => {
      const result = validatePayoutPrecision(
        {
          instructionId: "INSTR001",
          amount: 1.234,
          decimals: 2,
        },
        { currentTime: now, redactInstructionId: false }
      );

      expect(result.violation?.message).toContain("INSTR001");
      expect(result.violation?.redactedMessage).not.toContain("INSTR001");
    });

    it("handles missing instruction ID", () => {
      const result = validatePayoutPrecision(
        {
          amount: 10.5,
          decimals: 2,
        },
        { currentTime: now }
      );

      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
    });
  });

  describe("validatePayoutPrecisionBatch", () => {
    it("validates multiple payout amounts", () => {
      const entries = [
        { instructionId: "INSTR001", amount: 10.5, decimals: 2 },
        { instructionId: "INSTR002", amount: 20, decimals: 2 },
        { instructionId: "INSTR003", amount: 30.99, decimals: 2 },
      ];

      const results = validatePayoutPrecisionBatch(entries, {
        currentTime: now,
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.isValid)).toBe(true);
    });

    it("reports violations for mixed valid and invalid", () => {
      const entries = [
        { instructionId: "INSTR001", amount: 10.5, decimals: 2 },
        { instructionId: "INSTR002", amount: 10.555, decimals: 2 },
        { instructionId: "INSTR003", amount: 30.99, decimals: 2 },
      ];

      const results = validatePayoutPrecisionBatch(entries, {
        currentTime: now,
      });

      expect(results[0].isValid).toBe(true);
      expect(results[1].isValid).toBe(false);
      expect(results[1].violation?.code).toBe("EXCESS_PRECISION");
      expect(results[2].isValid).toBe(true);
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
