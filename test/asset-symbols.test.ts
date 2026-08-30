import {
  normalizeAssetSymbol,
  isValidAssetSymbol,
  formatAssetSymbolForDisplay,
  normalizeAssetForContract,
} from "../src/assets/symbols";
import { ValidationError } from "../src/core/errors";

describe("normalizeAssetSymbol", () => {
  it("normalizes lowercase to uppercase", () => {
    expect(normalizeAssetSymbol("usdc")).toBe("USDC");
    expect(normalizeAssetSymbol("xlm")).toBe("XLM");
  });

  it("trims whitespace and uppercases", () => {
    expect(normalizeAssetSymbol("  usdc  ")).toBe("USDC");
    expect(normalizeAssetSymbol("  Native ")).toBe("NATIVE");
    expect(normalizeAssetSymbol("\t usdc\n")).toBe("USDC");
  });

  it("is idempotent for already-normalized values", () => {
    expect(normalizeAssetSymbol("USDC")).toBe("USDC");
    expect(normalizeAssetSymbol("NATIVE")).toBe("NATIVE");
  });

  it("handles contract addresses (C...) case-insensitively", () => {
    expect(normalizeAssetSymbol("cabc123")).toBe("CABC123");
  });

  // Failure paths
  it("throws ValidationError when symbol is empty string", () => {
    expect(() => normalizeAssetSymbol("")).toThrow(ValidationError);
    expect(() => normalizeAssetSymbol("")).toThrow(/required|cannot be empty/i);
  });

  it("throws when symbol is whitespace-only", () => {
    expect(() => normalizeAssetSymbol("   ")).toThrow(ValidationError);
    expect(() => normalizeAssetSymbol("\t\n")).toThrow(ValidationError);
  });

  it("throws when symbol is not a string (null, undefined, number, object)", () => {
    expect(() => normalizeAssetSymbol(null as unknown as string)).toThrow(ValidationError);
    expect(() => normalizeAssetSymbol(undefined as unknown as string)).toThrow(ValidationError);
    expect(() => normalizeAssetSymbol(123 as unknown as string)).toThrow(
      /must be a non-empty string/
    );
    expect(() => normalizeAssetSymbol({} as unknown as string)).toThrow(ValidationError);
  });

  // Edge case
  it("handles mixed casing with numbers and symbols", () => {
    expect(normalizeAssetSymbol(" usD1 ")).toBe("USD1");
  });

  it("error includes field 'asset' and code VALIDATION_ERROR", () => {
    try {
      normalizeAssetSymbol("");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe("asset");
      expect((e as ValidationError).code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("isValidAssetSymbol", () => {
  it("returns true for valid symbols", () => {
    expect(isValidAssetSymbol("usdc")).toBe(true);
    expect(isValidAssetSymbol("  USDC  ")).toBe(true);
    expect(isValidAssetSymbol("NATIVE")).toBe(true);
  });

  it("returns false for invalid symbols", () => {
    expect(isValidAssetSymbol("")).toBe(false);
    expect(isValidAssetSymbol("   ")).toBe(false);
    expect(isValidAssetSymbol(null)).toBe(false);
    expect(isValidAssetSymbol(undefined)).toBe(false);
    expect(isValidAssetSymbol(123)).toBe(false);
  });

  // Edge: does not throw
  it("does not throw on any input", () => {
    expect(() => isValidAssetSymbol(null)).not.toThrow();
    expect(() => isValidAssetSymbol(undefined)).not.toThrow();
  });
});

describe("formatAssetSymbolForDisplay", () => {
  it("returns normalized symbol for valid input", () => {
    expect(formatAssetSymbolForDisplay("usdc")).toBe("USDC");
    expect(formatAssetSymbolForDisplay("  native  ")).toBe("NATIVE");
  });

  it("returns fallback for invalid input", () => {
    expect(formatAssetSymbolForDisplay("", "—")).toBe("—");
    expect(formatAssetSymbolForDisplay(null, "N/A")).toBe("N/A");
    expect(formatAssetSymbolForDisplay(undefined)).toBe("—");
  });

  it("uses default fallback when not provided", () => {
    expect(formatAssetSymbolForDisplay("")).toBe("—");
  });
});

describe("normalizeAssetForContract", () => {
  it("returns normalized symbol for contract call", () => {
    expect(normalizeAssetForContract("usdc")).toBe("USDC");
    expect(normalizeAssetForContract("  xlm ")).toBe("XLM");
  });

  it("throws ValidationError with actionable remediation on invalid symbol", () => {
    expect(() => normalizeAssetForContract("")).toThrow(ValidationError);
    expect(() => normalizeAssetForContract("")).toThrow(/Provide a non-empty asset symbol/);
    expect(() => normalizeAssetForContract(null as unknown as string)).toThrow(
      /Provide a non-empty asset symbol/
    );
  });

  it("does not expose payroll-sensitive values in error (privacy)", () => {
    try {
      normalizeAssetForContract("");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toMatch(/recipient|amount|secret|privateKey/i);
      expect(msg).toMatch(/USDC|NATIVE|non-empty asset symbol/i);
    }
  });
});

describe("privacy – asset helpers do not leak sensitive values", () => {
  it("normalization output contains only symbol data", () => {
    const result = normalizeAssetSymbol("usdc");
    expect(result).toBe("USDC");
    // Ensure no accidental inclusion of amount/recipient in return
    expect(typeof result).toBe("string");
    expect(result).not.toMatch(/G[A-Z0-9]/);
  });
});
