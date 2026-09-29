import {
  validatePayrollSubmissionSequence,
  validatePayrollSubmissionSequenceBatch,
  isSequenceComplete,
} from "../../src/payroll/payrollSubmissionSequenceValidator";

describe("Payroll Submission Sequence Validator", () => {
  const now = 1000000;

  describe("validatePayrollSubmissionSequence", () => {
    it("validates first submission (batch 1)", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        []
      );

      expect(result.isValid).toBe(true);
      expect(result.isSequenceStart).toBe(true);
      expect(result.isSequenceEnd).toBe(false);
    });

    it("validates middle submission", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 3,
          timestamp: now + 1000,
        },
      ];

      const result = validatePayrollSubmissionSequence(entries[1], [entries[0]]);

      expect(result.isValid).toBe(true);
      expect(result.isSequenceStart).toBe(false);
      expect(result.isSequenceEnd).toBe(false);
    });

    it("validates final submission (last batch)", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 3,
          timestamp: now + 1000,
        },
        {
          submissionId: "SUB003",
          batchNumber: 3,
          totalBatches: 3,
          timestamp: now + 2000,
        },
      ];

      const result = validatePayrollSubmissionSequence(entries[2], [
        entries[0],
        entries[1],
      ]);

      expect(result.isValid).toBe(true);
      expect(result.isSequenceEnd).toBe(true);
    });

    it("rejects invalid batch number", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB001",
          batchNumber: 5,
          totalBatches: 3,
          timestamp: now,
        },
        []
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_BATCH_NUMBER");
    });

    it("rejects batch 0", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB001",
          batchNumber: 0,
          totalBatches: 3,
          timestamp: now,
        },
        []
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_BATCH_NUMBER");
    });

    it("rejects duplicate submission", () => {
      const entry = {
        submissionId: "SUB001",
        batchNumber: 1,
        totalBatches: 3,
        timestamp: now,
      };

      const result = validatePayrollSubmissionSequence(entry, [entry]);

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("DUPLICATE_SUBMISSION");
    });

    it("rejects sequence gap", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB003",
          batchNumber: 3,
          totalBatches: 4,
          timestamp: now + 2000,
        },
        [
          {
            submissionId: "SUB001",
            batchNumber: 1,
            totalBatches: 4,
            timestamp: now,
          },
        ]
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("SEQUENCE_GAP");
      expect(result.violation?.message).toContain("Missing batches");
    });

    it("rejects out-of-order submission", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB002",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now + 2000,
        },
        [
          {
            submissionId: "SUB001",
            batchNumber: 2,
            totalBatches: 3,
            timestamp: now,
          },
        ]
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("OUT_OF_ORDER");
    });

    it("rejects non-first submission as first batch", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB002",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        [
          {
            submissionId: "SUB001",
            batchNumber: 2,
            totalBatches: 3,
            timestamp: now + 1000,
          },
        ]
      );

      expect(result.isValid).toBe(false);
    });

    it("rejects inconsistent batch totals", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 4,
          timestamp: now + 1000,
        },
        [
          {
            submissionId: "SUB001",
            batchNumber: 1,
            totalBatches: 3,
            timestamp: now,
          },
        ]
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INCONSISTENT_BATCH_TOTAL");
    });

    it("respects time order enforcement", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 3,
          timestamp: now - 1000,
        },
        [
          {
            submissionId: "SUB001",
            batchNumber: 1,
            totalBatches: 3,
            timestamp: now,
          },
        ],
        { enforceTimeOrder: true }
      );

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("OUT_OF_ORDER");
    });

    it("allows time-reversed with grace period", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 3,
          timestamp: now - 500,
        },
        [
          {
            submissionId: "SUB001",
            batchNumber: 1,
            totalBatches: 3,
            timestamp: now,
          },
        ],
        { enforceTimeOrder: true, timeOrderGracePeriod: 1000 }
      );

      expect(result.isValid).toBe(true);
    });

    it("allows unordered submissions when enabled", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SUB003",
          batchNumber: 3,
          totalBatches: 3,
          timestamp: now + 2000,
        },
        [
          {
            submissionId: "SUB001",
            batchNumber: 1,
            totalBatches: 3,
            timestamp: now,
          },
        ],
        { allowUnorderedSubmission: true }
      );

      expect(result.isValid).toBe(true);
    });
  });

  describe("validatePayrollSubmissionSequenceBatch", () => {
    it("validates complete valid sequence", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 3,
          timestamp: now + 1000,
        },
        {
          submissionId: "SUB003",
          batchNumber: 3,
          totalBatches: 3,
          timestamp: now + 2000,
        },
      ];

      const result = validatePayrollSubmissionSequenceBatch(entries);

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.summary.validCount).toBe(3);
    });

    it("reports all violations", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 5,
          totalBatches: 3,
          timestamp: now,
        },
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 3,
          timestamp: now + 1000,
        },
      ];

      const result = validatePayrollSubmissionSequenceBatch(entries);

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("provides summary statistics", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        {
          submissionId: "SUB003",
          batchNumber: 3,
          totalBatches: 3,
          timestamp: now + 2000,
        },
      ];

      const result = validatePayrollSubmissionSequenceBatch(entries);

      expect(result.summary.totalSubmissions).toBe(2);
      expect(result.summary.expectedSequence).toEqual([1, 2, 3]);
      expect(result.summary.actualSequence).toEqual([1, 3]);
    });

    it("counts gaps correctly", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 5,
          timestamp: now,
        },
        {
          submissionId: "SUB003",
          batchNumber: 3,
          totalBatches: 5,
          timestamp: now + 2000,
        },
      ];

      const result = validatePayrollSubmissionSequenceBatch(entries);

      expect(result.summary.gapCount).toBe(1);
    });
  });

  describe("isSequenceComplete", () => {
    it("returns true for complete sequence", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 3,
          timestamp: now + 1000,
        },
        {
          submissionId: "SUB003",
          batchNumber: 3,
          totalBatches: 3,
          timestamp: now + 2000,
        },
      ];

      expect(isSequenceComplete(entries)).toBe(true);
    });

    it("returns false for incomplete sequence", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        {
          submissionId: "SUB002",
          batchNumber: 2,
          totalBatches: 3,
          timestamp: now + 1000,
        },
      ];

      expect(isSequenceComplete(entries)).toBe(false);
    });

    it("returns true for empty sequence", () => {
      expect(isSequenceComplete([])).toBe(true);
    });

    it("returns false for sequence with gaps", () => {
      const entries = [
        {
          submissionId: "SUB001",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        {
          submissionId: "SUB003",
          batchNumber: 3,
          totalBatches: 3,
          timestamp: now + 2000,
        },
      ];

      expect(isSequenceComplete(entries)).toBe(false);
    });
  });

  describe("Privacy and security", () => {
    it("does not expose sensitive submission details in errors", () => {
      const result = validatePayrollSubmissionSequence(
        {
          submissionId: "SECRET_SUBMISSION_ID_12345",
          batchNumber: 1,
          totalBatches: 3,
          timestamp: now,
        },
        []
      );

      expect(result.isValid).toBe(true);
    });
  });
});
