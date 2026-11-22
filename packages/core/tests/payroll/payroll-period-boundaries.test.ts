/**
 * Boundary and unit tests for payroll period boundaries (#876).
 */

import {
  validatePayrollPeriod,
  assertValidPayrollPeriod,
  PayrollPeriodInput,
} from "../../src/payroll/periodValidation";
import {
  PayrollPeriodError,
} from "../../src/payroll/periodErrors";
import {
  PayrollPeriodStateManager,
} from "../../src/payroll/periodStateManager";

const VALID_EMPLOYER = "GBZXN7PIRZGNMHGA72XZBTWNTVANANCGICPOZS5JUU5PNO773VO4Q2L7";

describe("Payroll Period Boundaries (#874, #875, #876, #878)", () => {
  const baseStart = 1_700_000_000_000;
  const oneHour = 3_600_000;
  const oneDay = 86_400_000;
  const oneWeek = 7 * oneDay;

  describe("Validation Success Cases", () => {
    it("validates a standard weekly payroll period", () => {
      const input: PayrollPeriodInput = {
        periodId: "2026-W47",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart + oneWeek,
        cutoff: baseStart + 5 * oneDay,
        settlementDate: baseStart + oneWeek + oneDay,
        frequency: "WEEKLY",
      };

      const result = validatePayrollPeriod(input);
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(() => assertValidPayrollPeriod(input)).not.toThrow();
    });

    it("accepts exact minimum duration boundary (1 hour)", () => {
      const input: PayrollPeriodInput = {
        periodId: "MIN-HOUR",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart + oneHour,
      };

      const result = validatePayrollPeriod(input);
      expect(result.isValid).toBe(true);
    });
  });

  describe("Boundary & Rejection Cases (#876)", () => {
    it("rejects period with duration < 1 hour", () => {
      const input: PayrollPeriodInput = {
        periodId: "TOO-SHORT",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart + oneHour - 1, // 1 ms short
      };

      const result = validatePayrollPeriod(input);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("PERIOD_TOO_SHORT");
    });

    it("rejects start equal to end", () => {
      const input: PayrollPeriodInput = {
        periodId: "ZERO-DURATION",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart,
      };

      const result = validatePayrollPeriod(input);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("PERIOD_END_BEFORE_START");
    });

    it("rejects cutoff after period end", () => {
      const input: PayrollPeriodInput = {
        periodId: "BAD-CUTOFF",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart + oneWeek,
        cutoff: baseStart + oneWeek + 1000,
      };

      const result = validatePayrollPeriod(input);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("INVALID_CUTOFF_DATE");
    });

    it("rejects settlement date before period end", () => {
      const input: PayrollPeriodInput = {
        periodId: "EARLY-SETTLE",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart + oneWeek,
        settlementDate: baseStart + oneWeek - 1000,
      };

      const result = validatePayrollPeriod(input);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe("INVALID_SETTLEMENT_DATE");
    });

    it("detects overlapping periods for same employer", () => {
      const existing: PayrollPeriodInput = {
        periodId: "PERIOD-1",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart + oneWeek,
      };

      const overlappingInput: PayrollPeriodInput = {
        periodId: "PERIOD-2",
        employer: VALID_EMPLOYER,
        start: baseStart + 3 * oneDay, // overlaps with PERIOD-1
        end: baseStart + 10 * oneDay,
      };

      const result = validatePayrollPeriod(overlappingInput, [existing]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === "OVERLAPPING_PERIODS")).toBe(true);
    });
  });

  describe("PayrollPeriodStateManager Hardened State (#878)", () => {
    let manager: PayrollPeriodStateManager;

    beforeEach(() => {
      manager = new PayrollPeriodStateManager();
    });

    it("registers and advances state with hash chaining", () => {
      const input: PayrollPeriodInput = {
        periodId: "PERIOD-STATE",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart + oneWeek,
      };

      const record = manager.registerPeriod(input, baseStart);
      expect(record.status).toBe("DRAFT");
      expect(record.version).toBe(1);
      expect(manager.verifyIntegrity("PERIOD-STATE")).toBe(true);

      const opened = manager.transitionStatus("PERIOD-STATE", "OPEN");
      expect(opened.status).toBe("OPEN");
      expect(opened.version).toBe(2);
      expect(manager.verifyIntegrity("PERIOD-STATE")).toBe(true);

      const closed = manager.transitionStatus("PERIOD-STATE", "CLOSED");
      expect(closed.status).toBe("CLOSED");
    });

    it("blocks modifying closed period without override", () => {
      const input: PayrollPeriodInput = {
        periodId: "CLOSED-GUARD",
        employer: VALID_EMPLOYER,
        start: baseStart,
        end: baseStart + oneWeek,
      };

      manager.registerPeriod(input);
      manager.transitionStatus("CLOSED-GUARD", "CLOSED");

      expect(() => manager.transitionStatus("CLOSED-GUARD", "OPEN")).toThrow(
        PayrollPeriodError
      );

      // Overriding works with explicit flag
      const reopened = manager.transitionStatus("CLOSED-GUARD", "OPEN", true);
      expect(reopened.status).toBe("OPEN");
    });
  });
});
