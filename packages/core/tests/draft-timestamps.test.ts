import {
  formatDraftUpdatedTimestamp,
  getDraftFreshnessStatus,
  getDraftFreshnessBadge,
  formatDraftSummary,
  redactDraftId,
  redactOperatorAddress,
  validateDraftTimestamp,
} from "../src/payroll/timestamps";
import { formatRelativeTime } from "../src/utils/date";

describe("Draft Last-Updated Timestamp Formatter (#423)", () => {
  const FIXED_NOW = 1746889200000; // 2025-05-10T15:00:00.000Z

  describe("redactDraftId & redactOperatorAddress", () => {
    it("redacts long draft identifiers correctly", () => {
      expect(redactDraftId("draft_123456789")).toBe("draf***789");
      expect(redactDraftId("payroll_draft_abc")).toBe("payr***abc");
    });

    it("handles short or empty draft identifiers safely", () => {
      expect(redactDraftId("short")).toBe("[REDACTED_DRAFT]");
      expect(redactDraftId("")).toBe("[ANONYMOUS_DRAFT]");
      expect(redactDraftId(undefined)).toBe("[ANONYMOUS_DRAFT]");
      expect(redactDraftId("   ")).toBe("[ANONYMOUS_DRAFT]");
    });

    it("redacts operator addresses for audit and telemetry", () => {
      expect(
        redactOperatorAddress("GD73NVUOPBKK43EQLA66XG2B35L5Z3B3A6TYA6T6ZEXQFR3K7IOPL4NM")
      ).toBe("GD7***4NM");
      expect(redactOperatorAddress("short")).toBe("[REDACTED_OPERATOR]");
      expect(redactOperatorAddress("")).toBe("[SYSTEM]");
      expect(redactOperatorAddress(undefined)).toBe("[SYSTEM]");
    });
  });

  describe("formatRelativeTime", () => {
    it("formats relative times into human-friendly strings", () => {
      expect(formatRelativeTime(FIXED_NOW - 10000, FIXED_NOW)).toBe("just now");
      expect(formatRelativeTime(FIXED_NOW - 65000, FIXED_NOW)).toBe("1 minute ago");
      expect(formatRelativeTime(FIXED_NOW - 300000, FIXED_NOW)).toBe("5 minutes ago");
      expect(formatRelativeTime(FIXED_NOW - 3600000, FIXED_NOW)).toBe("1 hour ago");
      expect(formatRelativeTime(FIXED_NOW - 7200000, FIXED_NOW)).toBe("2 hours ago");
      expect(formatRelativeTime(FIXED_NOW - 86400000, FIXED_NOW)).toBe("1 day ago");
      expect(formatRelativeTime(FIXED_NOW - 259200000, FIXED_NOW)).toBe("3 days ago");
    });

    it("handles future differences and clock skew", () => {
      expect(formatRelativeTime(FIXED_NOW + 2000, FIXED_NOW)).toBe("just now");
      expect(formatRelativeTime(FIXED_NOW + 65000, FIXED_NOW)).toBe("in 1 minute");
      expect(formatRelativeTime(FIXED_NOW + 120000, FIXED_NOW)).toBe("in 2 minutes");
      expect(formatRelativeTime(FIXED_NOW + 3600000, FIXED_NOW)).toBe("in 1 hour");
    });

    it("returns invalid date when input is invalid", () => {
      expect(formatRelativeTime("not-a-date", FIXED_NOW)).toBe("invalid date");
    });
  });

  describe("formatDraftUpdatedTimestamp", () => {
    it("returns fallback text when timestamp is missing or null", () => {
      expect(formatDraftUpdatedTimestamp(null)).toBe("Never updated");
      expect(formatDraftUpdatedTimestamp(undefined)).toBe("Never updated");
      expect(formatDraftUpdatedTimestamp(null, { fallbackText: "Draft not saved yet" })).toBe(
        "Draft not saved yet"
      );
    });

    it("returns 'Invalid timestamp' for unparseable input", () => {
      expect(formatDraftUpdatedTimestamp("invalid-timestamp-value")).toBe("Invalid timestamp");
    });

    it("formats valid timestamp with default iso style and relative time", () => {
      const tenMinutesAgo = FIXED_NOW - 600000;
      const formatted = formatDraftUpdatedTimestamp(tenMinutesAgo, { now: FIXED_NOW });
      expect(formatted).toContain("2025-05-10 14:50:00 UTC");
      expect(formatted).toContain("10 minutes ago");
    });

    it("formats valid timestamp without relative time if requested", () => {
      const timestamp = FIXED_NOW;
      const formatted = formatDraftUpdatedTimestamp(timestamp, { includeRelative: false });
      expect(formatted).toBe("2025-05-10 15:00:00 UTC");
    });

    it("supports short date formatting style", () => {
      const formatted = formatDraftUpdatedTimestamp(FIXED_NOW, {
        style: "short",
        includeRelative: false,
      });
      expect(formatted).toBe("2025-05-10");
    });

    it("parses string ISO timestamps correctly", () => {
      const iso = "2025-05-10T14:30:00.000Z";
      const formatted = formatDraftUpdatedTimestamp(iso, { now: FIXED_NOW });
      expect(formatted).toContain("2025-05-10 14:30:00 UTC");
      expect(formatted).toContain("30 minutes ago");
    });

    it("parses Date object instances correctly", () => {
      const date = new Date(FIXED_NOW - 120000);
      const formatted = formatDraftUpdatedTimestamp(date, { now: FIXED_NOW });
      expect(formatted).toContain("2 minutes ago");
    });
  });

  describe("getDraftFreshnessStatus & getDraftFreshnessBadge", () => {
    it("returns 'unknown' when timestamp is missing or invalid", () => {
      expect(getDraftFreshnessStatus(null)).toBe("unknown");
      expect(getDraftFreshnessStatus(undefined)).toBe("unknown");
      expect(getDraftFreshnessStatus("invalid")).toBe("unknown");

      const badge = getDraftFreshnessBadge("unknown");
      expect(badge.label).toBe("Not updated");
      expect(badge.variant).toBe("neutral");
    });

    it("evaluates 'fresh' for updates within freshThreshold", () => {
      const twentyMinsAgo = FIXED_NOW - 1200000;
      expect(getDraftFreshnessStatus(twentyMinsAgo, { now: FIXED_NOW })).toBe("fresh");

      const badge = getDraftFreshnessBadge("fresh");
      expect(badge.label).toBe("Up to date");
      expect(badge.variant).toBe("success");
    });

    it("evaluates 'recent' for updates within 24h", () => {
      const threeHoursAgo = FIXED_NOW - 3 * 3600000;
      expect(getDraftFreshnessStatus(threeHoursAgo, { now: FIXED_NOW })).toBe("recent");

      const badge = getDraftFreshnessBadge("recent");
      expect(badge.label).toBe("Recent");
      expect(badge.variant).toBe("warning");
    });

    it("evaluates 'stale' for updates older than 24h", () => {
      const twoDaysAgo = FIXED_NOW - 2 * 86400000;
      expect(getDraftFreshnessStatus(twoDaysAgo, { now: FIXED_NOW })).toBe("stale");

      const badge = getDraftFreshnessBadge("stale");
      expect(badge.label).toBe("Needs review");
      expect(badge.variant).toBe("danger");
    });

    it("respects custom thresholds", () => {
      const tenMinsAgo = FIXED_NOW - 600000;
      // 5 min fresh threshold
      expect(
        getDraftFreshnessStatus(tenMinsAgo, {
          now: FIXED_NOW,
          freshThresholdMs: 300000,
          staleThresholdMs: 900000,
        })
      ).toBe("recent");
    });
  });

  describe("formatDraftSummary", () => {
    it("formats full draft summary preserving privacy", () => {
      const summary = formatDraftSummary(
        {
          draftId: "payroll_batch_draft_99214a",
          version: 3,
          updatedAt: FIXED_NOW - 900000,
          updatedBy: "GBVXZYI4P6WW7Z3VQQQ6Y74E2KMMX325Y5ZTL490A87K4N",
        },
        { now: FIXED_NOW }
      );

      expect(summary).toContain("payr***14a (v3)");
      expect(summary).toContain("Updated: 2025-05-10 14:45:00 UTC (15 minutes ago)");
      expect(summary).toContain("By: GBV***K4N");
      expect(summary).not.toContain("payroll_batch_draft_99214a");
      expect(summary).not.toContain("GBVXZYI4P6WW7Z3VQQQ6Y74E2KMMX325Y5ZTL490A87K4N");
    });

    it("formats draft summary with unredacted values when requested", () => {
      const summary = formatDraftSummary(
        {
          draftId: "raw_draft_identifier_123",
          updatedAt: FIXED_NOW,
        },
        { now: FIXED_NOW, redactDraftId: false }
      );

      expect(summary).toContain("raw_draft_identifier_123");
      expect(summary).toContain("Updated: 2025-05-10 15:00:00 UTC (just now)");
    });
  });

  describe("validateDraftTimestamp", () => {
    it("validates and parses valid timestamps", () => {
      const result = validateDraftTimestamp(1700000000000);
      expect(result.isValid).toBe(true);
      expect(result.timestampMs).toBe(1700000000000);
      expect(result.error).toBeUndefined();
    });

    it("catches missing timestamps", () => {
      const result = validateDraftTimestamp(null);
      expect(result.isValid).toBe(false);
      expect(result.timestampMs).toBeNull();
      expect(result.error).toBe("Timestamp is required");
    });

    it("catches invalid timestamps", () => {
      const result = validateDraftTimestamp("not-valid");
      expect(result.isValid).toBe(false);
      expect(result.timestampMs).toBeNull();
      expect(result.error).toBe("Invalid timestamp format");
    });
  });
});
