/**
 * Tests for audit/viewKeyHelpers.ts
 *
 * Covers:
 *  - createViewKeyRequest — happy path and field defaults
 *  - validateViewKeyRequest — all invalid-input branches
 *  - revokeViewKey — success, already-inactive, id mismatch
 *  - getViewKeyStatus — active / revoked / expired classification
 *  - buildViewKeyStatusSummary — aggregate counts and per-key detail
 *  - isViewKeyValid — boundary at exact expiry time
 *  - filterActiveViewKeys — mixed-status collections
 */

import {
  buildViewKeyStatusSummary,
  createViewKeyRequest,
  filterActiveViewKeys,
  getViewKeyStatus,
  isViewKeyValid,
  revokeViewKey,
  validateViewKeyRequest,
} from "../src/audit/viewKeyHelpers";
import type { ViewKey, ViewKeyRequest } from "../src/audit/viewKeyHelpers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<ViewKeyRequest> = {}): ViewKeyRequest {
  return {
    auditorName: "Sarah Chen",
    auditorOrg: "Deloitte",
    scope: "read-only",
    ...overrides,
  };
}

function makeViewKey(overrides: Partial<ViewKey> = {}): ViewKey {
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: "vk_001",
    keyId: "vk_audit_abc123",
    auditorName: "Sarah Chen",
    auditorOrg: "Deloitte",
    scope: "read-only",
    grantedBy: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    createdAt: new Date().toISOString(),
    expiresAt: future,
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createViewKeyRequest
// ---------------------------------------------------------------------------

describe("createViewKeyRequest", () => {
  it("returns a fully populated ViewKeyResponse", () => {
    const grantedBy = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
    const response = createViewKeyRequest(makeRequest(), grantedBy);

    expect(response.id).toMatch(/^vk_/);
    expect(response.keyId).toMatch(/^vk_/);
    expect(response.auditorName).toBe("Sarah Chen");
    expect(response.auditorOrg).toBe("Deloitte");
    expect(response.scope).toBe("read-only");
    expect(response.grantedBy).toBe(grantedBy);
    expect(response.isActive).toBe(true);
    expect(response.createdAt).toBeTruthy();
    expect(response.expiresAt).toBeTruthy();
  });

  it("uses the provided expiresAt when supplied", () => {
    const customExpiry = "2030-01-01T00:00:00.000Z";
    const response = createViewKeyRequest(makeRequest({ expiresAt: customExpiry }), "GADMIN");
    expect(response.expiresAt).toBe(customExpiry);
  });

  it("defaults expiresAt to approximately one year from now", () => {
    const before = Date.now();
    const response = createViewKeyRequest(makeRequest(), "GADMIN");
    const after = Date.now();

    const expiry = new Date(response.expiresAt).getTime();
    const oneYear = 365 * 24 * 60 * 60 * 1000;

    expect(expiry).toBeGreaterThanOrEqual(before + oneYear - 1000);
    expect(expiry).toBeLessThanOrEqual(after + oneYear + 1000);
  });

  it("trims whitespace from auditorName and auditorOrg", () => {
    const response = createViewKeyRequest(
      makeRequest({ auditorName: "  Jane Doe  ", auditorOrg: "  KPMG  " }),
      "GADMIN"
    );
    expect(response.auditorName).toBe("Jane Doe");
    expect(response.auditorOrg).toBe("KPMG");
  });

  it("generates unique keyId tokens on each call", () => {
    const a = createViewKeyRequest(makeRequest(), "GADMIN");
    const b = createViewKeyRequest(makeRequest(), "GADMIN");
    expect(a.keyId).not.toBe(b.keyId);
  });

  it("supports full-audit scope", () => {
    const response = createViewKeyRequest(makeRequest({ scope: "full-audit" }), "GADMIN");
    expect(response.scope).toBe("full-audit");
  });
});

// ---------------------------------------------------------------------------
// validateViewKeyRequest
// ---------------------------------------------------------------------------

describe("validateViewKeyRequest", () => {
  it("returns no errors for a valid request", () => {
    const errors = validateViewKeyRequest(makeRequest());
    expect(errors).toEqual([]);
  });

  it("errors when auditorName is empty", () => {
    const errors = validateViewKeyRequest(makeRequest({ auditorName: "" }));
    expect(errors.some((e) => e.includes("auditorName"))).toBe(true);
  });

  it("errors when auditorName is only whitespace", () => {
    const errors = validateViewKeyRequest(makeRequest({ auditorName: "   " }));
    expect(errors.some((e) => e.includes("auditorName"))).toBe(true);
  });

  it("errors when auditorOrg is empty", () => {
    const errors = validateViewKeyRequest(makeRequest({ auditorOrg: "" }));
    expect(errors.some((e) => e.includes("auditorOrg"))).toBe(true);
  });

  it("errors when scope is invalid", () => {
    const errors = validateViewKeyRequest(makeRequest({ scope: "superuser" as never }));
    expect(errors.some((e) => e.includes("scope"))).toBe(true);
  });

  it("errors when expiresAt is not a valid date string", () => {
    const errors = validateViewKeyRequest(makeRequest({ expiresAt: "not-a-date" }));
    expect(errors.some((e) => e.includes("expiresAt"))).toBe(true);
  });

  it("errors when expiresAt is in the past", () => {
    const errors = validateViewKeyRequest(makeRequest({ expiresAt: "2000-01-01T00:00:00.000Z" }));
    expect(errors.some((e) => e.includes("expiresAt"))).toBe(true);
  });

  it("accepts a future expiresAt date", () => {
    const errors = validateViewKeyRequest(makeRequest({ expiresAt: "2099-01-01T00:00:00.000Z" }));
    expect(errors).toEqual([]);
  });

  it("accumulates multiple errors", () => {
    const errors = validateViewKeyRequest(
      makeRequest({ auditorName: "", auditorOrg: "", expiresAt: "bad" })
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// revokeViewKey
// ---------------------------------------------------------------------------

describe("revokeViewKey", () => {
  it("returns a successful revocation result", () => {
    const key = makeViewKey();
    const result = revokeViewKey(key, { id: key.id });

    expect(result.id).toBe(key.id);
    expect(result.success).toBe(true);
    expect(result.revokedAt).toBeTruthy();
    expect(new Date(result.revokedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("throws when the key is already inactive", () => {
    const key = makeViewKey({ isActive: false });
    expect(() => revokeViewKey(key, { id: key.id })).toThrow(/already inactive/);
  });

  it("throws when the id does not match", () => {
    const key = makeViewKey({ id: "vk_001" });
    expect(() => revokeViewKey(key, { id: "vk_999" })).toThrow(/mismatch/);
  });
});

// ---------------------------------------------------------------------------
// getViewKeyStatus
// ---------------------------------------------------------------------------

describe("getViewKeyStatus", () => {
  it("returns 'active' for a valid active key", () => {
    const key = makeViewKey();
    const entry = getViewKeyStatus(key, new Date());
    expect(entry.status).toBe("active");
  });

  it("returns 'revoked' for an inactive key", () => {
    const key = makeViewKey({
      isActive: false,
      revokedAt: new Date().toISOString(),
    });
    const entry = getViewKeyStatus(key, new Date());
    expect(entry.status).toBe("revoked");
  });

  it("returns 'expired' for an active key past its expiresAt", () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    const key = makeViewKey({ expiresAt: pastExpiry });
    const entry = getViewKeyStatus(key, new Date());
    expect(entry.status).toBe("expired");
  });

  it("includes revokedAt when present", () => {
    const revokedAt = "2025-11-15T14:30:00.000Z";
    const key = makeViewKey({ isActive: false, revokedAt });
    const entry = getViewKeyStatus(key);
    expect(entry.revokedAt).toBe(revokedAt);
  });

  it("maps all expected fields onto the entry", () => {
    const key = makeViewKey();
    const entry = getViewKeyStatus(key);
    expect(entry.id).toBe(key.id);
    expect(entry.keyId).toBe(key.keyId);
    expect(entry.auditorName).toBe(key.auditorName);
    expect(entry.auditorOrg).toBe(key.auditorOrg);
    expect(entry.scope).toBe(key.scope);
    expect(entry.expiresAt).toBe(key.expiresAt);
  });
});

// ---------------------------------------------------------------------------
// buildViewKeyStatusSummary
// ---------------------------------------------------------------------------

describe("buildViewKeyStatusSummary", () => {
  it("returns zero counts for an empty list", () => {
    const summary = buildViewKeyStatusSummary([]);
    expect(summary.totalActive).toBe(0);
    expect(summary.totalRevoked).toBe(0);
    expect(summary.totalExpired).toBe(0);
    expect(summary.keys).toEqual([]);
  });

  it("counts active, revoked, and expired keys correctly", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const keys: ViewKey[] = [
      makeViewKey({
        id: "vk_1",
        expiresAt: "2027-01-01T00:00:00.000Z",
        isActive: true,
      }),
      makeViewKey({
        id: "vk_2",
        isActive: false,
        revokedAt: "2025-11-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
      makeViewKey({
        id: "vk_3",
        expiresAt: "2025-01-01T00:00:00.000Z",
        isActive: true,
      }),
      makeViewKey({
        id: "vk_4",
        expiresAt: "2027-06-01T00:00:00.000Z",
        isActive: true,
      }),
    ];

    const summary = buildViewKeyStatusSummary(keys, now);

    expect(summary.totalActive).toBe(2);
    expect(summary.totalRevoked).toBe(1);
    expect(summary.totalExpired).toBe(1);
    expect(summary.keys).toHaveLength(4);
  });

  it("includes per-key detail entries", () => {
    const key = makeViewKey();
    const summary = buildViewKeyStatusSummary([key]);
    expect(summary.keys[0].id).toBe(key.id);
    expect(summary.keys[0].status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// isViewKeyValid
// ---------------------------------------------------------------------------

describe("isViewKeyValid", () => {
  it("returns true for an active, non-expired key", () => {
    expect(isViewKeyValid(makeViewKey())).toBe(true);
  });

  it("returns false for a revoked key", () => {
    expect(isViewKeyValid(makeViewKey({ isActive: false }))).toBe(false);
  });

  it("returns false when the key expires exactly at the reference time", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const key = makeViewKey({ expiresAt: now.toISOString() });
    // expiresAt <= now, so it should be expired
    expect(isViewKeyValid(key, now)).toBe(false);
  });

  it("returns true when the key expires one millisecond after the reference time", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const oneMillisLater = new Date(now.getTime() + 1).toISOString();
    const key = makeViewKey({ expiresAt: oneMillisLater });
    expect(isViewKeyValid(key, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterActiveViewKeys
// ---------------------------------------------------------------------------

describe("filterActiveViewKeys", () => {
  it("returns only active, non-expired keys", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const keys: ViewKey[] = [
      makeViewKey({
        id: "vk_active",
        expiresAt: "2027-01-01T00:00:00.000Z",
        isActive: true,
      }),
      makeViewKey({
        id: "vk_revoked",
        isActive: false,
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
      makeViewKey({
        id: "vk_expired",
        expiresAt: "2025-01-01T00:00:00.000Z",
        isActive: true,
      }),
    ];

    const active = filterActiveViewKeys(keys, now);

    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("vk_active");
  });

  it("returns an empty array when no keys are valid", () => {
    const keys = [makeViewKey({ isActive: false })];
    expect(filterActiveViewKeys(keys)).toEqual([]);
  });

  it("returns all keys when all are valid", () => {
    const keys = [makeViewKey({ id: "vk_a" }), makeViewKey({ id: "vk_b" })];
    expect(filterActiveViewKeys(keys)).toHaveLength(2);
  });
});
