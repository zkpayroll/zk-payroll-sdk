import {
  getAuditorAccessExpiryStatus,
  formatAuditorAccessExpiry,
  formatBatchAuditorAccessExpiry,
  isAuditorAccessActive,
  isAuditorAccessExpiringSoon,
  redactAuditorId,
  DEFAULT_EXPIRING_SOON_THRESHOLD_MS,
  AuditorAccessExpiryInput,
} from "../src/audit/accessExpiry";

describe("Auditor Access Expiry Formatter", () => {
  const BASE_TIME = 1_700_000_000_000; // Fixed epoch reference timestamp
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * ONE_HOUR_MS;

  describe("redactAuditorId", () => {
    it("redacts auditor addresses and IDs to protect privacy", () => {
      expect(redactAuditorId("GABC1234567890XYZ")).toBe("GAB***XYZ");
      expect(redactAuditorId("auditor-alice")).toBe("aud***ice");
      expect(redactAuditorId("short")).toBe("[REDACTED_AUDITOR]");
      expect(redactAuditorId("")).toBe("[ANONYMOUS_AUDITOR]");
      expect(redactAuditorId(undefined)).toBe("[ANONYMOUS_AUDITOR]");
    });
  });

  describe("getAuditorAccessExpiryStatus", () => {
    it("returns 'unknown' when expiration is missing or invalid", () => {
      expect(getAuditorAccessExpiryStatus(null)).toBe("unknown");
      expect(getAuditorAccessExpiryStatus(undefined)).toBe("unknown");
      expect(getAuditorAccessExpiryStatus("invalid-date")).toBe("unknown");
    });

    it("returns 'expired' when expiration is in the past", () => {
      const pastTime = BASE_TIME - ONE_HOUR_MS;
      expect(getAuditorAccessExpiryStatus(pastTime, { referenceTime: BASE_TIME })).toBe("expired");

      // Exactly at reference time is considered expired
      expect(getAuditorAccessExpiryStatus(BASE_TIME, { referenceTime: BASE_TIME })).toBe("expired");
    });

    it("returns 'expiring_soon' when expiration is within warning threshold", () => {
      // 12 hours remaining (default threshold is 48 hours)
      const soonTime = BASE_TIME + 12 * ONE_HOUR_MS;
      expect(getAuditorAccessExpiryStatus(soonTime, { referenceTime: BASE_TIME })).toBe(
        "expiring_soon"
      );

      // Exactly at default threshold (48h) is expiring_soon
      const exactThresholdTime = BASE_TIME + DEFAULT_EXPIRING_SOON_THRESHOLD_MS;
      expect(getAuditorAccessExpiryStatus(exactThresholdTime, { referenceTime: BASE_TIME })).toBe(
        "expiring_soon"
      );
    });

    it("returns 'active' when expiration is safely beyond warning threshold", () => {
      // 5 days remaining
      const futureTime = BASE_TIME + 5 * ONE_DAY_MS;
      expect(getAuditorAccessExpiryStatus(futureTime, { referenceTime: BASE_TIME })).toBe("active");
    });

    it("respects custom warningThresholdMs", () => {
      // 3 hours remaining; threshold is 1 hour -> should be active
      const threeHours = BASE_TIME + 3 * ONE_HOUR_MS;
      expect(
        getAuditorAccessExpiryStatus(threeHours, {
          referenceTime: BASE_TIME,
          warningThresholdMs: 1 * ONE_HOUR_MS,
        })
      ).toBe("active");

      // 3 hours remaining; threshold is 4 hours -> should be expiring_soon
      expect(
        getAuditorAccessExpiryStatus(threeHours, {
          referenceTime: BASE_TIME,
          warningThresholdMs: 4 * ONE_HOUR_MS,
        })
      ).toBe("expiring_soon");
    });
  });

  describe("formatAuditorAccessExpiry", () => {
    it("formats unknown expiration gracefully", () => {
      const res = formatAuditorAccessExpiry({
        auditorId: "GAUDITOR123456789WXYZ",
        expiresAt: null,
      });

      expect(res.status).toBe("unknown");
      expect(res.shortLabel).toBe("Unknown");
      expect(res.isExpired).toBe(false);
      expect(res.isActive).toBe(false);
      expect(res.isExpiringSoon).toBe(false);
      expect(res.remainingMs).toBeNull();
      expect(res.remainingFormatted).toBe("None");
      expect(res.redactedAuditorId).toBe("GAU***XYZ");
    });

    it("formats expired access with elapsed time", () => {
      const expiredAt = BASE_TIME - (2 * ONE_DAY_MS + 3 * ONE_HOUR_MS);
      const res = formatAuditorAccessExpiry({
        auditorId: "GAUDITOR123456789WXYZ",
        expiresAt: expiredAt,
        referenceTime: BASE_TIME,
      });

      expect(res.status).toBe("expired");
      expect(res.shortLabel).toBe("Expired");
      expect(res.isExpired).toBe(true);
      expect(res.isActive).toBe(false);
      expect(res.label).toContain("Expired");
      expect(res.label).toContain("ago");
      expect(res.remainingFormatted).toBe("Expired");
    });

    it("formats expiring soon access with remaining time", () => {
      const expiresSoonAt = BASE_TIME + 6 * ONE_HOUR_MS;
      const res = formatAuditorAccessExpiry({
        auditorId: "GAUDITOR123456789WXYZ",
        expiresAt: expiresSoonAt,
        referenceTime: BASE_TIME,
      });

      expect(res.status).toBe("expiring_soon");
      expect(res.shortLabel).toBe("Expiring Soon");
      expect(res.isExpiringSoon).toBe(true);
      expect(res.isActive).toBe(true);
      expect(res.label).toContain("Expiring Soon (in 6h)");
      expect(res.remainingFormatted).toBe("6h");
    });

    it("formats active access with remaining days and hours", () => {
      const activeExpiresAt = BASE_TIME + (5 * ONE_DAY_MS + 4 * ONE_HOUR_MS);
      const res = formatAuditorAccessExpiry({
        auditorId: "GAUDITOR123456789WXYZ",
        expiresAt: activeExpiresAt,
        referenceTime: BASE_TIME,
      });

      expect(res.status).toBe("active");
      expect(res.shortLabel).toBe("Active");
      expect(res.isActive).toBe(true);
      expect(res.isExpired).toBe(false);
      expect(res.label).toContain("Active (expires in 5d 4h)");
      expect(res.remainingFormatted).toBe("5d 4h");
    });

    it("supports ISO string timestamps and Date objects", () => {
      const isoStr = new Date(BASE_TIME + 10 * ONE_DAY_MS).toISOString();
      const resIso = formatAuditorAccessExpiry({
        expiresAt: isoStr,
        referenceTime: BASE_TIME,
      });
      expect(resIso.status).toBe("active");

      const dateObj = new Date(BASE_TIME + 10 * ONE_DAY_MS);
      const resDate = formatAuditorAccessExpiry({
        expiresAt: dateObj,
        referenceTime: BASE_TIME,
      });
      expect(resDate.status).toBe("active");
    });
  });

  describe("formatBatchAuditorAccessExpiry", () => {
    it("formats multiple auditor access entries in batch", () => {
      const inputs: AuditorAccessExpiryInput[] = [
        {
          auditorId: "AUD1_1234567",
          expiresAt: BASE_TIME + 10 * ONE_DAY_MS,
          referenceTime: BASE_TIME,
        },
        {
          auditorId: "AUD2_1234567",
          expiresAt: BASE_TIME + 4 * ONE_HOUR_MS,
          referenceTime: BASE_TIME,
        },
        { auditorId: "AUD3_1234567", expiresAt: BASE_TIME - ONE_HOUR_MS, referenceTime: BASE_TIME },
        { auditorId: "AUD4_1234567", expiresAt: null, referenceTime: BASE_TIME },
      ];

      const results = formatBatchAuditorAccessExpiry(inputs);
      expect(results).toHaveLength(4);
      expect(results[0].status).toBe("active");
      expect(results[1].status).toBe("expiring_soon");
      expect(results[2].status).toBe("expired");
      expect(results[3].status).toBe("unknown");
    });
  });

  describe("isAuditorAccessActive & isAuditorAccessExpiringSoon", () => {
    it("evaluates boolean active status correctly", () => {
      expect(isAuditorAccessActive(BASE_TIME + ONE_DAY_MS, BASE_TIME)).toBe(true);
      expect(isAuditorAccessActive(BASE_TIME - ONE_DAY_MS, BASE_TIME)).toBe(false);
      expect(isAuditorAccessActive(null, BASE_TIME)).toBe(false);
    });

    it("evaluates boolean expiring soon status correctly", () => {
      expect(isAuditorAccessExpiringSoon(BASE_TIME + 12 * ONE_HOUR_MS, undefined, BASE_TIME)).toBe(
        true
      );
      expect(isAuditorAccessExpiringSoon(BASE_TIME + 10 * ONE_DAY_MS, undefined, BASE_TIME)).toBe(
        false
      );
      expect(isAuditorAccessExpiringSoon(BASE_TIME - ONE_HOUR_MS, undefined, BASE_TIME)).toBe(
        false
      );
    });
  });
});
