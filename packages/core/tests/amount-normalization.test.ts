/**
 * Tests for the canonical amount normalization helper.
 *
 * Covers:
 *  - normalizeCanonicalAmount — input coercion (string/number/bigint), asset
 *    resolution (id string vs metadata vs custom registry), rounding, bounds
 *  - tryNormalizeCanonicalAmount — non-throwing success/failure discriminated
 *    union, propagation of unrelated errors
 *  - Result shape — assetSymbol, assetId, decimals, wasRounded, original
 *  - Bigint-as-canonical convention — round-trip without scaling
 */

import {
  AmountParseError,
  AmountParseErrorCode,
  RoundingMode,
  AssetRegistryClass,
} from "../src/assets";
import {
  normalizeCanonicalAmount,
  tryNormalizeCanonicalAmount,
} from "../src/assets/amountNormalization";
import type { AssetMetadata } from "../src/assets/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const xlm: AssetMetadata = {
  id: "native",
  symbol: "XLM",
  label: "Stellar Lumens",
  decimals: 7,
};

// ---------------------------------------------------------------------------
// normalizeCanonicalAmount — happy path: input coercion
// ---------------------------------------------------------------------------

describe("normalizeCanonicalAmount() — input coercion", () => {
  it("parses a clean decimal string", () => {
    const result = normalizeCanonicalAmount("100.50", xlm);
    expect(result.amount).toBe(1_005_000_000n);
    expect(result.decimals).toBe(7);
    expect(result.assetSymbol).toBe("XLM");
    expect(result.assetId).toBe("native");
    expect(result.wasRounded).toBe(false);
    expect(result.original).toBe("100.50");
  });

  it("strips thousands separators, currency symbols, and whitespace", () => {
    const result = normalizeCanonicalAmount("  $1,000.50 XLM  ", xlm);
    expect(result.amount).toBe(10_005_000_000n);
    expect(result.assetSymbol).toBe("XLM");
    expect(result.wasRounded).toBe(false);
  });

  it("preserves the raw input string verbatim in `original`", () => {
    const input = "  $1,000.50 XLM ";
    const result = normalizeCanonicalAmount(input, xlm);
    expect(result.original).toBe(input);
    // ... but the parsed amount ignores formatting artifacts.
    expect(result.amount).toBe(10_005_000_000n);
  });

  it("coerces a finite number input via toString()", () => {
    const result = normalizeCanonicalAmount(1000.5, xlm);
    expect(result.amount).toBe(10_005_000_000n);
    expect(result.wasRounded).toBe(false);
    expect(result.original).toBe("1000.5");
  });

  it("treats bigint input as canonical smallest-unit (round-trip)", () => {
    const result = normalizeCanonicalAmount(10_005_000_000n, xlm);
    expect(result.amount).toBe(10_005_000_000n);
    expect(result.wasRounded).toBe(false);
    expect(result.decimals).toBe(7);
    expect(result.original).toBe("10005000000");
  });

  it("does not double-scale a bigint that already represents stroops", () => {
    // If a user has 10 XLM worth of stroops = 100_000_000n, passing it as a
    // bigint must yield exactly 100_000_000n — never 10^7 × 100_000_000n.
    const result = normalizeCanonicalAmount(100_000_000n, xlm);
    expect(result.amount).toBe(100_000_000n);
  });

  it("rejects non-finite number inputs via EMPTY_INPUT", () => {
    expect(() => normalizeCanonicalAmount(NaN, xlm)).toThrow(AmountParseError);
    expect(() => normalizeCanonicalAmount(Infinity, xlm)).toThrow(AmountParseError);
  });

  it("rejects null and undefined via EMPTY_INPUT", () => {
    expect(() => normalizeCanonicalAmount(null, xlm)).toThrow(AmountParseError);
    expect(() => normalizeCanonicalAmount(undefined, xlm)).toThrow(AmountParseError);
  });

  it("rejects non-string/non-number/non-bigint via EMPTY_INPUT", () => {
    expect(() => normalizeCanonicalAmount({}, xlm)).toThrow(AmountParseError);
    expect(() => normalizeCanonicalAmount([], xlm)).toThrow(AmountParseError);
  });
});

// ---------------------------------------------------------------------------
// normalizeCanonicalAmount — asset resolution
// ---------------------------------------------------------------------------

describe("normalizeCanonicalAmount() — asset resolution", () => {
  it("resolves an asset by id via the shared singleton registry", () => {
    const result = normalizeCanonicalAmount("100", "native");
    expect(result.assetId).toBe("native");
    expect(result.assetSymbol).toBe("XLM");
    expect(result.decimals).toBe(7);
  });

  it("resolves an asset by ticker symbol (case-insensitive)", () => {
    const result = normalizeCanonicalAmount("100", "usdc");
    expect(result.assetId).toBe("USDC");
    expect(result.assetSymbol).toBe("USDC");
    expect(result.decimals).toBe(7);
    expect(result.amount).toBe(1_000_000_000n);
  });

  it("uses an explicit AssetMetadata object without touching the registry", () => {
    const customMeta: AssetMetadata = {
      id: "CUSTOM_X",
      symbol: "CUSX",
      label: "Custom",
      decimals: 4, // different precision than built-ins
    };
    const result = normalizeCanonicalAmount("1.5", customMeta);
    expect(result.assetId).toBe("CUSTOM_X");
    expect(result.assetSymbol).toBe("CUSX");
    expect(result.decimals).toBe(4);
    expect(result.amount).toBe(15_000n); // 1.5 × 10^4
  });

  it("uses a custom registry when supplied", () => {
    const registry = new AssetRegistryClass([]);
    registry.register({
      id: "CISOLATED",
      symbol: "ISO",
      label: "Isolated",
      decimals: 6,
    });
    const result = normalizeCanonicalAmount("2.5", "ISO", { registry });
    expect(result.assetId).toBe("CISOLATED");
    expect(result.decimals).toBe(6);
    expect(result.amount).toBe(2_500_000n);
  });

  it("does not mutate the shared singleton when a custom registry is used", () => {
    const registry = new AssetRegistryClass([]);
    registry.register({
      id: "CISOLATED2",
      symbol: "ISO2",
      label: "Isolated",
      decimals: 7,
    });
    expect(() => normalizeCanonicalAmount("1", "ISO2")).toThrow(/no metadata found/i);
    expect(() => normalizeCanonicalAmount("1", "ISO2", { registry })).not.toThrow();
  });

  it("throws when the asset id is not registered", () => {
    expect(() => normalizeCanonicalAmount("1", "GHOST")).toThrow(/no metadata found/i);
  });

  it("asset resolution works identically for bigint inputs", () => {
    const result = normalizeCanonicalAmount(1_000_000_000n, "USDC");
    expect(result.assetId).toBe("USDC");
    expect(result.assetSymbol).toBe("USDC");
    expect(result.amount).toBe(1_000_000_000n);
  });
});

// ---------------------------------------------------------------------------
// normalizeCanonicalAmount — rounding and bounds
// ---------------------------------------------------------------------------

describe("normalizeCanonicalAmount() — rounding and bounds", () => {
  it("flags wasRounded when excess precision is rounded", () => {
    const result = normalizeCanonicalAmount("100.12345678", xlm);
    expect(result.wasRounded).toBe(true);
    expect(result.amount).toBe(1_001_234_568n);
  });

  it("respects TRUNCATE rounding mode", () => {
    const result = normalizeCanonicalAmount("100.12345678", xlm, {
      rounding: RoundingMode.TRUNCATE,
    });
    expect(result.amount).toBe(1_001_234_567n);
    expect(result.wasRounded).toBe(true);
  });

  it("respects CEIL rounding mode", () => {
    const result = normalizeCanonicalAmount("1.00000001", xlm, {
      rounding: RoundingMode.CEIL,
    });
    expect(result.amount).toBe(10_000_001n);
    expect(result.wasRounded).toBe(true);
  });

  it("enforces min bounds and throws BELOW_MINIMUM", () => {
    expect(() => normalizeCanonicalAmount("0.0000001", xlm, { bounds: { min: 2n } })).toThrow(
      AmountParseError
    );

    try {
      normalizeCanonicalAmount("0.0000001", xlm, { bounds: { min: 2n } });
    } catch (err) {
      expect((err as AmountParseError).code).toBe(AmountParseErrorCode.BELOW_MINIMUM);
    }
  });

  it("enforces max bounds and throws EXCEEDS_MAXIMUM", () => {
    expect(() =>
      normalizeCanonicalAmount("1001", xlm, { bounds: { max: 10_000_000_000n } })
    ).toThrow(AmountParseError);

    try {
      normalizeCanonicalAmount("1001", xlm, { bounds: { max: 10_000_000_000n } });
    } catch (err) {
      expect((err as AmountParseError).code).toBe(AmountParseErrorCode.EXCEEDS_MAXIMUM);
    }
  });

  it("passes when amount sits inside configured bounds", () => {
    const result = normalizeCanonicalAmount("100", xlm, {
      bounds: { min: 1n, max: 10_000_000_000n },
    });
    expect(result.amount).toBe(1_000_000_000n);
  });

  it("applies bounds to bigint inputs too", () => {
    expect(() => normalizeCanonicalAmount(0n, xlm, { bounds: { min: 1n } })).toThrow(
      AmountParseError
    );
    expect(() => normalizeCanonicalAmount(100n, xlm, { bounds: { max: 50n } })).toThrow(
      AmountParseError
    );
    expect(normalizeCanonicalAmount(100n, xlm, { bounds: { min: 1n, max: 200n } }).amount).toBe(
      100n
    );
  });

  it("rejects negative values with NEGATIVE_VALUE", () => {
    try {
      normalizeCanonicalAmount("-5", xlm);
    } catch (err) {
      expect((err as AmountParseError).code).toBe(AmountParseErrorCode.NEGATIVE_VALUE);
    }
  });

  it("rejects zero values with ZERO_VALUE", () => {
    try {
      normalizeCanonicalAmount("0", xlm);
    } catch (err) {
      expect((err as AmountParseError).code).toBe(AmountParseErrorCode.ZERO_VALUE);
    }
  });

  it("rejects invalid format with INVALID_FORMAT", () => {
    try {
      normalizeCanonicalAmount("not-a-number", xlm);
    } catch (err) {
      expect((err as AmountParseError).code).toBe(AmountParseErrorCode.INVALID_FORMAT);
    }
  });

  it("rejects negative bigint with NEGATIVE_VALUE (mirrors string rejection)", () => {
    try {
      normalizeCanonicalAmount(-5n, xlm);
    } catch (err) {
      expect((err as AmountParseError).code).toBe(AmountParseErrorCode.NEGATIVE_VALUE);
    }
  });

  it("rejects zero bigint with ZERO_VALUE (mirrors string rejection)", () => {
    try {
      normalizeCanonicalAmount(0n, xlm);
    } catch (err) {
      expect((err as AmountParseError).code).toBe(AmountParseErrorCode.ZERO_VALUE);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeCanonicalAmount — multi-asset scaling
// ---------------------------------------------------------------------------

describe("normalizeCanonicalAmount() — multi-asset scaling", () => {
  it("uses each asset's own decimals", () => {
    const custom: AssetMetadata = {
      id: "CZERO_DEC",
      symbol: "ZDC",
      label: "Zero Decimal",
      decimals: 0,
    };
    expect(normalizeCanonicalAmount("42", custom).amount).toBe(42n);
    expect(normalizeCanonicalAmount("42", custom).decimals).toBe(0);
  });

  it("scales USDC amounts the same as XLM (both 7 decimals)", () => {
    const usdcResult = normalizeCanonicalAmount("1.5", "USDC");
    expect(usdcResult.amount).toBe(15_000_000n);
    expect(usdcResult.decimals).toBe(7);
    expect(usdcResult.assetSymbol).toBe("USDC");
  });

  it("scales an 18-decimal token correctly", () => {
    const eighteen: AssetMetadata = {
      id: "CEIGHTEEN",
      symbol: "ETH",
      label: "Eth-like",
      decimals: 18,
    };
    expect(normalizeCanonicalAmount("1", eighteen).amount).toBe(1_000_000_000_000_000_000n);
  });
});

// ---------------------------------------------------------------------------
// tryNormalizeCanonicalAmount — non-throwing variant
// ---------------------------------------------------------------------------

describe("tryNormalizeCanonicalAmount()", () => {
  it("returns ok=true with the value on success", () => {
    const result = tryNormalizeCanonicalAmount("1,000.50 XLM", "native");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amount).toBe(10_005_000_000n);
      expect(result.value.assetSymbol).toBe("XLM");
    } else {
      // TS narrowing
      throw new Error("expected ok");
    }
  });

  it("returns ok=false with a typed AmountParseError on validation failure", () => {
    const result = tryNormalizeCanonicalAmount("not-a-number", "native");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AmountParseError);
      expect(result.error.code).toBe(AmountParseErrorCode.INVALID_FORMAT);
      expect(result.error.context).toMatchObject({ assetSymbol: "XLM" });
    } else {
      throw new Error("expected failure");
    }
  });

  it("returns ok=false on zero values", () => {
    const result = tryNormalizeCanonicalAmount("0", "USDC");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AmountParseErrorCode.ZERO_VALUE);
    }
  });

  it("returns ok=false on negative values", () => {
    const result = tryNormalizeCanonicalAmount("-1", "USDC");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AmountParseErrorCode.NEGATIVE_VALUE);
    }
  });

  it("returns ok=false on empty input", () => {
    const result = tryNormalizeCanonicalAmount("", "USDC");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AmountParseErrorCode.EMPTY_INPUT);
    }
  });

  it("does NOT catch non-AmountParseError exceptions (asset-not-found propagates)", () => {
    // `getOrThrow` raises a plain Error, which `tryNormalizeCanonicalAmount`
    // must not swallow — callers handling only amount-level failures should
    // see unrelated surprises. The thrown error must be a plain `Error`,
    // not an `AmountParseError`, so callers can distinguish the two.
    let caught: unknown;
    try {
      tryNormalizeCanonicalAmount("1", "GHOST_ASSET");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(AmountParseError);
  });

  it("supports the same options as the throwing variant", () => {
    const result = tryNormalizeCanonicalAmount("100.12345678", "native", {
      rounding: RoundingMode.TRUNCATE,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amount).toBe(1_001_234_567n);
      expect(result.value.wasRounded).toBe(true);
    }
  });

  it("bigint success also returns ok=true with the canonical amount", () => {
    const result = tryNormalizeCanonicalAmount(10_005_000_000n, "native");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amount).toBe(10_005_000_000n);
      expect(result.value.wasRounded).toBe(false);
    }
  });

  it("bigint failure (bounds) returns ok=false with a typed AmountParseError", () => {
    // Use a positive value so we actually exercise the bounds branch
    // (0n is rejected earlier by the ZERO_VALUE check).
    const result = tryNormalizeCanonicalAmount(5n, "native", { bounds: { min: 10n } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AmountParseErrorCode.BELOW_MINIMUM);
    }
  });

  it("bigint zero returns ok=false with ZERO_VALUE (no bounds needed)", () => {
    const result = tryNormalizeCanonicalAmount(0n, "native");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AmountParseErrorCode.ZERO_VALUE);
    }
  });

  it("bigint negative returns ok=false with NEGATIVE_VALUE", () => {
    const result = tryNormalizeCanonicalAmount(-1n, "native");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AmountParseErrorCode.NEGATIVE_VALUE);
    }
  });
});

// ---------------------------------------------------------------------------
// NormalizedAmount — shape contract
// ---------------------------------------------------------------------------

describe("NormalizedAmount shape", () => {
  it("returns every documented field on success", () => {
    const result = normalizeCanonicalAmount("1.0000000", xlm);
    expect(Object.keys(result).sort()).toEqual(
      ["amount", "assetId", "assetSymbol", "decimals", "original", "wasRounded"].sort()
    );
  });
});
