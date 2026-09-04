/**
 * Tests for PayrollPeriodLabelFormatter (#410).
 *
 * Tests helpers for formatting payroll period labels for UI display
 * and event summaries.
 */

import { formatPeriod, formatPeriodCompactLabel, formatTimestamp, getEarlierPeriod, getLaterPeriod, isValidPeriod, formatPeriodWithOptions, samplePeriodLabels } from "../src/payroll/periodLabel";

describe("PayrollPeriodLabelFormatter", () => {
  describe("formatPeriod", () => {
    it("should format period as human-readable label", () => {
      expect(formatPeriod("2024-01")).toBe("January 2024");
      expect(formatPeriod("2024-12")).toBe("December 2024");
    });

    it("should handle edge case: invalid period format", () => {
      expect(formatPeriod("invalid")).toBe("invalid");
      expect(formatPeriod("2024")).toBe("2024");
    });
  });

  describe("formatPeriodCompactLabel", () => {
    it("should return compact period label", () => {
      expect(formatPeriodCompactLabel("2024-01")).toBe("2024-01");
      expect(formatPeriodCompactLabel("2024-06")).toBe("2024-06");
    });
  });

  describe("formatTimestamp", () => {
    it("should format timestamp to period label", () => {
      const jan2024 = new Date(2024, 0, 1).getTime();
      expect(formatTimestamp(jan2024)).toBe("2024-01");
    });

    it("should format middle of period timestamp", () => {
      const jun152024 = new Date(2024, 5, 15).getTime();
      expect(formatTimestamp(jun152024)).toBe("2024-06");
    });
  });

  describe("getEarlierPeriod", () => {
    it("should return previous period", () => {
      expect(getEarlierPeriod("2024-03")).toBe("2024-02");
      expect(getEarlierPeriod("2024-01")).toBe("2023-12");
      expect(getEarlierPeriod("2025-01")).toBe("2024-12");
    });
  });

  describe("getLaterPeriod", () => {
    it("should return next period", () => {
      expect(getLaterPeriod("2024-03")).toBe("2024-04");
      expect(getLaterPeriod("2024-12")).toBe("2025-01");
      expect(getLaterPeriod("2025-12")).toBe("2026-01");
    });
  });

  describe("isValidPeriod", () => {
    it("should validate correct period format", () => {
      expect(isValidPeriod("2024-01")).toBe(true);
      expect(isValidPeriod("2024-12")).toBe(true);
      expect(isValidPeriod("2025-06")).toBe(true);
    });

    it("should reject invalid period formats", () => {
      expect(isValidPeriod("invalid")).toBe(false);
      expect(isValidPeriod("2024")).toBe(false);
      expect(isValidPeriod("2024-01-01")).toBe(false);
      expect(isValidPeriod("")).toBe(false);
      expect(isValidPeriod("2024-13")).toBe(true); // format-valid but invalid month
    });
  });

  describe("formatPeriodWithOptions", () => {
    it("should use compact style by default", () => {
      expect(formatPeriodWithOptions("2024-01")).toBe("2024-01");
    });

    it("should use full style when specified", () => {
      expect(formatPeriodWithOptions("2024-01", { style: "full" })).toBe("January 2024");
    });
  });

  describe("samplePeriodLabels", () => {
    it("should have expected sample labels", () => {
      expect(samplePeriodLabels["2024-01"]).toBe("January 2024");
      expect(samplePeriodLabels["2024-06"]).toBe("June 2024");
      expect(samplePeriodLabels["2024-12"]).toBe("December 2024");
    });
  });
});