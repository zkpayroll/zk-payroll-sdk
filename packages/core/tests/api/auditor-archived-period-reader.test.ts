import {
  AuditorArchivedPeriodAccessError,
  assertAuditorArchivedPeriodAccess,
  readArchivedPayrollPeriodForAuditor,
} from "../../src/api/auditorArchivedPeriodReader";
import type { AuditGrantRecord } from "../../src/audit/grantScope";
import type { ArchivedRecord } from "../../src/archived/types";
import { ValidationError } from "../../src/core/errors";

describe("Auditor archived payroll period reads (#853)", () => {
  const auditorId = "GAUDITOR12345678901234567890123456789012345678901234567890";
  const now = new Date("2024-06-01T00:00:00Z");

  const sampleGrants: AuditGrantRecord[] = [
    {
      grantId: "grant-001",
      grantee: auditorId,
      scope: "read-only",
      grantedBy: "GADMIN12345678901234567890123456789012345678901234567890",
      grantedAt: "2024-01-01T00:00:00Z",
      expiresAt: "2024-12-31T23:59:59Z",
    },
  ];

  const sampleRecords: ArchivedRecord[] = [
    {
      id: "rec-1",
      recipient: "GRECIP1",
      amount: BigInt(5000),
      timestamp: Math.floor(new Date("2024-02-15T00:00:00Z").getTime() / 1000),
      asset: "USDC",
      status: "completed",
      archivedAt: Math.floor(new Date("2024-03-01T00:00:00Z").getTime() / 1000),
    },
    {
      id: "rec-2",
      recipient: "GRECIP2",
      amount: BigInt(6000),
      timestamp: Math.floor(new Date("2024-03-15T00:00:00Z").getTime() / 1000),
      asset: "USDC",
      status: "completed",
      archivedAt: Math.floor(new Date("2024-04-01T00:00:00Z").getTime() / 1000),
    },
    {
      id: "rec-3",
      recipient: "GRECIP3",
      amount: BigInt(7000),
      timestamp: Math.floor(new Date("2024-05-15T00:00:00Z").getTime() / 1000),
      asset: "native",
      status: "failed",
      archivedAt: Math.floor(new Date("2024-06-01T00:00:00Z").getTime() / 1000),
    },
  ];

  describe("authorized auditor reads", () => {
    it("successfully reads archived payroll records for a period within grant window", () => {
      const result = readArchivedPayrollPeriodForAuditor({
        auditorId,
        grants: sampleGrants,
        records: sampleRecords,
        periodStart: "2024-02-01T00:00:00.000Z",
        periodEnd: "2024-02-29T00:00:00.000Z",
        accessOptions: { now },
      });

      expect(result.ok).toBe(true);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].id).toBe("rec-1");
      expect(result.authorizedScope).toBe("read-only");
    });

    it("supports status filtering and returns readonly records", () => {
      const result = readArchivedPayrollPeriodForAuditor({
        auditorId,
        grants: sampleGrants,
        records: sampleRecords,
        periodStart: "2024-01-01T00:00:00.000Z",
        periodEnd: "2024-06-01T00:00:00.000Z",
        options: { status: "completed" },
        accessOptions: { now },
      });

      expect(result.ok).toBe(true);
      expect(result.records).toHaveLength(2);
      expect(result.records.map((r) => r.id)).toEqual(["rec-1", "rec-2"]);
      expect(Object.isFrozen(result.records)).toBe(true);
    });

    it("assertAuditorArchivedPeriodAccess passes when authorized", () => {
      const result = assertAuditorArchivedPeriodAccess({
        auditorId,
        grants: sampleGrants,
        records: sampleRecords,
        periodStart: "2024-03-01T00:00:00.000Z",
        periodEnd: "2024-03-31T23:59:59.000Z",
        accessOptions: { now },
      });

      expect(result.ok).toBe(true);
      expect(result.records[0].id).toBe("rec-2");
    });
  });

  describe("unauthorized denial and error handling", () => {
    it("denies access when auditor has no live grants", () => {
      const result = readArchivedPayrollPeriodForAuditor({
        auditorId: "GOTHERAUDITOR",
        grants: sampleGrants, // grants do not include this auditor
        records: sampleRecords,
        periodStart: "2024-02-01T00:00:00.000Z",
        periodEnd: "2024-02-28T23:59:59.000Z",
        accessOptions: { now },
      });

      expect(result.ok).toBe(false);
      expect(result.denialCode).toBe("NO_LIVE_GRANT");
      expect(result.records).toHaveLength(0);

      expect(() =>
        assertAuditorArchivedPeriodAccess({
          auditorId: "GOTHERAUDITOR",
          grants: sampleGrants,
          records: sampleRecords,
          periodStart: "2024-02-01T00:00:00.000Z",
          periodEnd: "2024-02-28T23:59:59.000Z",
          accessOptions: { now },
        })
      ).toThrow(AuditorArchivedPeriodAccessError);
    });

    it("denies access when period is before grant was issued", () => {
      const result = readArchivedPayrollPeriodForAuditor({
        auditorId,
        grants: sampleGrants, // issued 2024-01-01
        records: sampleRecords,
        periodStart: "2023-06-01T00:00:00.000Z",
        periodEnd: "2023-06-30T00:00:00.000Z",
        accessOptions: { now },
      });

      expect(result.ok).toBe(false);
      expect(result.denialCode).toBe("PERIOD_BEFORE_GRANT");
    });

    it("denies access when period exceeds maxLookbackMs", () => {
      // 30 days lookback max from 2024-06-01 -> only back to May 2, 2024
      const maxLookbackMs = 30 * 24 * 3600 * 1000;
      const result = readArchivedPayrollPeriodForAuditor({
        auditorId,
        grants: sampleGrants,
        records: sampleRecords,
        periodStart: "2024-02-01T00:00:00.000Z", // February is >30 days ago
        periodEnd: "2024-02-28T00:00:00.000Z",
        accessOptions: { now, maxLookbackMs },
      });

      expect(result.ok).toBe(false);
      expect(result.denialCode).toBe("PERIOD_OUTSIDE_LOOKBACK_WINDOW");
    });
  });

  describe("boundary validation and input safety", () => {
    it("throws ValidationError when periodStart is after periodEnd", () => {
      expect(() =>
        readArchivedPayrollPeriodForAuditor({
          auditorId,
          grants: sampleGrants,
          records: sampleRecords,
          periodStart: "2024-05-01T00:00:00.000Z",
          periodEnd: "2024-02-01T00:00:00.000Z",
          accessOptions: { now },
        })
      ).toThrow(ValidationError);
    });

    it("throws ValidationError when auditorId is empty", () => {
      expect(() =>
        readArchivedPayrollPeriodForAuditor({
          auditorId: "   ",
          grants: sampleGrants,
          records: sampleRecords,
          periodStart: "2024-02-01T00:00:00.000Z",
          periodEnd: "2024-02-28T00:00:00.000Z",
          accessOptions: { now },
        })
      ).toThrow(ValidationError);
    });
  });

  describe("privacy preservation", () => {
    it("redacts auditor identifier in error objects and never exposes secrets", () => {
      try {
        assertAuditorArchivedPeriodAccess({
          auditorId: "GAUDITORSECRET999999999999999999999999999999999999999999999",
          grants: sampleGrants,
          records: sampleRecords,
          periodStart: "2024-02-01T00:00:00.000Z",
          periodEnd: "2024-02-28T00:00:00.000Z",
          accessOptions: { now },
        });
        fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as AuditorArchivedPeriodAccessError;
        expect(error.name).toBe("AuditorArchivedPeriodAccessError");
        expect(error.redactedAuditorId).not.toBe(
          "GAUDITORSECRET999999999999999999999999999999999999999999999"
        );
        expect(error.redactedAuditorId).toContain("***");
      }
    });
  });
});
