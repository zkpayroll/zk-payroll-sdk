import {
  normalizePayrollSchedule,
  isValidTimezone,
  normalizePeriodString,
  formatScheduleSummary,
  ScheduleValidationError,
} from "../src/schedules/scheduleNormalizer";

describe("Payroll Schedule Normalization Helper (#275)", () => {
  const REF_TIME = Date.parse("2026-09-06T12:00:00.000Z");

  describe("normalizePayrollSchedule", () => {
    it("normalizes a standard ISO date and monthly frequency with default options", () => {
      const schedule = normalizePayrollSchedule(
        {
          date: "2026-09-15T00:00:00.000Z",
          timezone: "UTC",
          periodLabel: "2026-09",
        },
        { referenceTimestamp: REF_TIME }
      );

      expect(schedule.period).toBe("2026-09");
      expect(schedule.displayLabel).toBe("September 2026");
      expect(schedule.timezone).toBe("UTC");
      expect(schedule.frequency).toBe("monthly");
      expect(schedule.executionTimestamp).toBe(Date.parse("2026-09-15T00:00:00.000Z"));

      // 24 hours default lead time: 2026-09-14T00:00:00.000Z
      expect(schedule.cutoffTimestamp).toBe(Date.parse("2026-09-14T00:00:00.000Z"));
      expect(schedule.isCutoffPassed).toBe(false);
      expect(schedule.timeUntilCutoffMs).toBeGreaterThan(0);
    });

    it("evaluates isCutoffPassed as true when reference time is after cutoff", () => {
      const pastSchedule = normalizePayrollSchedule(
        {
          date: "2026-09-05T00:00:00.000Z", // execution was yesterday
          periodLabel: "2026-09",
        },
        { referenceTimestamp: REF_TIME }
      );

      expect(pastSchedule.isCutoffPassed).toBe(true);
      expect(pastSchedule.timeUntilCutoffMs).toBeLessThan(0);
    });

    it("respects explicit cutoffTimestamp and custom leadTimeHours", () => {
      const explicitCutoff = Date.parse("2026-09-10T12:00:00.000Z");
      const schedule = normalizePayrollSchedule({
        date: "2026-09-15T00:00:00.000Z",
        cutoffTimestamp: explicitCutoff,
      });

      expect(schedule.cutoffTimestamp).toBe(explicitCutoff);

      const customLeadSchedule = normalizePayrollSchedule({
        date: "2026-09-15T00:00:00.000Z",
        leadTimeHours: 48, // 2 days before
      });
      expect(customLeadSchedule.cutoffTimestamp).toBe(Date.parse("2026-09-13T00:00:00.000Z"));
    });

    it("computes correct cycle bounds for monthly schedules", () => {
      const schedule = normalizePayrollSchedule({
        date: "2026-09-20T10:00:00.000Z",
        frequency: "monthly",
      });

      expect(schedule.cycleStartDate).toBe("2026-09-01T00:00:00.000Z");
      expect(schedule.cycleEndDate).toBe("2026-09-30T23:59:59.999Z");
    });

    it("normalizes Date objects and epoch millisecond inputs seamlessly", () => {
      const dateObj = new Date("2026-10-01T09:00:00.000Z");
      const schedFromDate = normalizePayrollSchedule({ date: dateObj });
      expect(schedFromDate.period).toBe("2026-10");
      expect(schedFromDate.displayLabel).toBe("October 2026");

      const epochMs = dateObj.getTime();
      const schedFromEpoch = normalizePayrollSchedule({ date: epochMs });
      expect(schedFromEpoch.executionTimestamp).toBe(epochMs);
    });

    it("throws ScheduleValidationError on invalid timezone", () => {
      expect(() => {
        normalizePayrollSchedule({
          timezone: "Invalid/Fake_Zone_123",
        });
      }).toThrow(ScheduleValidationError);
    });

    it("throws ScheduleValidationError on unparseable date strings", () => {
      expect(() => {
        normalizePayrollSchedule({
          date: "not-a-valid-date-string",
        });
      }).toThrow(ScheduleValidationError);
    });
  });

  describe("normalizePeriodString", () => {
    it("handles canonical YYYY-MM without change", () => {
      expect(normalizePeriodString("2026-09")).toBe("2026-09");
      expect(normalizePeriodString("2025-12")).toBe("2025-12");
    });

    it("pads single-digit month strings", () => {
      expect(normalizePeriodString("2026-5")).toBe("2026-05");
      expect(normalizePeriodString("2026-9")).toBe("2026-09");
    });

    it("converts full and abbreviated month names", () => {
      expect(normalizePeriodString("September 2026")).toBe("2026-09");
      expect(normalizePeriodString("Sep 2026")).toBe("2026-09");
      expect(normalizePeriodString("January 2027")).toBe("2027-01");
      expect(normalizePeriodString("2027 Oct")).toBe("2027-10");
    });
  });

  describe("isValidTimezone", () => {
    it("recognizes standard IANA timezones", () => {
      expect(isValidTimezone("UTC")).toBe(true);
      expect(isValidTimezone("America/New_York")).toBe(true);
      expect(isValidTimezone("Europe/London")).toBe(true);
      expect(isValidTimezone("Asia/Kathmandu")).toBe(true);
      expect(isValidTimezone("Asia/Tokyo")).toBe(true);
    });

    it("returns false for malformed or nonexistent timezones", () => {
      expect(isValidTimezone("Mars/Olympus")).toBe(false);
      expect(isValidTimezone("")).toBe(false);
      expect(isValidTimezone("random_text")).toBe(false);
    });
  });

  describe("formatScheduleSummary", () => {
    it("generates a clean human-readable schedule report", () => {
      const schedule = normalizePayrollSchedule(
        {
          date: "2026-09-15T00:00:00.000Z",
          periodLabel: "2026-09",
          timezone: "UTC",
        },
        { referenceTimestamp: REF_TIME }
      );

      const summary = formatScheduleSummary(schedule);
      expect(summary).toContain("Payroll Schedule: September 2026 [2026-09]");
      expect(summary).toContain("Frequency: monthly | Timezone: UTC");
      expect(summary).toContain("Cutoff: 2026-09-14T00:00:00.000Z [OPEN");
      expect(summary).toContain("Execution: 2026-09-15T00:00:00.000Z");
      expect(summary).toContain("Cycle: 2026-09-01T00:00:00.000Z to 2026-09-30T23:59:59.999Z");
    });
  });
});
