import {
  AuditRetentionValidationError,
  DEFAULT_MINIMUM_RETENTION_MS,
  assertAuditRecordDeletable,
  evaluateAuditRetention,
  redactRecordId,
  validateAuditRetentionInput,
} from "../../src/audit/auditRetentionSafeguards";

const NOW = Date.parse("2026-07-01T00:00:00Z");
const MINIMUM_WINDOW = 7 * 365 * 24 * 60 * 60 * 1000;

describe("audit retention safeguards", () => {
  describe("redactRecordId", () => {
    it("redacts long identifiers", () => {
      expect(redactRecordId("audit-package-2026-07")).toBe("aud***-07");
    });

    it("falls back to anonymous for blank identifiers", () => {
      expect(redactRecordId("")).toBe("[ANONYMOUS_RECORD]");
      expect(redactRecordId(undefined)).toBe("[ANONYMOUS_RECORD]");
    });

    it("redacts short identifiers entirely", () => {
      expect(redactRecordId("abc123")).toBe("[REDACTED_RECORD]");
    });
  });

  describe("validateAuditRetentionInput", () => {
    it("accepts a well-formed input", () => {
      const errors = validateAuditRetentionInput({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        maximumRetentionMs: MINIMUM_WINDOW * 2,
      });
      expect(errors).toHaveLength(0);
    });

    it("reports invalid window bounds", () => {
      const errors = validateAuditRetentionInput({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        maximumRetentionMs: MINIMUM_WINDOW / 2,
      });
      expect(errors.some((e) => e.code === "INVALID_RETENTION_WINDOW")).toBe(true);
    });

    it("reports invalid legal holds", () => {
      const errors = validateAuditRetentionInput({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        legalHolds: [{ holdId: "", reason: "" }],
      });
      expect(errors.some((e) => e.code === "INVALID_LEGAL_HOLD")).toBe(true);
    });
  });

  describe("evaluateAuditRetention", () => {
    it("retains records within the minimum retention window", () => {
      const result = evaluateAuditRetention({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        referenceTime: NOW + 1000,
      });
      expect(result.status).toBe("retained");
      expect(result.canDelete).toBe(false);
      expect(result.mustRetain).toBe(true);
      expect(result.isMinimumRetentionMet).toBe(false);
      expect(result.remainingMinimumMs).toBe(MINIMUM_WINDOW - 1000);
    });

    it("allows deletion once minimum retention is met", () => {
      const referenceTime = NOW + MINIMUM_WINDOW + 1000;
      const result = evaluateAuditRetention({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        referenceTime,
      });
      expect(result.status).toBe("eligible_for_deletion");
      expect(result.canDelete).toBe(true);
      expect(result.isMinimumRetentionMet).toBe(true);
      expect(result.maximumRetentionUntilMs).toBeNull();
    });

    it("meets the minimum retention window exactly at its deadline", () => {
      const result = evaluateAuditRetention({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        referenceTime: NOW + MINIMUM_WINDOW,
      });

      expect(result.isMinimumRetentionMet).toBe(true);
      expect(result.remainingMinimumMs).toBe(0);
      expect(result.canDelete).toBe(true);
    });

    it("does not exceed maximum retention until after its exact deadline", () => {
      const result = evaluateAuditRetention({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: 0,
        maximumRetentionMs: 100,
        referenceTime: NOW + 100,
      });

      expect(result.isMaximumRetentionExceeded).toBe(false);
      expect(result.status).toBe("eligible_for_deletion");
    });

    it("rejects non-finite reference times and overflowing deadlines", () => {
      expect(() =>
        evaluateAuditRetention({
          recordId: "audit-package-2026-07",
          recordKind: "audit_package",
          createdAt: NOW,
          minimumRetentionMs: 0,
          referenceTime: Number.NaN,
        })
      ).toThrow(/Reference timestamp must be a finite number/);

      expect(() =>
        evaluateAuditRetention({
          recordId: "audit-package-2026-07",
          recordKind: "audit_package",
          createdAt: Number.MAX_VALUE,
          minimumRetentionMs: Number.MAX_VALUE,
          referenceTime: 0,
        })
      ).toThrow(/deadline is outside the supported timestamp range/);
    });

    it("blocks deletion when an active legal hold is present", () => {
      const referenceTime = NOW + MINIMUM_WINDOW + 1000;
      const result = evaluateAuditRetention({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        legalHolds: [{ holdId: "hold-1", reason: "litigation", expiresAt: null }],
        referenceTime,
      });
      expect(result.status).toBe("legal_hold");
      expect(result.canDelete).toBe(false);
      expect(result.isLegalHeld).toBe(true);
      expect(result.activeLegalHolds).toHaveLength(1);
    });

    it("ignores expired legal holds", () => {
      const referenceTime = NOW + MINIMUM_WINDOW + 1000;
      const result = evaluateAuditRetention({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        legalHolds: [{ holdId: "hold-1", reason: "litigation", expiresAt: NOW + 1000 }],
        referenceTime,
      });
      expect(result.status).toBe("eligible_for_deletion");
      expect(result.isLegalHeld).toBe(false);
    });

    it("marks records expired once maximum retention is exceeded", () => {
      const maximumRetentionMs = MINIMUM_WINDOW * 2;
      const referenceTime = NOW + maximumRetentionMs + 1000;
      const result = evaluateAuditRetention({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        maximumRetentionMs: maximumRetentionMs,
        referenceTime,
      });
      expect(result.status).toBe("expired");
      expect(result.isMaximumRetentionExceeded).toBe(true);
      expect(result.canDelete).toBe(true);
    });

    it("throws a validation error for malformed input", () => {
      expect(() =>
        evaluateAuditRetention({
          recordId: "",
          recordKind: "audit_package",
          createdAt: NOW,
          minimumRetentionMs: -1,
        } as unknown as any)
      ).toThrow(AuditRetentionValidationError);
    });
  });

  describe("assertAuditRecordDeletable", () => {
    it("throws when the record is still within the minimum retention window", () => {
      expect(() =>
        assertAuditRecordDeletable({
          recordId: "audit-package-2026-07",
          recordKind: "audit_package",
          createdAt: NOW,
          minimumRetentionMs: MINIMUM_WINDOW,
          referenceTime: NOW + 1000,
        })
      ).toThrow(AuditRetentionValidationError);
    });

    it("returns the evaluation when deletion is allowed", () => {
      const result = assertAuditRecordDeletable({
        recordId: "audit-package-2026-07",
        recordKind: "audit_package",
        createdAt: NOW,
        minimumRetentionMs: MINIMUM_WINDOW,
        referenceTime: NOW + MINIMUM_WINDOW + 1000,
      });
      expect(result.canDelete).toBe(true);
    });
  });

  it("exposes a sensible default minimum retention window", () => {
    expect(DEFAULT_MINIMUM_RETENTION_MS).toBeGreaterThan(0);
  });
});
