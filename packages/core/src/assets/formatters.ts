import { AssetMetadata } from "./types";

/**
 * Options accepted by `formatAmount`.
 */
export interface FormatAmountOptions {
  /**
   * BCP-47 locale string used for number formatting.
   * Defaults to `"en-US"` for predictable output in non-browser environments.
   */
  locale?: string;

  /**
   * Whether to append the asset symbol to the formatted string.
   * Defaults to `true`.
   *
   * @example
   * // includeSymbol: true  → "1,000.50 USDC"
   * // includeSymbol: false → "1,000.50"
   */
  includeSymbol?: boolean;
}

/**
 * Options accepted by `parseAmount`.
 */
export interface ParseAmountOptions {
  /**
   * When `true`, `parseAmount` returns `null` instead of throwing when
   * the input cannot be parsed.  Useful for form validation flows.
   * Defaults to `false`.
   */
  strict?: boolean;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build the `10 ** decimals` scale factor as a `bigint`.
 * Results are memo-ised to avoid repeated exponentiation.
 */
const _scaleCache = new Map<number, bigint>();

function getScale(decimals: number): bigint {
  let scale = _scaleCache.get(decimals);
  if (scale === undefined) {
    scale = BigInt(10) ** BigInt(decimals);
    _scaleCache.set(decimals, scale);
  }
  return scale;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a raw integer amount (in the asset's smallest unit, e.g. stroops)
 * to a human-readable string using the asset's decimal precision.
 *
 * Respects `AssetMetadata.displayFormat`:
 * - `"decimal"` — formats with the correct number of decimal places.
 * - `"integer"` — renders the raw integer value with no decimal separator.
 *
 * @param rawAmount  - Raw amount as a `bigint` (smallest unit, always positive).
 * @param metadata   - Asset metadata returned by `AssetRegistry.get`.
 * @param options    - Optional locale and symbol configuration.
 * @returns Formatted string, e.g. `"1,000.50 USDC"` or `"10000000 stroops"`.
 *
 * @example
 * ```ts
 * const xlm = AssetRegistry.getOrThrow("native");
 * formatAmount(10_000_000n, xlm); // "1.0000000 XLM"
 *
 * const usdc = AssetRegistry.getOrThrow("USDC");
 * formatAmount(1_500_000n, usdc); // "0.1500000 USDC"
 * ```
 */
export function formatAmount(
  rawAmount: bigint,
  metadata: AssetMetadata,
  options: FormatAmountOptions = {}
): string {
  const { locale = "en-US", includeSymbol = true } = options;
  const { decimals, symbol, displayFormat = "decimal" } = metadata;

  let formatted: string;

  if (displayFormat === "integer" || decimals === 0) {
    // Render as plain integer — no decimal separator.
    formatted = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
      useGrouping: true,
    }).format(rawAmount);
  } else {
    // Keep the value in bigint/string space end-to-end (#834). Converting to
    // `number` first loses precision for large balances and high-decimal token
    // amounts, which can silently change the displayed payroll figure.
    const scale = getScale(decimals);
    const negative = rawAmount < 0n;
    const absolute = negative ? -rawAmount : rawAmount;
    const whole = absolute / scale;
    const frac = absolute % scale;

    // Build a decimal string with the exact number of decimal places.
    const fracStr = frac.toString().padStart(decimals, "0");
    // `Intl.NumberFormat` formats bigint exactly (no float conversion), so
    // grouping is applied to the true integer part.
    const groupedWhole = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
      useGrouping: true,
    }).format(whole);

    formatted = `${negative ? "-" : ""}${groupedWhole}.${fracStr}`;
  }

  return includeSymbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Parse a human-readable amount string back to a raw `bigint` in the asset's
 * smallest unit (e.g. stroops for XLM).
 *
 * Strips common formatting characters (commas, spaces, the asset symbol, and a
 * leading currency sign) before parsing.
 *
 * @param input    - Formatted amount string, e.g. `"1,000.50"` or `"1000.50 USDC"`.
 * @param metadata - Asset metadata returned by `AssetRegistry.get`.
 * @param options  - Parsing options.
 * @returns Parsed raw amount as `bigint`.
 *
 * @throws {Error} when the string cannot be parsed (unless `strict: false`).
 *
 * @example
 * ```ts
 * const usdc = AssetRegistry.getOrThrow("USDC");
 * parseAmount("1,000.50 USDC", usdc); // 7_003_500_000n
 * parseAmount("0.0000001", xlm);      // 1n
 * ```
 */
export function parseAmount(
  input: string,
  metadata: AssetMetadata,
  options: ParseAmountOptions = {}
): bigint {
  const { strict = false } = options;
  const { decimals, symbol } = metadata;

  // Strip symbol (case-insensitive), commas, whitespace, and leading currency signs.
  const cleaned = input
    .replace(new RegExp(symbol, "i"), "")
    .replace(/[$€£¥]/g, "")
    .replace(/,/g, "")
    .trim();

  // Validate the shape in string space. `Number()` would coerce a large amount
  // through a float and can accept values that `BigInt()` later rejects.
  if (cleaned === "" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) {
    if (strict === false) {
      throw new Error(
        `parseAmount: cannot parse "${input}" as a numeric amount for asset ${symbol}.`
      );
    }
    return 0n;
  }

  const scale = getScale(decimals);

  // Split on decimal point.
  const dotIndex = cleaned.indexOf(".");
  if (dotIndex === -1) {
    // No decimal part.
    return BigInt(cleaned) * scale;
  }

  const wholePart = cleaned.slice(0, dotIndex) || "0";
  let fracPart = cleaned.slice(dotIndex + 1);

  // Truncate or pad fractional part to `decimals` digits.
  if (fracPart.length > decimals) {
    fracPart = fracPart.slice(0, decimals);
  } else {
    fracPart = fracPart.padEnd(decimals, "0");
  }

  return BigInt(wholePart) * scale + BigInt(fracPart);
}
