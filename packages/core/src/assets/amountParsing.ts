/**
 * Payroll Amount Parsing Utilities
 *
 * Robust parsing of payroll amounts with asset-aware decimal handling,
 * configurable bounds checks, deterministic rounding rules, and
 * structured validation errors.
 *
 * ## Why this module exists
 *
 * Incorrect amount parsing can cause:
 * - **Underpayment** — truncating fractional digits without rounding
 * - **Overpayment** — accidentally parsing amounts in the wrong base unit
 * - **Failed contract calls** — out-of-bounds amounts rejected on-chain
 *
 * This module solves those problems by providing:
 * - **Structured error types** — each failure mode maps to a typed error
 *   (bounds exceeded, invalid format, negative values, unsupported decimals)
 * - **Deterministic rounding** — explicit `RoundingMode` enum with
 *   half-up, truncation, and ceiling strategies
 * - **Configurable bounds** — min/max checks with custom error context
 * - **Asset-decimals awareness** — automatically scales using `AssetMetadata`
 *
 * ## Usage
 *
 * ```ts
 * import {
 *   parsePayrollAmount,
 *   Bounds,
 *   RoundingMode,
 *   AmountParseError,
 *   AmountParseErrorCode,
 * } from "@zk-payroll/core";
 * import { AssetRegistry } from "@zk-payroll/core";
 *
 * // Basic parsing with asset metadata
 * const xlm = AssetRegistry.getOrThrow("native");
 * const result = parsePayrollAmount("100.50", xlm);
 * // => { amount: 1_005_000_000n, decimals: 7 }
 *
 * // With bounds checking
 * const result2 = parsePayrollAmount("50000", xlm, {
 *   bounds: { min: 1n, max: 10_000_000_000n }, // 1 stroop to 1000 XLM
 *   rounding: RoundingMode.HALF_UP,
 * });
 *
 * // Handling errors
 * try {
 *   parsePayrollAmount("-50", xlm);
 * } catch (err) {
 *   if (err instanceof AmountParseError) {
 *     console.error(err.code, err.message, err.context);
 *   }
 * }
 * ```
 */

import { AssetMetadata } from "./types";

// ── Error Types ──────────────────────────────────────────────────────────────

/**
 * Machine-readable error codes for amount parsing failures.
 */
export enum AmountParseErrorCode {
  /** Input string is empty or contains only whitespace. */
  EMPTY_INPUT = "EMPTY_INPUT",
  /** Input contains non-numeric characters after sanitisation. */
  INVALID_FORMAT = "INVALID_FORMAT",
  /** Input represents a negative amount (not allowed). */
  NEGATIVE_VALUE = "NEGATIVE_VALUE",
  /** Input is zero (not allowed in payroll contexts). */
  ZERO_VALUE = "ZERO_VALUE",
  /** Parsed amount is below the configured minimum bound. */
  BELOW_MINIMUM = "BELOW_MINIMUM",
  /** Parsed amount exceeds the configured maximum bound. */
  EXCEEDS_MAXIMUM = "EXCEEDS_MAXIMUM",
  /** Input has more decimal places than the asset supports. */
  EXCESS_PRECISION = "EXCESS_PRECISION",
  /** Parsed amount exceeds safe integer range for the asset's decimals. */
  OVERFLOW = "OVERFLOW",
}

/**
 * Structured error thrown when amount parsing fails.
 *
 * Carries a machine-readable `code`, a human-readable `message`, and
 * optional `context` with details such as the raw input, asset symbol,
 * parsed numeric value, and bounds configuration.
 *
 * @example
 * ```ts
 * try {
 *   parsePayrollAmount("-5", xlm);
 * } catch (err) {
 *   if (err instanceof AmountParseError) {
 *     // err.code === AmountParseErrorCode.NEGATIVE_VALUE
 *     // err.context.input === "-5"
 *   }
 * }
 * ```
 */
export class AmountParseError extends Error {
  constructor(
    message: string,
    public readonly code: AmountParseErrorCode,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AmountParseError";
  }
}

// ── Rounding Modes ──────────────────────────────────────────────────────────

/**
 * Deterministic rounding strategies for when the input has more decimal
 * places than the asset supports.
 */
export enum RoundingMode {
  /**
   * Round half away from zero (standard rounding).
   * 1.5 → 2, 2.5 → 3, -1.5 → -2
   */
  HALF_UP = "HALF_UP",
  /**
   * Truncate (round toward zero). Drops excess digits.
   * 1.9 → 1, 2.1 → 2
   */
  TRUNCATE = "TRUNCATE",
  /**
   * Round up (ceil for positive, floor for negative).
   * 1.1 → 2, 2.9 → 3
   */
  CEIL = "CEIL",
  /**
   * Round down (floor for positive, ceil for negative).
   * 1.9 → 1, 2.1 → 2
   */
  FLOOR = "FLOOR",
}

// ── Bounds Configuration ────────────────────────────────────────────────────

/**
 * Upper and lower bounds for amount validation, expressed in the asset's
 * smallest unit (e.g. stroops for XLM).
 *
 * Both `min` and `max` are optional. When omitted, the corresponding check
 * is skipped.
 */
export interface AmountBounds {
  /** Minimum allowed value in smallest units (inclusive). */
  min?: bigint;
  /** Maximum allowed value in smallest units (inclusive). */
  max?: bigint;
}

// ── Parsing Options ─────────────────────────────────────────────────────────

/**
 * Configuration for `parsePayrollAmount`.
 */
export interface ParsePayrollAmountOptions {
  /**
   * Bounds to enforce on the parsed amount (in smallest units).
   * Omit to skip bounds checking.
   */
  bounds?: AmountBounds;
  /**
   * Rounding strategy when the input exceeds the asset's decimal
   * precision. Defaults to `RoundingMode.HALF_UP`.
   */
  rounding?: RoundingMode;
  /**
   * Asset metadata to use for decimal scaling. Required if not
   * passed as the second positional argument.
   */
  metadata?: AssetMetadata;
}

// ── Parse Result ────────────────────────────────────────────────────────────

/**
 * Successful result of `parsePayrollAmount`.
 */
export interface ParsedPayrollAmount {
  /** The parsed amount in the asset's smallest unit (e.g. stroops). */
  amount: bigint;
  /** The asset's decimal count (for reference/display). */
  decimals: number;
  /**
   * Whether the parsed value was rounded due to excess precision
   * in the input.
   */
  wasRounded: boolean;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Scale factor cache: 10^n as a bigint.
 */
const scaleCache = new Map<number, bigint>();

function getScale(decimals: number): bigint {
  let scale = scaleCache.get(decimals);
  if (scale === undefined) {
    scale = BigInt(10) ** BigInt(decimals);
    scaleCache.set(decimals, scale);
  }
  return scale;
}

/**
 * Sanitize an input string by stripping common formatting characters.
 *
 * Removed:
 * - Commas (thousands separators)
 * - Leading/trailing whitespace
 * - Currency symbols ($, €, £, ¥)
 * - Asset symbol suffix (case-insensitive)
 *
 * @param input   - Raw input string.
 * @param symbol  - Asset symbol to strip (e.g. "XLM", "USDC").
 * @returns       The cleaned numeric string, or empty if nothing remains.
 */
function sanitizeInput(input: string, symbol: string): string {
  return input
    .replace(new RegExp(symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
    .replace(/[$€£¥,]/g, "")
    .trim();
}

/**
 * Apply the selected rounding mode to a fractional part that exceeds
 * the asset's decimal precision.
 *
 * @param excessDigit  - The first digit beyond the asset's precision.
 * @param currentFrac  - The fractional part truncated to `decimals` digits.
 * @param decimals     - Asset decimal count.
 * @param mode         - Rounding mode.
 * @returns            The adjusted fractional part as a bigint.
 */
function applyRounding(
  excessDigit: number,
  currentFrac: string,
  decimals: number,
  mode: RoundingMode
): bigint {
  const fracBigInt = BigInt(currentFrac.padEnd(decimals, "0"));

  switch (mode) {
    case RoundingMode.TRUNCATE:
      // Already truncated — no adjustment needed.
      return fracBigInt;

    case RoundingMode.HALF_UP:
      if (excessDigit >= 5) {
        return fracBigInt + 1n;
      }
      return fracBigInt;

    case RoundingMode.CEIL:
      // For positive payroll amounts, CEIL always rounds up when
      // there is an excess digit.
      if (excessDigit > 0) {
        return fracBigInt + 1n;
      }
      return fracBigInt;

    case RoundingMode.FLOOR:
      // For positive payroll amounts, FLOOR always truncates.
      return fracBigInt;

    default:
      return fracBigInt;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a human-readable payroll amount string into the asset's smallest
 * unit (e.g. stroops for XLM) with full validation.
 *
 * Validation performed:
 * 1. **Empty / whitespace-only input** → `EMPTY_INPUT`
 * 2. **Non-numeric content** → `INVALID_FORMAT`
 * 3. **Negative values** → `NEGATIVE_VALUE`
 * 4. **Zero values** → `ZERO_VALUE`
 * 5. **Excess precision beyond asset decimals** → rounded per `RoundingMode`
 * 6. **Bounds check (min/max)** → `BELOW_MINIMUM` / `EXCEEDS_MAXIMUM`
 * 7. **Overflow beyond safe range** → `OVERFLOW`
 *
 * @param input    - Human-readable amount, e.g. `"100.50"` or `"1,000 XLM"`.
 * @param metadata - Asset metadata with decimal precision and symbol.
 * @param options  - Optional bounds, rounding mode, and metadata override.
 * @returns        A `ParsedPayrollAmount` result.
 * @throws AmountParseError on any validation failure.
 *
 * @example
 * ```ts
 * const xlm = AssetRegistry.getOrThrow("native");
 *
 * // Basic usage
 * const { amount } = parsePayrollAmount("100.50", xlm);
 * // => 1_005_000_000n (100.50 XLM in stroops)
 *
 * // With bounds checking
 * parsePayrollAmount("999999", xlm, {
 *   bounds: { min: 1n, max: 10_000_000_000n },
 * });
 *
 * // Custom rounding
 * parsePayrollAmount("100.50123456789", xlm, {
 *   rounding: RoundingMode.TRUNCATE,
 * });
 * ```
 */
export function parsePayrollAmount(
  input: string,
  metadata: AssetMetadata,
  options: ParsePayrollAmountOptions = {}
): ParsedPayrollAmount {
  const { decimals, symbol } = metadata;
  const rounding = options.rounding ?? RoundingMode.HALF_UP;
  const bounds = options.bounds;

  // ── Step 1: Sanitize ────────────────────────────────────────────────────
  const cleaned = sanitizeInput(input, symbol);

  if (cleaned.length === 0) {
    throw new AmountParseError(
      `Amount input is empty after sanitization: "${input}"`,
      AmountParseErrorCode.EMPTY_INPUT,
      { input, assetSymbol: symbol }
    );
  }

  // ── Step 2: Validate numeric format ─────────────────────────────────────
  // Allow: "123", "123.456", ".5", "0.1"
  // Disallow: "abc", "12.34.56"
  const numericPattern = /^-?(\d*\.?\d+|\d+\.?\d*)$/;
  if (!numericPattern.test(cleaned)) {
    throw new AmountParseError(
      `Amount input contains non-numeric characters: "${input}"`,
      AmountParseErrorCode.INVALID_FORMAT,
      { input, cleaned, assetSymbol: symbol }
    );
  }

  // ── Step 3: Check for negative values ───────────────────────────────────
  if (cleaned.startsWith("-")) {
    throw new AmountParseError(
      `Amount cannot be negative: "${input}"`,
      AmountParseErrorCode.NEGATIVE_VALUE,
      { input, assetSymbol: symbol }
    );
  }

  // ── Step 4: Split into whole and fractional parts ───────────────────────
  const dotIndex = cleaned.indexOf(".");
  let wholePart: string;
  let fracPart: string;

  if (dotIndex === -1) {
    wholePart = cleaned;
    fracPart = "";
  } else {
    wholePart = cleaned.slice(0, dotIndex) || "0";
    fracPart = cleaned.slice(dotIndex + 1);
  }

  // ── Step 5: Check for zero value ────────────────────────────────────────
  const isEffectivelyZero =
    (wholePart === "0" || wholePart === "") && (fracPart.length === 0 || /^0+$/.test(fracPart));

  if (isEffectivelyZero) {
    throw new AmountParseError(
      `Amount cannot be zero: "${input}"`,
      AmountParseErrorCode.ZERO_VALUE,
      { input, assetSymbol: symbol }
    );
  }

  // ── Step 6: Handle excess precision (rounding) ──────────────────────────
  let wasRounded = false;

  if (fracPart.length > decimals) {
    wasRounded = true;
    const excessDigit = parseInt(fracPart[decimals], 10);
    fracPart = fracPart.slice(0, decimals);

    const adjustedFrac = applyRounding(excessDigit, fracPart, decimals, rounding);

    // If rounding caused the fractional part to overflow (e.g. ".999" → 1000),
    // carry the overflow to the whole part.
    const scale = getScale(decimals);
    if (adjustedFrac >= scale) {
      wholePart = (BigInt(wholePart || "0") + 1n).toString();
      fracPart = adjustedFrac.toString().padStart(decimals, "0").slice(-decimals);
    } else {
      fracPart = adjustedFrac.toString().padStart(decimals, "0");
    }
  } else {
    fracPart = fracPart.padEnd(decimals, "0");
  }

  // ── Step 7: Compute final amount ────────────────────────────────────────
  const scale = getScale(decimals);
  const wholeBigInt = BigInt(wholePart);
  const fracBigInt = BigInt(fracPart);

  // Check for overflow before computing the final value.
  if (wholeBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AmountParseError(
      `Amount exceeds safe integer range for asset ${symbol}: "${input}"`,
      AmountParseErrorCode.OVERFLOW,
      { input, assetSymbol: symbol, wholePart }
    );
  }

  const finalAmount = wholeBigInt * scale + fracBigInt;

  // ── Step 8: Bounds check ────────────────────────────────────────────────
  if (bounds) {
    if (bounds.min !== undefined && finalAmount < bounds.min) {
      throw new AmountParseError(
        `Amount ${formatDebugAmount(finalAmount, decimals, symbol)} is below the minimum of ${formatDebugAmount(bounds.min, decimals, symbol)}`,
        AmountParseErrorCode.BELOW_MINIMUM,
        {
          input,
          assetSymbol: symbol,
          parsedAmount: finalAmount.toString(),
          min: bounds.min.toString(),
          max: bounds.max?.toString(),
        }
      );
    }

    if (bounds.max !== undefined && finalAmount > bounds.max) {
      throw new AmountParseError(
        `Amount ${formatDebugAmount(finalAmount, decimals, symbol)} exceeds the maximum of ${formatDebugAmount(bounds.max, decimals, symbol)}`,
        AmountParseErrorCode.EXCEEDS_MAXIMUM,
        {
          input,
          assetSymbol: symbol,
          parsedAmount: finalAmount.toString(),
          min: bounds.min?.toString(),
          max: bounds.max.toString(),
        }
      );
    }
  }

  return {
    amount: finalAmount,
    decimals,
    wasRounded,
  };
}

/**
 * Format a raw amount in smallest units to a human-readable string
 * for debug/error messages.
 *
 * @param rawAmount - Amount in smallest units (e.g. stroops).
 * @param decimals  - Asset decimal count.
 * @param symbol    - Asset ticker symbol.
 * @returns         Formatted string like "100.50 XLM".
 */
function formatDebugAmount(rawAmount: bigint, decimals: number, symbol: string): string {
  const scale = getScale(decimals);
  const whole = rawAmount / scale;
  const frac = rawAmount % scale;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fracStr.length === 0) {
    return `${whole} ${symbol}`;
  }
  return `${whole}.${fracStr} ${symbol}`;
}

/**
 * Check whether a raw amount (in smallest units) falls within the
 * specified bounds without throwing.
 *
 * Useful for pre-flight checks or batch validation where you want to
 * collect all errors before deciding how to proceed.
 *
 * @param amount  - Amount in smallest units (e.g. stroops).
 * @param bounds  - Bounds configuration.
 * @returns       An array of `AmountParseError` objects, or an empty array
 *                if the amount is within bounds.
 *
 * @example
 * ```ts
 * const errors = checkAmountBounds(5_000_000_000n, { min: 1n, max: 10_000_000_000n });
 * if (errors.length > 0) {
 *   // handle errors
 * }
 * ```
 */
export function checkAmountBounds(amount: bigint, bounds: AmountBounds): AmountParseError[] {
  const errors: AmountParseError[] = [];

  if (bounds.min !== undefined && amount < bounds.min) {
    errors.push(
      new AmountParseError(
        `Amount ${amount} is below minimum ${bounds.min}`,
        AmountParseErrorCode.BELOW_MINIMUM,
        { amount: amount.toString(), min: bounds.min.toString() }
      )
    );
  }

  if (bounds.max !== undefined && amount > bounds.max) {
    errors.push(
      new AmountParseError(
        `Amount ${amount} exceeds maximum ${bounds.max}`,
        AmountParseErrorCode.EXCEEDS_MAXIMUM,
        { amount: amount.toString(), max: bounds.max.toString() }
      )
    );
  }

  return errors;
}

/**
 * Create a payroll-appropriate `AmountBounds` object from a human-readable
 * string representation of the minimum and maximum values.
 *
 * This is useful when bounds are configured via environment variables or
 * config files rather than hard-coded bigint literals.
 *
 * @param minStr        - Human-readable minimum, e.g. `"0.01"` or `"0.01 XLM"`.
 * @param maxStr        - Human-readable maximum, e.g. `"10000"` or `"10000 XLM"`.
 * @param metadata      - Asset metadata for decimal scaling.
 * @param rounding      - Optional rounding mode (defaults to HALF_UP).
 * @returns             An `AmountBounds` object with parsed bigint values.
 *
 * @example
 * ```ts
 * const bounds = makeBoundsFromStrings("1.00", "1000.00", xlm);
 * // => { min: 10_000_000n, max: 10_000_000_000n }
 * ```
 */
export function makeBoundsFromStrings(
  minStr: string,
  maxStr: string,
  metadata: AssetMetadata,
  rounding?: RoundingMode
): AmountBounds {
  const minResult = parsePayrollAmount(minStr, metadata, { rounding });
  const maxResult = parsePayrollAmount(maxStr, metadata, { rounding });

  return {
    min: minResult.amount,
    max: maxResult.amount,
  };
}
