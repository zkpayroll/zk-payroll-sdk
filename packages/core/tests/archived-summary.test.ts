/**
 * Tests for buildArchiveSummaryReport (Tasks 8.2–8.4)
 * Requirements: 5.1–5.9, 6.4, 7.2
 */
import { buildArchiveSummaryReport } from "../src/archived/summary";
import { ArchiveFilterBuilder } from "../src/archived/ArchiveFilterBuilder";
import { ValidationError } from "../src/core/errors";
import {
  createExecutionSummary,
  successOutcome,
  failedOutcome,
  pendingOutcome,
} from "../src/summary/PayrollExecutionSummary";
import type { ArchivedRecord } from "../src/archived/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 0;

function makeRecord(overrides: Partial<ArchivedRecord> = {}): ArchivedRecord {
  const id = `sr${++_seq}`;
  return {
    id,
    recipient: `recipient-${id}`,
    amount: 1000n,
    timestamp: 1700000000 + _seq,
    archivedAt: 1700000001 + _seq,
    status: "completed",
    asset: "native",
    ...overrides,
  };
}

function emptyQuery() {
  return new ArchiveFilterBuilder().build();
}

// ---------------------------------------------------------------------------
// Unit tests (Task 8.4)
// ---------------------------------------------------------------------------

describe("buildArchiveSummaryReport", () => {
  describe("empty filtered result", () => {
    it("returns zero counts and empty assetBreakdown", () => {
      const report = buildArchiveSummaryReport([], emptyQuery());
      expect(report.totalCount).toBe(0);
      expect(report.completedCount).toBe(0);
      expect(report.failedCount).toBe(0);
      expect(report.assetBreakdown).toEqual({});
    });
  });

  describe("period strings from query", () => {
    it("copies periodStart and periodEnd verbatim", () => {
      const query = new ArchiveFilterBuilder().forPeriod("2024-01-01", "2024-12-31").build();
      const report = buildArchiveSummaryReport([], query);
      expect(report.periodStart).toBe("2024-01-01");
      expect(report.periodEnd).toBe("2024-12-31");
    });

    it("sets both to '' when no period is set", () => {
      const report = buildArchiveSummaryReport([], emptyQuery());
      expect(report.periodStart).toBe("");
      expect(report.periodEnd).toBe("");
    });
  });

  describe("count totals", () => {
    it("completedCount + failedCount === totalCount", () => {
      const records = [
        makeRecord({ status: "completed" }),
        makeRecord({ status: "failed" }),
        makeRecord({ status: "completed" }),
      ];
      const report = buildArchiveSummaryReport(records, emptyQuery());
      expect(report.totalCount).toBe(3);
      expect(report.completedCount).toBe(2);
      expect(report.failedCount).toBe(1);
      expect(report.completedCount + report.failedCount).toBe(report.totalCount);
    });
  });

  describe("assetBreakdown", () => {
    it("records missing asset are bucketed under 'unknown'", () => {
      const records = [makeRecord({ asset: undefined }), makeRecord({ asset: "" })];
      const report = buildArchiveSummaryReport(records, emptyQuery());
      expect(report.assetBreakdown["unknown"]).toBeDefined();
      expect(report.assetBreakdown["unknown"].totalCount).toBe(2);
    });

    it("groups by asset correctly", () => {
      const records = [
        makeRecord({ asset: "USDC", status: "completed" }),
        makeRecord({ asset: "USDC", status: "failed" }),
        makeRecord({ asset: "XLM", status: "completed" }),
      ];
      const report = buildArchiveSummaryReport(records, emptyQuery());
      expect(report.assetBreakdown["USDC"].totalCount).toBe(2);
      expect(report.assetBreakdown["USDC"].completedCount).toBe(1);
      expect(report.assetBreakdown["USDC"].failedCount).toBe(1);
      expect(report.assetBreakdown["XLM"].totalCount).toBe(1);
      expect(report.assetBreakdown["XLM"].completedCount).toBe(1);
    });

    it("sum of assetBreakdown totalCounts === report.totalCount", () => {
      const records = [
        makeRecord({ asset: "USDC" }),
        makeRecord({ asset: "XLM" }),
        makeRecord({ asset: "USDC" }),
        makeRecord({ asset: undefined }),
      ];
      const report = buildArchiveSummaryReport(records, emptyQuery());
      const sum = Object.values(report.assetBreakdown).reduce((acc, e) => acc + e.totalCount, 0);
      expect(sum).toBe(report.totalCount);
    });
  });

  describe("ValidationError for inverted period", () => {
    it("throws when periodStart > periodEnd", () => {
      const query = new ArchiveFilterBuilder().forPeriod("2024-12-31", "2024-01-01").build();
      expect(() => buildArchiveSummaryReport([], query)).toThrow(ValidationError);
    });

    it("thrown error has field 'periodStart'", () => {
      const query = new ArchiveFilterBuilder().forPeriod("2024-12-31", "2024-01-01").build();
      try {
        buildArchiveSummaryReport([], query);
      } catch (e) {
        expect((e as ValidationError).field).toBe("periodStart");
      }
    });

    it("thrown error message contains periodStart and periodEnd", () => {
      const query = new ArchiveFilterBuilder().forPeriod("2024-12-31", "2024-01-01").build();
      try {
        buildArchiveSummaryReport([], query);
      } catch (e) {
        const msg = (e as ValidationError).message;
        expect(msg).toContain("periodStart");
        expect(msg).toContain("periodEnd");
      }
    });
  });

  describe("generatedAt", () => {
    it("is a recent epoch millisecond timestamp", () => {
      const before = Date.now();
      const report = buildArchiveSummaryReport([], emptyQuery());
      const after = Date.now();
      expect(report.generatedAt).toBeGreaterThanOrEqual(before);
      expect(report.generatedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("report shape — privacy", () => {
    it("does not have recipient or amount fields", () => {
      const report = buildArchiveSummaryReport([makeRecord()], emptyQuery()) as unknown as Record<
        string,
        unknown
      >;
      expect(report["recipient"]).toBeUndefined();
      expect(report["amount"]).toBeUndefined();
      expect(report["recipients"]).toBeUndefined();
      expect(report["amounts"]).toBeUndefined();
    });
  });

  describe("compatibility with PayrollExecutionSummary (Requirement 6.4)", () => {
    it("completedCount matches successCount and failedCount matches failureCount", () => {
      const outcomes = [
        successOutcome("addr1", 1000n, "USDC"),
        successOutcome("addr2", 2000n, "USDC"),
        failedOutcome("addr3", 500n, "XLM"),
        pendingOutcome("addr4", 750n, "native"),
      ];
      const summary = createExecutionSummary(outcomes, 100);

      const now = Math.floor(Date.now() / 1000);
      const archived: ArchivedRecord[] = summary.results
        .filter((o) => o.status !== "pending")
        .map((o) => ({
          id: `${summary.timestamp}-${o.recipient}`,
          recipient: o.recipient,
          amount: o.amount,
          asset: o.asset,
          timestamp: now,
          archivedAt: now,
          status: o.status === "success" ? "completed" : "failed",
        }));

      const report = buildArchiveSummaryReport(archived, emptyQuery());
      expect(report.completedCount).toBe(summary.successCount);
      expect(report.failedCount).toBe(summary.failureCount);
    });
  });
});

// ---------------------------------------------------------------------------
// Property: totalCount = completedCount + failedCount (Task 8.2)
// Requirement: 5.6
// ---------------------------------------------------------------------------

describe("buildArchiveSummaryReport — totalCount invariant property", () => {
  const SAMPLES = 50;

  it("totalCount === completedCount + failedCount for any input", () => {
    for (let i = 0; i < SAMPLES; i++) {
      const count = Math.floor(Math.random() * 51); // 0–50
      const records = Array.from({ length: count }, () =>
        makeRecord({ status: Math.random() > 0.5 ? "completed" : "failed" })
      );

      const report = buildArchiveSummaryReport(records, emptyQuery());
      expect(report.totalCount).toBe(report.completedCount + report.failedCount);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: assetBreakdown partition invariant (Task 8.3)
// Requirement: 5.7
// ---------------------------------------------------------------------------

describe("buildArchiveSummaryReport — assetBreakdown partition invariant property", () => {
  const SAMPLES = 50;
  const ASSETS = ["USDC", "XLM", "EURC", "native", undefined];

  it("sum of assetBreakdown[asset].totalCount === report.totalCount", () => {
    for (let i = 0; i < SAMPLES; i++) {
      const count = Math.floor(Math.random() * 51);
      const records = Array.from({ length: count }, () => {
        const asset = ASSETS[Math.floor(Math.random() * ASSETS.length)];
        return makeRecord({
          status: Math.random() > 0.5 ? "completed" : "failed",
          asset,
        });
      });

      const report = buildArchiveSummaryReport(records, emptyQuery());
      const breakdownSum = Object.values(report.assetBreakdown).reduce(
        (acc, e) => acc + e.totalCount,
        0
      );
      expect(breakdownSum).toBe(report.totalCount);
    }
  });

  it("records with undefined asset are bucketed under 'unknown'", () => {
    for (let i = 0; i < SAMPLES; i++) {
      const count = Math.floor(Math.random() * 20) + 1;
      const records = Array.from({ length: count }, () => makeRecord({ asset: undefined }));

      const report = buildArchiveSummaryReport(records, emptyQuery());
      expect(report.assetBreakdown["unknown"]?.totalCount).toBe(count);
    }
  });
});
