import { AssetRegistryClass } from "../src/assets/AssetRegistry";
import { AssetMetadata } from "../src/assets/types";
import { formatAmount, parseAmount } from "../src/assets/formatters";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const XLM: AssetMetadata = {
  id: "native",
  symbol: "XLM",
  label: "Stellar Lumens",
  decimals: 7,
  displayFormat: "decimal",
};

const USDC: AssetMetadata = {
  id: "USDC",
  symbol: "USDC",
  label: "USD Coin",
  decimals: 7,
  displayFormat: "decimal",
};

const EUROC: AssetMetadata = {
  id: "EUROC",
  symbol: "EUROC",
  label: "Euro Coin",
  decimals: 7,
  displayFormat: "decimal",
};

/** A custom Soroban token for extension tests */
const CUSTOM_TOKEN = {
  id: "CTOKEN_CUSTOM123",
  symbol: "CTKN",
  label: "Custom Company Token",
  decimals: 7,
};

// ── AssetRegistryClass ────────────────────────────────────────────────────────

describe("AssetRegistryClass — built-in assets", () => {
  // Use a fresh registry seeded with the default built-ins for each test group.
  let registry: AssetRegistryClass;

  beforeEach(() => {
    registry = new AssetRegistryClass();
  });

  it("pre-registers native/XLM", () => {
    const meta = registry.get("native");
    expect(meta).toBeDefined();
    expect(meta?.symbol).toBe("XLM");
    expect(meta?.decimals).toBe(7);
  });

  it("pre-registers USDC", () => {
    expect(registry.get("USDC")).toBeDefined();
    expect(registry.get("USDC")?.symbol).toBe("USDC");
  });

  it("pre-registers EUROC", () => {
    expect(registry.get("EUROC")).toBeDefined();
    expect(registry.get("EUROC")?.symbol).toBe("EUROC");
  });

  it("lists all built-in assets", () => {
    const list = registry.list();
    expect(list.length).toBe(3);
    const symbols = list.map((a) => a.symbol);
    expect(symbols).toContain("XLM");
    expect(symbols).toContain("USDC");
    expect(symbols).toContain("EUROC");
  });

  it("applies default displayFormat 'decimal' to built-ins", () => {
    expect(registry.getOrThrow("native").displayFormat).toBe("decimal");
  });
});

// ── get / has / getOrThrow ─────────────────────────────────────────────────

describe("AssetRegistryClass — get / has / getOrThrow", () => {
  let registry: AssetRegistryClass;

  beforeEach(() => {
    registry = new AssetRegistryClass([XLM, USDC]);
  });

  it("returns undefined for an unregistered asset id", () => {
    expect(registry.get("NOT_REGISTERED")).toBeUndefined();
  });

  it("returns undefined for an unregistered symbol", () => {
    expect(registry.get("NOPE")).toBeUndefined();
  });

  it("looks up by asset id (exact)", () => {
    expect(registry.get("native")?.id).toBe("native");
  });

  it("looks up by symbol (case-insensitive)", () => {
    expect(registry.get("xlm")?.id).toBe("native");
    expect(registry.get("XLM")?.id).toBe("native");
    expect(registry.get("Xlm")?.id).toBe("native");
  });

  it("has() returns true for a registered id", () => {
    expect(registry.has("native")).toBe(true);
  });

  it("has() returns true for a registered symbol (case-insensitive)", () => {
    expect(registry.has("usdc")).toBe(true);
  });

  it("has() returns false for an unregistered asset", () => {
    expect(registry.has("GHOST")).toBe(false);
  });

  it("getOrThrow returns the metadata when registered", () => {
    const meta = registry.getOrThrow("native");
    expect(meta.symbol).toBe("XLM");
  });

  it("getOrThrow throws a descriptive error for unknown assets", () => {
    expect(() => registry.getOrThrow("GHOST")).toThrow(/no metadata found for asset "GHOST"/i);
    expect(() => registry.getOrThrow("GHOST")).toThrow(/register it first/i);
  });
});

// ── register / registerMany ────────────────────────────────────────────────

describe("AssetRegistryClass — register", () => {
  let registry: AssetRegistryClass;

  beforeEach(() => {
    // Start empty to isolate each test
    registry = new AssetRegistryClass([]);
  });

  it("registers a new asset and returns the stored metadata", () => {
    const result = registry.register(CUSTOM_TOKEN);
    expect(result.id).toBe(CUSTOM_TOKEN.id);
    expect(result.symbol).toBe("CTKN");
    expect(result.decimals).toBe(7);
  });

  it("newly registered asset is retrievable by id", () => {
    registry.register(CUSTOM_TOKEN);
    expect(registry.get(CUSTOM_TOKEN.id)).toBeDefined();
  });

  it("newly registered asset is retrievable by symbol (case-insensitive)", () => {
    registry.register(CUSTOM_TOKEN);
    expect(registry.get("ctkn")).toBeDefined();
    expect(registry.get("CTKN")).toBeDefined();
  });

  it("defaults displayFormat to 'decimal' when omitted", () => {
    const result = registry.register({ id: "T", symbol: "TTT", label: "Test", decimals: 6 });
    expect(result.displayFormat).toBe("decimal");
  });

  it("preserves explicit displayFormat 'integer'", () => {
    const result = registry.register({
      id: "T2",
      symbol: "INT",
      label: "Integer Token",
      decimals: 0,
      displayFormat: "integer",
    });
    expect(result.displayFormat).toBe("integer");
  });

  it("replaces an existing entry with the same id", () => {
    registry.register(CUSTOM_TOKEN);
    registry.register({ ...CUSTOM_TOKEN, label: "Updated Label", symbol: "CTKN2" });
    const meta = registry.getOrThrow(CUSTOM_TOKEN.id);
    expect(meta.label).toBe("Updated Label");
    expect(meta.symbol).toBe("CTKN2");
  });

  it("cleans up the old symbol index when replacing an entry", () => {
    registry.register(CUSTOM_TOKEN); // symbol: CTKN
    registry.register({ ...CUSTOM_TOKEN, symbol: "CTKN2" }); // replaces it
    // Old symbol should no longer resolve
    expect(registry.get("ctkn")).toBeUndefined();
    // New symbol should work
    expect(registry.get("ctkn2")).toBeDefined();
  });

  it("stores customData without modification", () => {
    registry.register({ ...CUSTOM_TOKEN, customData: { riskTier: "high", apr: 0.05 } });
    expect(registry.getOrThrow(CUSTOM_TOKEN.id).customData).toEqual({
      riskTier: "high",
      apr: 0.05,
    });
  });

  it("stores iconUrl without modification", () => {
    registry.register({ ...CUSTOM_TOKEN, iconUrl: "https://example.com/icon.png" });
    expect(registry.getOrThrow(CUSTOM_TOKEN.id).iconUrl).toBe("https://example.com/icon.png");
  });

  it("registerMany adds all provided entries", () => {
    registry.registerMany([XLM, USDC, EUROC]);
    expect(registry.list().length).toBe(3);
    expect(registry.has("native")).toBe(true);
    expect(registry.has("USDC")).toBe(true);
    expect(registry.has("EUROC")).toBe(true);
  });

  it("registerMany works with an empty array (no-op)", () => {
    registry.registerMany([]);
    expect(registry.list().length).toBe(0);
  });
});

// ── remove ────────────────────────────────────────────────────────────────

describe("AssetRegistryClass — remove", () => {
  let registry: AssetRegistryClass;

  beforeEach(() => {
    registry = new AssetRegistryClass([XLM, USDC]);
  });

  it("removes a registered asset and returns true", () => {
    expect(registry.remove("native")).toBe(true);
    expect(registry.has("native")).toBe(false);
  });

  it("also cleans up the symbol index after removal", () => {
    registry.remove("native");
    expect(registry.get("xlm")).toBeUndefined();
  });

  it("returns false for an unknown id", () => {
    expect(registry.remove("GHOST")).toBe(false);
  });

  it("list() reflects removal", () => {
    registry.remove("USDC");
    const ids = registry.list().map((a) => a.id);
    expect(ids).not.toContain("USDC");
  });
});

// ── Isolated registry (empty seed) ────────────────────────────────────────

describe("AssetRegistryClass — empty initialization", () => {
  it("starts with zero entries when initialized with empty array", () => {
    const registry = new AssetRegistryClass([]);
    expect(registry.list().length).toBe(0);
  });

  it("is fully independent from the shared singleton", () => {
    const registry = new AssetRegistryClass([]);
    // Modifying this registry must not affect the globally imported singleton.
    registry.register(CUSTOM_TOKEN);
    // We can only test isolation here: the fresh registry has the entry
    expect(registry.has(CUSTOM_TOKEN.id)).toBe(true);
  });
});

// ── formatAmount ─────────────────────────────────────────────────────────────

describe("formatAmount", () => {
  it("formats XLM from stroops with 7 decimal places", () => {
    expect(formatAmount(10_000_000n, XLM, { locale: "en-US" })).toBe("1.0000000 XLM");
  });

  it("formats zero correctly", () => {
    expect(formatAmount(0n, XLM, { locale: "en-US" })).toBe("0.0000000 XLM");
  });

  it("formats a fractional amount", () => {
    // 0.0000001 XLM = 1 stroop
    expect(formatAmount(1n, XLM, { locale: "en-US" })).toBe("0.0000001 XLM");
  });

  it("formats large amounts with grouping separators", () => {
    // 10,000 XLM
    const result = formatAmount(100_000_000_000n, XLM, { locale: "en-US" });
    expect(result).toBe("10,000.0000000 XLM");
  });

  it("omits symbol when includeSymbol is false", () => {
    const result = formatAmount(10_000_000n, XLM, { locale: "en-US", includeSymbol: false });
    expect(result).toBe("1.0000000");
  });

  it("uses asset symbol from metadata", () => {
    const result = formatAmount(10_000_000n, USDC, { locale: "en-US" });
    expect(result).toContain("USDC");
  });

  it("uses integer display format when displayFormat is 'integer'", () => {
    const intToken: AssetMetadata = {
      id: "INT",
      symbol: "INT",
      label: "Integer Token",
      decimals: 0,
      displayFormat: "integer",
    };
    const result = formatAmount(42000n, intToken, { locale: "en-US" });
    expect(result).toBe("42,000 INT");
  });

  it("treats decimals=0 as integer format even without explicit displayFormat", () => {
    const zeroDecimals: AssetMetadata = {
      id: "Z",
      symbol: "ZZZ",
      label: "Zero Decimals",
      decimals: 0,
    };
    expect(formatAmount(999n, zeroDecimals, { locale: "en-US" })).toBe("999 ZZZ");
  });

  it("defaults includeSymbol to true", () => {
    const result = formatAmount(10_000_000n, XLM, { locale: "en-US" });
    expect(result).toMatch(/XLM$/);
  });
});

// ── parseAmount ───────────────────────────────────────────────────────────────

describe("parseAmount", () => {
  it("parses a plain decimal string to bigint", () => {
    expect(parseAmount("1.0000000", XLM)).toBe(10_000_000n);
  });

  it("parses a string with the asset symbol appended", () => {
    expect(parseAmount("1.0000000 XLM", XLM)).toBe(10_000_000n);
  });

  it("parses a string with symbol (case-insensitive)", () => {
    expect(parseAmount("1.0000000 xlm", XLM)).toBe(10_000_000n);
  });

  it("parses a string with comma grouping separator", () => {
    // 10,000 XLM → 100_000_000_000 stroops
    expect(parseAmount("10,000.0000000 XLM", XLM)).toBe(100_000_000_000n);
  });

  it("parses zero", () => {
    expect(parseAmount("0.0000000", XLM)).toBe(0n);
    expect(parseAmount("0", XLM)).toBe(0n);
  });

  it("parses a minimal fractional amount (1 stroop)", () => {
    expect(parseAmount("0.0000001", XLM)).toBe(1n);
  });

  it("truncates extra decimal digits beyond precision", () => {
    // 1.000000099 treated as 1.0000000 (truncated to 7 decimals)
    expect(parseAmount("1.000000099", XLM)).toBe(10_000_000n);
  });

  it("pads missing fractional digits to full precision", () => {
    // "1.5" with 7 decimals → 1.5000000 → 15_000_000 stroops
    expect(parseAmount("1.5", XLM)).toBe(15_000_000n);
  });

  it("parses integer strings with no decimal point", () => {
    expect(parseAmount("1", XLM)).toBe(10_000_000n);
    expect(parseAmount("100", XLM)).toBe(1_000_000_000n);
  });

  it("throws on non-numeric input by default", () => {
    expect(() => parseAmount("not-a-number", XLM)).toThrow(/cannot parse/i);
  });

  it("throws on empty string", () => {
    expect(() => parseAmount("", XLM)).toThrow(/cannot parse/i);
  });

  it("strips currency signs ($ € £ ¥)", () => {
    // Non-standard but common in copy-paste from UIs
    expect(parseAmount("$1.0000000", XLM)).toBe(10_000_000n);
  });

  it("round-trips formatAmount → parseAmount correctly", () => {
    const original = 123_456_789n;
    const formatted = formatAmount(original, USDC, { locale: "en-US" });
    const parsed = parseAmount(formatted, USDC);
    expect(parsed).toBe(original);
  });

  it("round-trips parseAmount → formatAmount correctly", () => {
    const input = "999.9990000 EUROC";
    const parsed = parseAmount(input, EUROC);
    const formatted = formatAmount(parsed, EUROC, { locale: "en-US" });
    expect(formatted).toBe("999.9990000 EUROC");
  });
});

// ── formatAmount + parseAmount with custom token ───────────────────────────

describe("formatAmount / parseAmount — custom registered asset", () => {
  const customRegistry = new AssetRegistryClass([]);
  const MYTKN: AssetMetadata = customRegistry.register({
    id: "CT_XYZ",
    symbol: "MYTKN",
    label: "My Payroll Token",
    decimals: 7,
    displayFormat: "decimal",
  });

  it("formats custom token correctly", () => {
    expect(formatAmount(50_000_000n, MYTKN, { locale: "en-US" })).toBe("5.0000000 MYTKN");
  });

  it("parses custom token amount correctly", () => {
    expect(parseAmount("5.0000000 MYTKN", MYTKN)).toBe(50_000_000n);
  });

  it("custom token is present in registry list", () => {
    expect(customRegistry.has("CT_XYZ")).toBe(true);
    expect(customRegistry.has("mytkn")).toBe(true);
  });
});
