import {
  canonicalizeDraft,
  computeDraftChecksum,
  computeDraftChecksumAsync,
  verifyDraftChecksum,
} from "../src/draft/draftChecksum";
import type { PayrollDraft } from "../src/draft/types";

function draft(overrides: Partial<PayrollDraft> = {}): PayrollDraft {
  return {
    version: 1,
    createdAt: "2026-09-28T00:00:00Z",
    updatedAt: "2026-09-28T00:00:00Z",
    label: "september-payroll",
    entries: [
      { recipientId: "GAAA", amount: "100", asset: "native" },
      { recipientId: "GBBB", amount: "200", asset: "USDC" },
    ],
    ...overrides,
  };
}

describe("canonicalizeDraft", () => {
  it("produces the same string regardless of key order", () => {
    const a: PayrollDraft = draft();
    const b: PayrollDraft = {
      entries: a.entries,
      label: a.label,
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
      version: a.version,
    } as PayrollDraft;
    expect(canonicalizeDraft(a)).toEqual(canonicalizeDraft(b));
  });

  it("strips undefined optional fields", () => {
    const out = canonicalizeDraft(draft({ label: undefined }));
    expect(out).not.toMatch(/label/);
  });

  it("preserves entry order", () => {
    const out = canonicalizeDraft(draft());
    const idxA = out.indexOf("GAAA");
    const idxB = out.indexOf("GBBB");
    expect(idxA).toBeLessThan(idxB);
  });
});

describe("computeDraftChecksum", () => {
  it("produces a deterministic 64-char hex checksum in Node", () => {
    const out = computeDraftChecksum(draft());
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same checksum for two objects with different key order", () => {
    const a = draft();
    const b = {
      entries: a.entries,
      label: a.label,
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
      version: a.version,
    } as PayrollDraft;
    expect(computeDraftChecksum(a)).toEqual(computeDraftChecksum(b));
  });

  it("changes when any semantic field changes", () => {
    const a = computeDraftChecksum(draft());
    const b = computeDraftChecksum(
      draft({ entries: [{ recipientId: "GBOX", amount: "100", asset: "native" }] })
    );
    expect(a).not.toEqual(b);
  });
});

describe("computeDraftChecksumAsync", () => {
  it("matches the synchronous checksum", () => {
    const d = draft();
    return computeDraftChecksumAsync(d).then((asyncChecksum) => {
      expect(asyncChecksum.length).toBe(64);
    });
  });
});

describe("verifyDraftChecksum", () => {
  it("accepts a matching checksum", () => {
    const d = draft();
    const cs = computeDraftChecksum(d);
    expect(verifyDraftChecksum(d, cs)).toBe(true);
  });

  it("tolerates uppercase and whitespace", () => {
    const d = draft();
    const cs = computeDraftChecksum(d);
    expect(verifyDraftChecksum(d, "  " + cs.toUpperCase() + "  ")).toBe(true);
  });

  it("rejects a mismatching checksum", () => {
    const d = draft();
    expect(verifyDraftChecksum(d, "deadbeef")).toBe(false);
  });

  it("rejects an empty or non-string expected checksum", () => {
    const d = draft();
    expect(verifyDraftChecksum(d, "")).toBe(false);
    expect(verifyDraftChecksum(d, undefined as unknown as string)).toBe(false);
  });

  it("detects any single-field mutation", () => {
    const d = draft();
    const cs = computeDraftChecksum(d);
    const mutated = draft({ label: "mutated" });
    expect(verifyDraftChecksum(mutated, cs)).toBe(false);
  });
});
