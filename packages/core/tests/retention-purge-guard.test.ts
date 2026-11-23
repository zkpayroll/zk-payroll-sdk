import {
  isSettlementPending,
  assertRetentionPurgeAllowed,
  purgeRetentionRecords,
  RetentionPurgeBlockedError,
  RetentionPurgeRecord,
} from "../src/retention";

describe("SettlementRetentionGuard (#854)", () => {
  describe("isSettlementPending", () => {
    it("returns true for active/pending settlement statuses", () => {
      expect(isSettlementPending("pending")).toBe(true);
      expect(isSettlementPending("PROCESSING")).toBe(true);
      expect(isSettlementPending("in_flight")).toBe(true);
      expect(isSettlementPending("settling")).toBe(true);
    });

    it("returns false for non-pending or terminal settlement statuses", () => {
      expect(isSettlementPending("settled")).toBe(false);
      expect(isSettlementPending("finalized")).toBe(false);
      expect(isSettlementPending("failed")).toBe(false);
      expect(isSettlementPending("cancelled")).toBe(false);
      expect(isSettlementPending(null)).toBe(false);
      expect(isSettlementPending(undefined)).toBe(false);
    });
  });

  describe("assertRetentionPurgeAllowed", () => {
    it("allows purge when no settlement is pending", () => {
      expect(() => {
        assertRetentionPurgeAllowed({ settlementStatus: "settled" });
      }).not.toThrow();

      expect(() => {
        assertRetentionPurgeAllowed({});
      }).not.toThrow();
    });

    it("throws RetentionPurgeBlockedError when settlementStatus is pending", () => {
      expect(() => {
        assertRetentionPurgeAllowed({ settlementStatus: "pending" });
      }).toThrow(RetentionPurgeBlockedError);

      try {
        assertRetentionPurgeAllowed({ settlementStatus: "processing" });
      } catch (err) {
        expect(err).toBeInstanceOf(RetentionPurgeBlockedError);
        const safeErr = err as RetentionPurgeBlockedError;
        expect(safeErr.code).toBe("ERR_RETENTION_PURGE_BLOCKED_PENDING_SETTLEMENT");
        expect(safeErr.settlementStatus).toBe("processing");
        // Verify no private data is present in error message
        expect(safeErr.message).not.toContain("salary");
        expect(safeErr.message).not.toContain("employee");
      }
    });

    it("throws RetentionPurgeBlockedError when activeSettlementIds are present", () => {
      expect(() => {
        assertRetentionPurgeAllowed({ activeSettlementIds: ["settlement-123"] });
      }).toThrow(RetentionPurgeBlockedError);
    });

    it("bypasses block when force flag is set", () => {
      expect(() => {
        assertRetentionPurgeAllowed({
          settlementStatus: "pending",
          force: true,
        });
      }).not.toThrow();
    });
  });

  describe("purgeRetentionRecords", () => {
    const mockRecords: RetentionPurgeRecord[] = [
      { id: "rec-1", expiresAt: 1000 },
      { id: "rec-2", expiresAt: 2000 },
      { id: "rec-3", expiresAt: 3000 },
      { id: "rec-4" }, // no expiry (retained)
    ];

    it("purges expired records when settlement is not pending", () => {
      const result = purgeRetentionRecords(mockRecords, {
        settlementStatus: "settled",
        referenceTimeMs: 2500,
      });

      expect(result.purgedCount).toBe(2);
      expect(result.retainedCount).toBe(2);
      expect(result.purgedRecords.map((r) => r.id)).toEqual(["rec-1", "rec-2"]);
      expect(result.remainingRecords.map((r) => r.id)).toEqual(["rec-3", "rec-4"]);
    });

    it("blocks purge and throws when settlementStatus is pending", () => {
      expect(() => {
        purgeRetentionRecords(mockRecords, {
          settlementStatus: "in_flight",
          referenceTimeMs: 2500,
        });
      }).toThrow(RetentionPurgeBlockedError);
    });

    it("boundary: exact reference time comparison", () => {
      const result = purgeRetentionRecords(mockRecords, {
        settlementStatus: "finalized",
        referenceTimeMs: 2000,
      });

      expect(result.purgedCount).toBe(2);
      expect(result.purgedRecords.map((r) => r.id)).toEqual(["rec-1", "rec-2"]);
    });
  });
});
