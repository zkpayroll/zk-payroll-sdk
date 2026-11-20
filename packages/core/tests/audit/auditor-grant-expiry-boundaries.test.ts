import {
  assertAuditorGrantActive,
  validateAuditorGrantExpiry,
} from "../../src/audit/grantExpiryValidation";
import {
  DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS,
  DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS,
} from "../../src/audit/accessExpiry";
import {
  AuditorGrantExpiredError,
  AuditorGrantExpiryErrorCode,
} from "../../src/audit/grantExpiryErrors";

const BASE_TIME = 1_700_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const AUDITOR_ID = "GAUDITOR123456789WXYZ";

function check(expiresAt: number | string | Date, overrides: Record<string, unknown> = {}) {
  return validateAuditorGrantExpiry({
    auditorId: AUDITOR_ID,
    expiresAt,
    referenceTime: BASE_TIME,
    ...overrides,
  });
}

describe("Auditor grant expiry boundaries (#906)", () => {
  describe("expiring-soon threshold", () => {
    it("treats exactly the default threshold as expiring soon", () => {
      const result = check(BASE_TIME + DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS);
      expect(result.isValid).toBe(true);
      expect(result.normalized!.status).toBe("expiring_soon");
      expect(result.normalized!.descriptor.isExpiringSoon).toBe(true);
    });

    it("treats one millisecond beyond the threshold as active", () => {
      const result = check(BASE_TIME + DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS + 1);
      expect(result.normalized!.status).toBe("active");
    });

    it("treats one millisecond of remaining access as expiring soon", () => {
      const result = check(BASE_TIME + 1);
      expect(result.normalized!.status).toBe("expiring_soon");
      expect(result.normalized!.descriptor.remainingMs).toBe(1);
    });

    it("accepts a zero warning threshold and uses it exactly", () => {
      const atOneMs = check(BASE_TIME + 1, { warningThresholdMs: 0 });
      expect(atOneMs.isValid).toBe(true);
      expect(atOneMs.normalized!.status).toBe("active");

      const atZero = check(BASE_TIME, { warningThresholdMs: 0 });
      expect(atZero.normalized!.status).toBe("expired");
    });

    it("accepts the 365-day maximum threshold and rejects one millisecond more", () => {
      const max = 365 * ONE_DAY_MS;
      expect(check(BASE_TIME + ONE_DAY_MS, { warningThresholdMs: max }).isValid).toBe(true);

      const tooLarge = check(BASE_TIME + ONE_DAY_MS, { warningThresholdMs: max + 1 });
      expect(tooLarge.isValid).toBe(false);
      expect(
        tooLarge.issues.some(
          (i) => i.code === AuditorGrantExpiryErrorCode.WARNING_THRESHOLD_INVALID
        )
      ).toBe(true);
    });
  });

  describe("expiration instant", () => {
    it("treats an expiration exactly at the reference time as expired", () => {
      const result = check(BASE_TIME);
      expect(result.normalized!.status).toBe("expired");
      expect(result.normalized!.descriptor.isExpired).toBe(true);
      expect(result.normalized!.descriptor.remainingMs).toBe(0);
    });

    it("treats one millisecond before the reference time as expired", () => {
      const result = check(BASE_TIME - 1);
      expect(result.normalized!.status).toBe("expired");
    });

    it("rejects an expiration one millisecond before issuance", () => {
      const result = check(BASE_TIME - 1, { grantedAt: BASE_TIME });
      expect(
        result.issues.some((i) => i.code === AuditorGrantExpiryErrorCode.EXPIRES_BEFORE_GRANTED)
      ).toBe(true);
    });

    it("accepts an expiration one millisecond after issuance", () => {
      const result = check(BASE_TIME + 1, { grantedAt: BASE_TIME });
      expect(result.isValid).toBe(true);
    });
  });

  describe("retention window", () => {
    it("does not purge a descriptor that expired exactly one retention window ago", () => {
      const result = check(BASE_TIME - DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS);
      expect(result.isValid).toBe(true);
      expect(result.normalized!.status).toBe("expired");
      expect(result.normalized!.isPurged).toBe(false);
      expect(result.normalized!.descriptor.auditorId).toBe(AUDITOR_ID);
      expect(result.normalized!.descriptor.label).toContain("ago");
    });

    it("purges a descriptor one millisecond past the retention window", () => {
      const result = check(BASE_TIME - DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS - 1);
      expect(result.normalized!.isPurged).toBe(true);
      expect(result.normalized!.descriptor.isPurged).toBe(true);
      expect(result.normalized!.descriptor.auditorId).toBeUndefined();
      expect(result.normalized!.descriptor.redactedAuditorId).toBe("[REDACTED_AUDITOR]");
      expect(result.normalized!.descriptor.label).toBe(
        "Expired (record purged by retention window)"
      );
    });

    it("with a zero retention window purges any elapsed expiration but not the exact instant", () => {
      const exact = check(BASE_TIME, { retentionWindowMs: 0 });
      expect(exact.normalized!.status).toBe("expired");
      expect(exact.normalized!.isPurged).toBe(false);

      const elapsed = check(BASE_TIME - 1, { retentionWindowMs: 0 });
      expect(elapsed.normalized!.isPurged).toBe(true);
    });

    it("keeps a future descriptor unpurged even with a zero retention window", () => {
      const result = check(BASE_TIME + ONE_DAY_MS, { retentionWindowMs: 0 });
      expect(result.normalized!.status).toBe("active");
      expect(result.normalized!.isPurged).toBe(false);
    });
  });

  describe("grant lifetime bounds", () => {
    it("accepts a lifetime exactly equal to the maximum", () => {
      const result = validateAuditorGrantExpiry(
        {
          auditorId: AUDITOR_ID,
          grantedAt: BASE_TIME,
          expiresAt: BASE_TIME + 30 * ONE_DAY_MS,
          referenceTime: BASE_TIME,
        },
        { maxGrantLifetimeMs: 30 * ONE_DAY_MS }
      );
      expect(result.isValid).toBe(true);
    });

    it("rejects a lifetime one millisecond over the maximum", () => {
      const result = validateAuditorGrantExpiry(
        {
          auditorId: AUDITOR_ID,
          grantedAt: BASE_TIME,
          expiresAt: BASE_TIME + 30 * ONE_DAY_MS + 1,
          referenceTime: BASE_TIME,
        },
        { maxGrantLifetimeMs: 30 * ONE_DAY_MS }
      );
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(AuditorGrantExpiryErrorCode.MAX_LIFETIME_EXCEEDED);
    });

    it("checks ISO strings against the lifetime bound", () => {
      const result = validateAuditorGrantExpiry(
        {
          grantedAt: new Date(BASE_TIME).toISOString(),
          expiresAt: new Date(BASE_TIME + 2 * ONE_DAY_MS).toISOString(),
          referenceTime: BASE_TIME,
        },
        { maxGrantLifetimeMs: ONE_DAY_MS }
      );
      expect(
        result.issues.some((i) => i.code === AuditorGrantExpiryErrorCode.MAX_LIFETIME_EXCEEDED)
      ).toBe(true);
    });
  });

  describe("identifier limits", () => {
    it("accepts an identifier of exactly 128 characters", () => {
      expect(check(BASE_TIME + ONE_DAY_MS, { auditorId: "G".repeat(128) }).isValid).toBe(true);
    });

    it("rejects an identifier of 129 characters", () => {
      expect(check(BASE_TIME + ONE_DAY_MS, { auditorId: "G".repeat(129) }).isValid).toBe(false);
    });
  });

  describe("access gate boundaries", () => {
    it("throws an expired error exactly at the expiration instant", () => {
      expect(() => assertAuditorGrantActive({
        auditorId: AUDITOR_ID,
        expiresAt: BASE_TIME,
        referenceTime: BASE_TIME,
      })).toThrow(AuditorGrantExpiredError);
    });

    it("allows access one millisecond before expiration", () => {
      const descriptor = assertAuditorGrantActive({
        auditorId: AUDITOR_ID,
        expiresAt: BASE_TIME + 1,
        referenceTime: BASE_TIME,
      });
      expect(descriptor.status).toBe("expiring_soon");
      expect(descriptor.remainingMs).toBe(1);
    });

    it("still allows access exactly at the warning threshold", () => {
      const descriptor = assertAuditorGrantActive({
        auditorId: AUDITOR_ID,
        expiresAt: BASE_TIME + DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS,
        referenceTime: BASE_TIME,
      });
      expect(descriptor.status).toBe("expiring_soon");
    });
  });

  describe("timestamp formats at the boundary", () => {
    it("parses an offset ISO string to the same instant", () => {
      const result = check("2023-11-14T22:13:20.000Z");
      expect(result.isValid).toBe(true);
      expect(result.normalized!.expiresAtMs).toBe(BASE_TIME);

      const offset = check("2023-11-15T03:43:20.000+05:30");
      expect(offset.isValid).toBe(true);
      expect(offset.normalized!.expiresAtMs).toBe(BASE_TIME);
    });

    it("accepts a Date object at the exact reference instant", () => {
      const result = check(new Date(BASE_TIME));
      expect(result.isValid).toBe(true);
      expect(result.normalized!.status).toBe("expired");
    });

    it("rejects an invalid Date object at the boundary", () => {
      const result = check(new Date(Number.NaN));
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(AuditorGrantExpiryErrorCode.EXPIRES_AT_INVALID);
    });
  });

  describe("one hour boundary matrix", () => {
    const matrix: Array<{ offset: number; expected: string }> = [
      { offset: -ONE_HOUR_MS, expected: "expired" },
      { offset: 0, expected: "expired" },
      { offset: 1, expected: "expiring_soon" },
      { offset: DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS, expected: "expiring_soon" },
      { offset: DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS + 1, expected: "active" },
      { offset: ONE_HOUR_MS, expected: "expiring_soon" },
    ];

    it.each(matrix)("maps offset $offset to $expected", ({ offset, expected }) => {
      const result = check(BASE_TIME + offset);
      expect(result.isValid).toBe(true);
      expect(result.normalized!.status).toBe(expected);
    });
  });
});
