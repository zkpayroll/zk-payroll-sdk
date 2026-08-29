/**
 * Approval expiry formatter tests (Issue #392)
 *
 * Covers: state classification (active/expiring_soon/expired/missing),
 * the formatted status object, and the human-readable countdown string.
 */

import {
  getApprovalExpiryState,
  formatApprovalExpiry,
  formatApprovalExpiryCountdown,
  DEFAULT_EXPIRING_SOON_THRESHOLD_MS,
} from "../src/authorization/approvalExpiry";

const NOW = 1_700_000_000_000;

describe("getApprovalExpiryState", () => {
  it("returns 'missing' when expiresAt is undefined", () => {
    expect(getApprovalExpiryState({ expiresAt: undefined }, NOW)).toBe("missing");
  });

  it("returns 'expired' when expiresAt is in the past", () => {
    expect(getApprovalExpiryState({ expiresAt: NOW - 1000 }, NOW)).toBe("expired");
  });

  it("returns 'expired' when expiresAt equals now (zero remaining)", () => {
    expect(getApprovalExpiryState({ expiresAt: NOW }, NOW)).toBe("expired");
  });

  it("returns 'expiring_soon' when within the default threshold", () => {
    const expiresAt = NOW + DEFAULT_EXPIRING_SOON_THRESHOLD_MS - 1;
    expect(getApprovalExpiryState({ expiresAt }, NOW)).toBe("expiring_soon");
  });

  it("returns 'expiring_soon' at exactly the threshold boundary", () => {
    const expiresAt = NOW + DEFAULT_EXPIRING_SOON_THRESHOLD_MS;
    expect(getApprovalExpiryState({ expiresAt }, NOW)).toBe("expiring_soon");
  });

  it("returns 'active' when comfortably beyond the threshold", () => {
    const expiresAt = NOW + DEFAULT_EXPIRING_SOON_THRESHOLD_MS + 1;
    expect(getApprovalExpiryState({ expiresAt }, NOW)).toBe("active");
  });

  it("respects a custom expiringSoonThresholdMs", () => {
    const expiresAt = NOW + 5000;
    expect(getApprovalExpiryState({ expiresAt }, NOW, 10_000)).toBe("expiring_soon");
    expect(getApprovalExpiryState({ expiresAt }, NOW, 1000)).toBe("active");
  });
});

describe("formatApprovalExpiry", () => {
  it("formats a missing expiry", () => {
    const status = formatApprovalExpiry({ expiresAt: undefined }, NOW);
    expect(status).toEqual({
      state: "missing",
      label: "No Expiry",
      description: expect.any(String),
      variant: "default",
      remainingMs: undefined,
    });
  });

  it("formats an expired request with negative remainingMs", () => {
    const status = formatApprovalExpiry({ expiresAt: NOW - 5000 }, NOW);
    expect(status.state).toBe("expired");
    expect(status.variant).toBe("danger");
    expect(status.remainingMs).toBe(-5000);
  });

  it("formats an expiring-soon request", () => {
    const status = formatApprovalExpiry({ expiresAt: NOW + 60_000 }, NOW);
    expect(status.state).toBe("expiring_soon");
    expect(status.variant).toBe("warning");
    expect(status.remainingMs).toBe(60_000);
  });

  it("formats an active request", () => {
    const status = formatApprovalExpiry({ expiresAt: NOW + 10 * 60 * 60 * 1000 }, NOW);
    expect(status.state).toBe("active");
    expect(status.variant).toBe("success");
  });

  it("every state has a non-empty label and description", () => {
    const cases: Array<{ expiresAt: number | undefined }> = [
      { expiresAt: undefined },
      { expiresAt: NOW - 1000 },
      { expiresAt: NOW + 60_000 },
      { expiresAt: NOW + 10 * 60 * 60 * 1000 },
    ];
    for (const c of cases) {
      const status = formatApprovalExpiry(c, NOW);
      expect(status.label.length).toBeGreaterThan(0);
      expect(status.description.length).toBeGreaterThan(0);
    }
  });
});

describe("formatApprovalExpiryCountdown", () => {
  it("returns 'no expiry' when expiresAt is undefined", () => {
    expect(formatApprovalExpiryCountdown({ expiresAt: undefined }, NOW)).toBe("no expiry");
  });

  it("formats minutes remaining", () => {
    expect(formatApprovalExpiryCountdown({ expiresAt: NOW + 23 * 60_000 }, NOW)).toBe("23m left");
  });

  it("formats hours remaining", () => {
    expect(formatApprovalExpiryCountdown({ expiresAt: NOW + 5 * 60 * 60_000 }, NOW)).toBe(
      "5h left"
    );
  });

  it("formats days remaining", () => {
    expect(formatApprovalExpiryCountdown({ expiresAt: NOW + 3 * 24 * 60 * 60_000 }, NOW)).toBe(
      "3d left"
    );
  });

  it("formats sub-minute remaining as '<1m left'", () => {
    expect(formatApprovalExpiryCountdown({ expiresAt: NOW + 30_000 }, NOW)).toBe("<1m left");
  });

  it("formats elapsed time for an expired request", () => {
    expect(formatApprovalExpiryCountdown({ expiresAt: NOW - 2 * 60 * 60_000 }, NOW)).toBe(
      "expired 2h ago"
    );
  });

  it("formats elapsed minutes for a just-expired request", () => {
    expect(formatApprovalExpiryCountdown({ expiresAt: NOW - 5 * 60_000 }, NOW)).toBe(
      "expired 5m ago"
    );
  });
});
