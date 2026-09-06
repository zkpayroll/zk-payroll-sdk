import {
  classifyReconciliationStatus,
  applyManualReview,
  isReconciliationActionRequired,
  isReconciliationMatched,
  formatReconciliationStatus,
  RECONCILIATION_STATUS_BADGES,
  type ReconciliationClassification,
} from "../src/reconciliation/statusClassifier";
import type { ReconciliationDiffEntry, ReconciliationDiffResult } from "../src/reconciliation/types";

describe("Reconciliation Status Classifier (#291)", () => {
  const createMockEntry = (
    category: ReconciliationDiffEntry["category"],
    recipient = "GABC1234567890"
  ): ReconciliationDiffEntry => ({
    recipient,
    category,
    reason: `Test entry category ${category}`,
  });

  describe("Status Classifications", () => {
    it("classifies as 'matched' when all entries are match", () => {
      const entries: ReconciliationDiffEntry[] = [
        createMockEntry("match", "G1"),
        createMockEntry("match", "G2"),
        createMockEntry("match", "G3"),
      ];

      const result = classifyReconciliationStatus(entries);
      expect(result.status).toBe("matched");
      expect(result.requiresAction).toBe(false);
      expect(result.badge.label).toBe("MATCHED");
      expect(result.breakdown.matched).toBe(3);
      expect(result.breakdown.total).toBe(3);
      expect(isReconciliationMatched(result.status)).toBe(true);
    });

    it("classifies as 'pending' when all entries are still_pending", () => {
      const entries: ReconciliationDiffEntry[] = [
        createMockEntry("still_pending", "G1"),
        createMockEntry("still_pending", "G2"),
      ];

      const result = classifyReconciliationStatus(entries);
      expect(result.status).toBe("pending");
      expect(result.requiresAction).toBe(false);
      expect(result.badge.color).toBe("info");
      expect(result.summary).toContain("pending");
    });

    it("classifies as 'partial' when entries are a mix of match and still_pending", () => {
      const entries: ReconciliationDiffEntry[] = [
        createMockEntry("match", "G1"),
        createMockEntry("still_pending", "G2"),
      ];

      const result = classifyReconciliationStatus(entries);
      expect(result.status).toBe("partial");
      expect(result.requiresAction).toBe(false);
      expect(result.breakdown.matched).toBe(1);
      expect(result.breakdown.pending).toBe(1);
    });

    it("classifies as 'mismatched' when amount_mismatch or missing occurs", () => {
      const entries: ReconciliationDiffEntry[] = [
        createMockEntry("match", "G1"),
        createMockEntry("amount_mismatch", "G2"),
      ];

      const result = classifyReconciliationStatus(entries);
      expect(result.status).toBe("mismatched");
      expect(result.requiresAction).toBe(true);
      expect(isReconciliationActionRequired(result.status)).toBe(true);
      expect(result.badge.color).toBe("danger");
      expect(result.summary).toContain("discrepanc");
    });

    it("classifies as 'failed' when failed_mismatch occurs", () => {
      const entries: ReconciliationDiffEntry[] = [
        createMockEntry("match", "G1"),
        createMockEntry("failed_mismatch", "G2"),
      ];

      const result = classifyReconciliationStatus(entries);
      expect(result.status).toBe("failed");
      expect(result.requiresAction).toBe(true);
      expect(isReconciliationActionRequired(result.status)).toBe(true);
      expect(result.summary).toContain("failed or reverted on-chain");
    });

    it("classifies as 'manually_reviewed' when manualReview option is provided", () => {
      const entries: ReconciliationDiffEntry[] = [
        createMockEntry("amount_mismatch", "G1"),
      ];

      const result = classifyReconciliationStatus(entries, {
        manualReview: {
          reviewedBy: "GAUDITORKEY1234567890",
          reviewedAt: Date.now(),
          notes: "Approved minor discrepancy due to rounding fee offset",
        },
      });

      expect(result.status).toBe("manually_reviewed");
      expect(result.requiresAction).toBe(false);
      expect(result.manualReview?.reviewedBy).toBe("GAUDITORKEY1234567890");
      expect(result.summary).toContain("Approved minor discrepancy");
    });
  });

  describe("ReconciliationDiffResult Input Support", () => {
    it("correctly classifies a ReconciliationDiffResult object", () => {
      const diffResult: ReconciliationDiffResult = {
        entries: [
          createMockEntry("match", "G1"),
          createMockEntry("match", "G2"),
        ],
        counts: {
          match: 2,
          still_pending: 0,
          failed_mismatch: 0,
          amount_mismatch: 0,
          missing: 0,
          unexpected: 0,
        },
        isFullyReconciled: true,
        generatedAt: Date.now(),
      };

      const result = classifyReconciliationStatus(diffResult);
      expect(result.status).toBe("matched");
      expect(result.breakdown.total).toBe(2);
      expect(result.breakdown.matched).toBe(2);
    });

    it("works with payload containing counts dictionary without entries", () => {
      const payload = {
        counts: {
          match: 10,
          still_pending: 2,
        },
      };

      const result = classifyReconciliationStatus(payload);
      expect(result.status).toBe("partial");
      expect(result.breakdown.total).toBe(12);
      expect(result.breakdown.matched).toBe(10);
      expect(result.breakdown.pending).toBe(2);
    });
  });

  describe("applyManualReview", () => {
    it("attaches manual review record and updates classification", () => {
      const baseResult = classifyReconciliationStatus([
        createMockEntry("amount_mismatch", "G1"),
      ]);

      const reviewed = applyManualReview(baseResult, {
        reviewedBy: "GADMIN999",
        notes: "Audited manually by compliance desk",
        resolvedOutcome: "accepted_discrepancy",
      });

      expect(reviewed.status).toBe("manually_reviewed");
      expect(reviewed.requiresAction).toBe(false);
      expect(reviewed.manualReview?.notes).toBe("Audited manually by compliance desk");
    });

    it("sets requiresAction to true if manual review escalated the issue", () => {
      const baseResult = classifyReconciliationStatus([
        createMockEntry("failed_mismatch", "G1"),
      ]);

      const reviewed = applyManualReview(baseResult, {
        reviewedBy: "GADMIN999",
        notes: "Escalated for multisig remediation",
        resolvedOutcome: "escalated",
      });

      expect(reviewed.status).toBe("manually_reviewed");
      expect(reviewed.requiresAction).toBe(true);
    });

    it("throws error if manual review is missing reviewer or notes", () => {
      const baseResult = classifyReconciliationStatus([]);
      expect(() => {
        applyManualReview(baseResult, { reviewedBy: "", notes: "notes" });
      }).toThrow();
      expect(() => {
        applyManualReview(baseResult, { reviewedBy: "GADMIN", notes: "" });
      }).toThrow();
    });
  });

  describe("Edge cases & Formatting", () => {
    it("gracefully handles null and undefined inputs", () => {
      const r1 = classifyReconciliationStatus(null);
      expect(r1.status).toBe("pending");
      expect(r1.breakdown.total).toBe(0);

      const r2 = classifyReconciliationStatus(undefined);
      expect(r2.status).toBe("pending");
    });

    it("gracefully handles empty array input", () => {
      const r = classifyReconciliationStatus([]);
      expect(r.status).toBe("pending");
      expect(r.breakdown.total).toBe(0);
    });

    it("formats summary string for display cleanly", () => {
      const result = classifyReconciliationStatus([
        createMockEntry("match", "G1"),
        createMockEntry("match", "G2"),
      ]);
      const formatted = formatReconciliationStatus(result);
      expect(formatted).toContain("[MATCHED]");
      expect(formatted).toContain("Matched: 2/2");
    });

    it("verifies all canonical status badges exist", () => {
      const statuses = ["matched", "partial", "mismatched", "pending", "failed", "manually_reviewed"] as const;
      for (const s of statuses) {
        expect(RECONCILIATION_STATUS_BADGES[s]).toBeDefined();
        expect(RECONCILIATION_STATUS_BADGES[s].label).toBeTruthy();
        expect(RECONCILIATION_STATUS_BADGES[s].color).toBeTruthy();
      }
    });
  });
});
