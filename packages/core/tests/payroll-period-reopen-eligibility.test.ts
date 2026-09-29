import {
  DEFAULT_MAX_PERIOD_AGE_MS,
  evaluateBatchReopenEligibility,
  filterEligibleReopenPeriods,
  isPayrollPeriodReopenEligible,
  summarizeReopenEligibility,
} from "../src/payroll/payrollPeriodReopenEligibility";
import type { PayrollPeriod } from "../src/payroll/payrollPeriodReopenEligibility";

const createPeriod = (overrides: Partial<PayrollPeriod> = {}): PayrollPeriod => ({
  periodId: "period-2026-01",
  status: "closed",
  closedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
  ...overrides,
});

describe("isPayrollPeriodReopenEligible", () => {
  describe("valid periods", () => {
    it("marks a recently closed period as eligible", () => {
      const period = createPeriod();
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(true);
      expect(result.code).toBe("ELIGIBLE");
      expect(result.message).toContain("eligible");
    });

    it("accepts archived periods without locks", () => {
      const period = createPeriod({
        status: "archived",
        archiveLocked: false,
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(true);
      expect(result.code).toBe("ELIGIBLE");
    });

    it("honors custom max age option", () => {
      const period = createPeriod({
        closedAt: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days old
      });
      const result = isPayrollPeriodReopenEligible(period, {
        maxPeriodAgeMs: 90 * 24 * 60 * 60 * 1000, // 90 days
      });

      expect(result.eligible).toBe(true);
    });

    it("allows reopening with pending corrections if configured", () => {
      const period = createPeriod({
        hasPendingCorrections: true,
      });
      const result = isPayrollPeriodReopenEligible(period, {
        allowWithPendingCorrections: true,
      });

      expect(result.eligible).toBe(true);
    });
  });

  describe("invalid periods", () => {
    it("rejects periods with missing ID", () => {
      const period = createPeriod({
        periodId: "",
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("INVALID_PERIOD_ID");
    });

    it("rejects periods that don't exist", () => {
      const period = createPeriod({
        status: undefined,
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("PERIOD_NOT_FOUND");
    });

    it("rejects open periods", () => {
      const period = createPeriod({
        status: "open",
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("PERIOD_NOT_CLOSED");
    });

    it("rejects periods that are too old", () => {
      const period = createPeriod({
        closedAt: Date.now() - (DEFAULT_MAX_PERIOD_AGE_MS + 24 * 60 * 60 * 1000),
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("PERIOD_TOO_OLD");
      expect(result.daysSinceClosure).toBeGreaterThan(90);
    });

    it("rejects periods with pending corrections by default", () => {
      const period = createPeriod({
        hasPendingCorrections: true,
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("PENDING_CORRECTIONS");
    });

    it("rejects periods with settlement in progress", () => {
      const period = createPeriod({
        settlementInProgress: true,
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("SETTLEMENT_IN_PROGRESS");
    });

    it("rejects archived locked periods", () => {
      const period = createPeriod({
        status: "archived",
        archiveLocked: true,
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("ARCHIVE_LOCKED");
    });
  });

  describe("redaction", () => {
    it("masks period IDs in messages by default", () => {
      const period = createPeriod({
        periodId: "period-2026-01",
      });
      const result = isPayrollPeriodReopenEligible(period);

      expect(result.periodId).toMatch(/\.\.\./);
      expect(result.periodId).not.toContain("period-2026-01");
    });

    it("exposes full period ID when redaction is disabled", () => {
      const period = createPeriod({
        periodId: "period-2026-01",
      });
      const result = isPayrollPeriodReopenEligible(period, {
        redactPeriodId: false,
      });

      expect(result.periodId).toBe("period-2026-01");
    });
  });
});

describe("evaluateBatchReopenEligibility", () => {
  it("evaluates multiple periods at once", () => {
    const periods = [
      createPeriod({ periodId: "period-1", status: "closed" }),
      createPeriod({ periodId: "period-2", status: "open" }),
      createPeriod({ periodId: "period-3", status: "closed" }),
    ];

    const results = evaluateBatchReopenEligibility(periods);

    expect(results).toHaveLength(3);
    expect(results[0].eligible).toBe(true);
    expect(results[1].eligible).toBe(false);
    expect(results[2].eligible).toBe(true);
  });
});

describe("filterEligibleReopenPeriods", () => {
  it("returns only eligible periods", () => {
    const periods = [
      createPeriod({ periodId: "period-1", status: "closed" }),
      createPeriod({ periodId: "period-2", status: "open" }),
      createPeriod({ periodId: "period-3", status: "closed" }),
    ];

    const eligible = filterEligibleReopenPeriods(periods);

    expect(eligible).toHaveLength(2);
    expect(eligible.every((e) => e.result.eligible)).toBe(true);
  });
});

describe("summarizeReopenEligibility", () => {
  it("counts eligibility results correctly", () => {
    const periods = [
      createPeriod({ status: "closed" }),
      createPeriod({ status: "open" }),
      createPeriod({ status: "closed" }),
      createPeriod({ status: "closed", hasPendingCorrections: true }),
    ];

    const results = evaluateBatchReopenEligibility(periods);
    const summary = summarizeReopenEligibility(results);

    expect(summary.total).toBe(4);
    expect(summary.eligibleCount).toBe(2);
    expect(summary.ineligibleCount).toBe(2);
    expect(summary.reasonCounts).toHaveProperty("ELIGIBLE", 2);
    expect(summary.reasonCounts).toHaveProperty("PERIOD_NOT_CLOSED", 1);
    expect(summary.reasonCounts).toHaveProperty("PENDING_CORRECTIONS", 1);
  });
});
