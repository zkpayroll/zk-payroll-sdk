import { validateMemo, formatMemo, previewMemo, MEMO_MAX_LENGTH } from "../src/treasury/memos";

describe("validateMemo", () => {
  it("treats a missing memo as valid", () => {
    expect(validateMemo(undefined)).toEqual({ isValid: true, errors: [] });
  });

  it("treats a valid memo as valid", () => {
    const result = validateMemo("Payroll for August 2026");
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("treats an empty string as valid", () => {
    expect(validateMemo("").isValid).toBe(true);
  });

  it("rejects a memo longer than MEMO_MAX_LENGTH", () => {
    const tooLong = "x".repeat(MEMO_MAX_LENGTH + 1);
    const result = validateMemo(tooLong);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: "memo", message: expect.stringContaining("100") })
    );
  });

  it("accepts a memo at exactly MEMO_MAX_LENGTH", () => {
    const exact = "x".repeat(MEMO_MAX_LENGTH);
    expect(validateMemo(exact).isValid).toBe(true);
  });

  it("rejects a memo with unsupported (control) characters", () => {
    const result = validateMemo("line one\nline two");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: "memo", message: expect.stringContaining("unsupported") })
    );
  });

  it("rejects a memo with a null byte", () => {
    expect(validateMemo("bad\0memo").isValid).toBe(false);
  });

  it("reports both errors when a memo is too long and has bad characters", () => {
    const bad = "x".repeat(MEMO_MAX_LENGTH + 1) + "\n";
    const result = validateMemo(bad);
    expect(result.errors).toHaveLength(2);
  });
});

describe("formatMemo", () => {
  it("returns undefined for a missing memo", () => {
    expect(formatMemo(undefined)).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(formatMemo("  hello  ")).toBe("hello");
  });

  it("returns undefined for a blank/whitespace-only memo", () => {
    expect(formatMemo("   ")).toBeUndefined();
  });

  it("leaves an already-trimmed memo unchanged", () => {
    expect(formatMemo("payroll batch 12")).toBe("payroll batch 12");
  });
});

describe("previewMemo", () => {
  it("returns undefined for a missing memo", () => {
    expect(previewMemo(undefined)).toBeUndefined();
  });

  it("returns the full memo when shorter than the preview length", () => {
    expect(previewMemo("short memo")).toBe("short memo");
  });

  it("truncates a long memo with an ellipsis", () => {
    const long = "a".repeat(80);
    const preview = previewMemo(long);
    expect(preview).toHaveLength(40);
    expect(preview?.endsWith("…")).toBe(true);
  });

  it("returns undefined for a blank memo", () => {
    expect(previewMemo("   ")).toBeUndefined();
  });
});
