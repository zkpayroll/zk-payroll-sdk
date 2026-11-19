import {
  assertAuditorGrantActive,
  assertValidAuditorGrantExpiry,
  validateAuditorGrantExpiry,
} from "../../src/audit/grantExpiryValidation";
import {
  AuditorGrantExpiredError,
  AuditorGrantExpiryError,
  AuditorGrantExpiryErrorCode,
  formatAuditorGrantExpiryError,
  getAuditorGrantExpiryErrorMessage,
  isAuditorGrantExpiredError,
  isAuditorGrantExpiryError,
} from "../../src/audit/grantExpiryErrors";

const BASE_TIME = 1_700_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const AUDITOR_ID = "GAUDITOR123456789WXYZ";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    auditorId: AUDITOR_ID,
    expiresAt: BASE_TIME + 5 * ONE_DAY_MS,
    grantedAt: BASE_TIME - 30 * ONE_DAY_MS,
    referenceTime: BASE_TIME,
    ...overrides,
  };
}

describe("Typed validation for auditor grant expiry (#904)", () => {
  describe("valid descriptors", () => {
    it("normalizes an active grant", () => {
      const result = validateAuditorGrantExpiry(validInput());

      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.normalized).toBeDefined();
      expect(result.normalized!.status).toBe("active");
      expect(result.normalized!.auditorId).toBe(AUDITOR_ID);
      expect(result.normalized!.expiresAtMs).toBe(BASE_TIME + 5 * ONE_DAY_MS);
      expect(result.normalized!.grantedAtMs).toBe(BASE_TIME - 30 * ONE_DAY_MS);
      expect(result.normalized!.referenceTimeMs).toBe(BASE_TIME);
      expect(result.normalized!.descriptor.isActive).toBe(true);
      expect(result.normalized!.isPurged).toBe(false);
    });

    it("accepts ISO strings, Date objects, and numeric strings for expiresAt", () => {
      const iso = new Date(BASE_TIME + 5 * ONE_DAY_MS).toISOString();
      expect(validateAuditorGrantExpiry(validInput({ expiresAt: iso })).isValid).toBe(true);

      const date = new Date(BASE_TIME + 5 * ONE_DAY_MS);
      expect(validateAuditorGrantExpiry(validInput({ expiresAt: date })).isValid).toBe(true);

      const numericString = String(BASE_TIME + 5 * ONE_DAY_MS);
      const result = validateAuditorGrantExpiry(validInput({ expiresAt: numericString }));
      expect(result.isValid).toBe(true);
      expect(result.normalized!.expiresAtMs).toBe(BASE_TIME + 5 * ONE_DAY_MS);
    });

    it("accepts a descriptor without an auditor id", () => {
      const result = validateAuditorGrantExpiry(validInput({ auditorId: undefined }));
      expect(result.isValid).toBe(true);
      expect(result.normalized!.auditorId).toBeUndefined();
    });

    it("accepts expired grants because they are still reportable", () => {
      const result = validateAuditorGrantExpiry(
        validInput({ expiresAt: BASE_TIME - ONE_DAY_MS })
      );
      expect(result.isValid).toBe(true);
      expect(result.normalized!.status).toBe("expired");
    });
  });

  describe("invalid descriptors", () => {
    it("rejects a non-object input", () => {
      const result = validateAuditorGrantExpiry(null as never);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(AuditorGrantExpiryErrorCode.INVALID_INPUT);
      expect(result.normalized).toBeUndefined();
    });

    it("requires an expiration timestamp", () => {
      for (const expiresAt of [null, undefined, ""]) {
        const result = validateAuditorGrantExpiry(validInput({ expiresAt }));
        expect(result.isValid).toBe(false);
        expect(result.issues.some((i) => i.code === AuditorGrantExpiryErrorCode.EXPIRES_AT_REQUIRED)).toBe(
          true
        );
      }
    });

    it("rejects an unparseable expiration", () => {
      const result = validateAuditorGrantExpiry(validInput({ expiresAt: "not-a-date" }));
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(AuditorGrantExpiryErrorCode.EXPIRES_AT_INVALID);
    });

    it("rejects empty and oversized auditor identifiers", () => {
      const empty = validateAuditorGrantExpiry(validInput({ auditorId: "   " }));
      expect(empty.issues.some((i) => i.code === AuditorGrantExpiryErrorCode.AUDITOR_ID_INVALID)).toBe(
        true
      );

      const oversized = validateAuditorGrantExpiry(validInput({ auditorId: "G".repeat(129) }));
      expect(
        oversized.issues.some((i) => i.code === AuditorGrantExpiryErrorCode.AUDITOR_ID_INVALID)
      ).toBe(true);
    });

    it("rejects an unparseable issuance timestamp", () => {
      const result = validateAuditorGrantExpiry(validInput({ grantedAt: "yesterday-ish" }));
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(AuditorGrantExpiryErrorCode.GRANTED_AT_INVALID);
    });

    it("rejects an expiration at or before the issuance time", () => {
      for (const expiresAt of [BASE_TIME, BASE_TIME - ONE_HOUR_MS]) {
        const result = validateAuditorGrantExpiry(
          validInput({ grantedAt: BASE_TIME, expiresAt })
        );
        expect(
          result.issues.some((i) => i.code === AuditorGrantExpiryErrorCode.EXPIRES_BEFORE_GRANTED)
        ).toBe(true);
      }
    });

    it("rejects invalid warning thresholds", () => {
      for (const warningThresholdMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, 366 * ONE_DAY_MS]) {
        const result = validateAuditorGrantExpiry(validInput({ warningThresholdMs }));
        expect(
          result.issues.some(
            (i) => i.code === AuditorGrantExpiryErrorCode.WARNING_THRESHOLD_INVALID
          )
        ).toBe(true);
      }
    });

    it("rejects invalid retention windows", () => {
      for (const retentionWindowMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = validateAuditorGrantExpiry(validInput({ retentionWindowMs }));
        expect(
          result.issues.some((i) => i.code === AuditorGrantExpiryErrorCode.RETENTION_WINDOW_INVALID)
        ).toBe(true);
      }
    });

    it("rejects an invalid reference time", () => {
      for (const referenceTime of ["not-a-date", 0, new Date(Number.NaN)]) {
        const result = validateAuditorGrantExpiry(validInput({ referenceTime }));
        expect(
          result.issues.some((i) => i.code === AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID)
        ).toBe(true);
      }
    });

    it("accumulates every issue instead of stopping at the first", () => {
      const result = validateAuditorGrantExpiry({
        auditorId: "",
        expiresAt: "bad-date",
        grantedAt: "also-bad",
        warningThresholdMs: -5,
        retentionWindowMs: -5,
        referenceTime: "still-bad" as never,
      });

      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(5);
      const codes = new Set(result.issues.map((i) => i.code));
      expect(codes.has(AuditorGrantExpiryErrorCode.AUDITOR_ID_INVALID)).toBe(true);
      expect(codes.has(AuditorGrantExpiryErrorCode.EXPIRES_AT_INVALID)).toBe(true);
      expect(codes.has(AuditorGrantExpiryErrorCode.GRANTED_AT_INVALID)).toBe(true);
      expect(codes.has(AuditorGrantExpiryErrorCode.WARNING_THRESHOLD_INVALID)).toBe(true);
      expect(codes.has(AuditorGrantExpiryErrorCode.RETENTION_WINDOW_INVALID)).toBe(true);
      expect(codes.has(AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID)).toBe(true);
    });

    it("rejects a grant lifetime longer than the configured maximum", () => {
      const result = validateAuditorGrantExpiry(
        validInput({ grantedAt: BASE_TIME, expiresAt: BASE_TIME + 31 * ONE_DAY_MS }),
        { maxGrantLifetimeMs: 30 * ONE_DAY_MS }
      );
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(AuditorGrantExpiryErrorCode.MAX_LIFETIME_EXCEEDED);
    });

    it("throws RangeError for an invalid maxGrantLifetimeMs option", () => {
      expect(() =>
        validateAuditorGrantExpiry(validInput(), { maxGrantLifetimeMs: 0 })
      ).toThrow(RangeError);
    });
  });

  describe("assertValidAuditorGrantExpiry", () => {
    it("returns normalized values for a valid descriptor", () => {
      const normalized = assertValidAuditorGrantExpiry(validInput());
      expect(normalized.status).toBe("active");
      expect(normalized.descriptor.shortLabel).toBe("Active");
    });

    it("throws a typed error carrying every issue", () => {
      try {
        assertValidAuditorGrantExpiry({
          auditorId: "",
          expiresAt: "bad-date",
        });
        fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AuditorGrantExpiryError);
        const typed = error as AuditorGrantExpiryError;
        expect(typed.expiryCode).toBe(AuditorGrantExpiryErrorCode.AUDITOR_ID_INVALID);
        expect(typed.issues.length).toBeGreaterThanOrEqual(2);
        expect(typed.message).toContain("Auditor grant expiry validation failed");
      }
    });
  });

  describe("assertAuditorGrantActive", () => {
    it("returns the descriptor while the grant is usable", () => {
      const descriptor = assertAuditorGrantActive(validInput());
      expect(descriptor.status).toBe("active");
      expect(descriptor.auditorId).toBe(AUDITOR_ID);
    });

    it("throws a safe expired error without echoing the raw auditor id", () => {
      try {
        assertAuditorGrantActive(
          validInput({ expiresAt: BASE_TIME - ONE_HOUR_MS })
        );
        fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AuditorGrantExpiredError);
        expect(isAuditorGrantExpiredError(error)).toBe(true);
        const typed = error as AuditorGrantExpiredError;
        expect(typed.expiryCode).toBe(AuditorGrantExpiryErrorCode.GRANT_EXPIRED);
        expect(typed.redactedAuditorId).toBe("GAU***XYZ");
        expect(typed.message).not.toContain(AUDITOR_ID);
        expect(typed.message).toContain("GAU***XYZ");
      }
    });
  });

  describe("safe error helpers", () => {
    it("identifies grant expiry errors and their messages", () => {
      const result = validateAuditorGrantExpiry(validInput({ expiresAt: "bad" }));
      let thrown: unknown;
      try {
        assertValidAuditorGrantExpiry(validInput({ expiresAt: "bad" }));
      } catch (error) {
        thrown = error;
      }

      expect(result.isValid).toBe(false);
      expect(isAuditorGrantExpiryError(thrown)).toBe(true);
      expect(getAuditorGrantExpiryErrorMessage(thrown)).toContain("valid epoch-millisecond");
      expect(formatAuditorGrantExpiryError(thrown)).toContain("[expiresAt]");
    });

    it("returns a safe fallback for unknown errors", () => {
      expect(isAuditorGrantExpiryError(new Error("boom"))).toBe(false);
      expect(getAuditorGrantExpiryErrorMessage(42)).toContain("auditor grant expiry error");
      expect(formatAuditorGrantExpiryError(new Error("boom"))).toBe("boom");
    });

    it("never interpolates auditor identifiers or payroll values into issues", () => {
      const result = validateAuditorGrantExpiry(
        validInput({ auditorId: "G".repeat(129), expiresAt: "bad" })
      );
      for (const entry of result.issues) {
        expect(entry.message).not.toContain("G".repeat(129));
        expect(entry.message).not.toMatch(/salary|amount|employee|secret|private key/i);
      }
    });
  });
});
