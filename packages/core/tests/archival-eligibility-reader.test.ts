import {
  readArchivalEligibility,
  readBatchArchivalEligibility,
  isRunArchivable,
} from "../src/archive/archivalEligibilityReader";
import { PayrollRunItem } from "../src/archive/types";

describe("Archival Eligibility Reader", () => {
  const NOW = 1_700_000_000_000;

  function makeRun(overrides = {}) {
    return {
      runId: "run_payroll_2025_abc12345",
      status: "finalized",
      ...overrides,
    };
  }

  describe("readArchivalEligibility", () => {
    it("marks a finalized run with no age requirement as archivable", () => {
      const run = makeRun({ finalizedAt: NOW - 1_000 });
      const result = readArchivalEligibility(run, { referenceTime: NOW });

      expect(result.isArchivable).toBe(true);
      expect(result.meetsAgeRequirement).toBe(true);
      expect(result.evaluation.isEligible).toBe(true);
      expect(result.ageBlockerReason).toBeUndefined();
    });

    it("marks a finalized run meeting age requirement as archivable", () => {
      const minimumAgeMs = 24 * 3_600_000; // 24 hours
      const run = makeRun({ finalizedAt: NOW - 48 * 3_600_000 }); // 48 hours old
      const result = readArchivalEligibility(run, {
        minimumAgeMs,
        referenceTime: NOW,
      });

      expect(result.isArchivable).toBe(true);
      expect(result.meetsAgeRequirement).toBe(true);
      expect(result.ageMs).toBe(48 * 3_600_000);
    });

    it("blocks a finalized run NOT meeting age requirement with age reason", () => {
      const minimumAgeMs = 48 * 3_600_000; // 48 hours
      const run = makeRun({ finalizedAt: NOW - 12 * 3_600_000 }); // 12 hours old
      const result = readArchivalEligibility(run, {
        minimumAgeMs,
        referenceTime: NOW,
      });

      expect(result.isArchivable).toBe(false);
      expect(result.meetsAgeRequirement).toBe(false);
      expect(result.ageBlockerReason).toBeDefined();
      expect(result.ageBlockerReason).toContain("must wait approximately");
      expect(result.ageBlockerReason).toContain("hour(s) before archival");
      expect(result.evaluation.isEligible).toBe(true);
    });

    it("blocks a disputed run regardless of age", () => {
      const run = makeRun({
        status: "finalized",
        isDisputed: true,
        finalizedAt: NOW - 999 * 3_600_000,
      });
      const result = readArchivalEligibility(run, {
        minimumAgeMs: 0,
        referenceTime: NOW,
      });

      expect(result.isArchivable).toBe(false);
      expect(result.evaluation.isEligible).toBe(false);
      expect(result.evaluation.blockerCode).toBe("DISPUTED_RUN");
    });

    it("blocks an already archived run", () => {
      const run = makeRun({ status: "archived" });
      const result = readArchivalEligibility(run, { referenceTime: NOW });

      expect(result.isArchivable).toBe(false);
      expect(result.evaluation.isEligible).toBe(false);
      expect(result.evaluation.blockerCode).toBe("ALREADY_ARCHIVED");
    });

    it("blocks a run missing finalizedAt when age requirement is set", () => {
      const run = makeRun(); // no finalizedAt
      const result = readArchivalEligibility(run, {
        minimumAgeMs: 24 * 3_600_000,
        referenceTime: NOW,
      });

      expect(result.isArchivable).toBe(false);
      expect(result.meetsAgeRequirement).toBe(false);
      expect(result.ageBlockerReason).toContain("missing a finalization timestamp");
    });

    it("redacts run IDs in age blocker reasons by default", () => {
      const run = makeRun({
        runId: "run_payroll_2025_abc12345",
        finalizedAt: NOW - 1_000,
      });
      const result = readArchivalEligibility(run, {
        minimumAgeMs: 48 * 3_600_000,
        referenceTime: NOW,
        redact: true,
      });

      expect(result.ageBlockerReason).toBeDefined();
      expect(result.ageBlockerReason).not.toContain("run_payroll_2025_abc12345");
      expect(result.ageBlockerReason).toContain("run***345");
    });
  });

  describe("readBatchArchivalEligibility", () => {
    it("evaluates a batch with mixed results", () => {
      const runs = [
        makeRun({ runId: "run_ok_01_longid", finalizedAt: NOW - 72 * 3_600_000 }),
        makeRun({ runId: "run_young_02_longid", finalizedAt: NOW - 1_000 }),
        makeRun({ runId: "run_disputed_03_longid", status: "disputed" }),
        makeRun({ runId: "run_archived_04_longid", status: "archived" }),
        makeRun({ runId: "run_ok_05_longid", finalizedAt: NOW - 50 * 3_600_000 }),
      ];

      const batch = readBatchArchivalEligibility(runs, {
        minimumAgeMs: 24 * 3_600_000,
        referenceTime: NOW,
      });

      expect(batch.totalRuns).toBe(5);
      expect(batch.archivableCount).toBe(2);
      expect(batch.blockedCount).toBe(3);
      expect(batch.ageBlockedCount).toBe(1);
      expect(batch.results).toHaveLength(5);
      expect(batch.blockerSummary["DISPUTED_RUN"]).toBe(1);
      expect(batch.blockerSummary["ALREADY_ARCHIVED"]).toBe(1);
    });

    it("returns zero counts for an empty batch", () => {
      const batch = readBatchArchivalEligibility([], {
        referenceTime: NOW,
      });

      expect(batch.totalRuns).toBe(0);
      expect(batch.archivableCount).toBe(0);
      expect(batch.blockedCount).toBe(0);
      expect(batch.ageBlockedCount).toBe(0);
      expect(batch.results).toHaveLength(0);
      expect(batch.blockerSummary).toEqual({});
    });
  });

  describe("isRunArchivable", () => {
    it("returns true for an archivable run", () => {
      const run = makeRun({ finalizedAt: NOW - 72 * 3_600_000 });
      expect(
        isRunArchivable(run, {
          minimumAgeMs: 24 * 3_600_000,
          referenceTime: NOW,
        })
      ).toBe(true);
    });

    it("returns false for a run that does not meet age requirement", () => {
      const run = makeRun({ finalizedAt: NOW - 1_000 });
      expect(
        isRunArchivable(run, {
          minimumAgeMs: 24 * 3_600_000,
          referenceTime: NOW,
        })
      ).toBe(false);
    });

    it("returns false for a disputed run", () => {
      const run = makeRun({ isDisputed: true });
      expect(isRunArchivable(run)).toBe(false);
    });
  });
});
