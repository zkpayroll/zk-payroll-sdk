/**
 * Multi-Asset Amount Rounding Utilities
 *
 * Provides deterministic rounding of payroll amounts across assets with
 * different decimal precisions. All operations use integer arithmetic
 * (bigint) to avoid floating-point inaccuracies.
 *
 * ## Why this module exists
 *
 * Payroll operations often involve assets with varying decimal counts:
 * - XLM (native): 7 decimals
 * - USDC (Stellar): 7 decimals
 * - EVM-bridged tokens: 6 or 18 decimals
 *
 * When converting between assets, computing proportional allocations,
 * or formatting for display, amounts must be correctly rounded to the
 * target asset's precision without introducing floating-point errors.
 *
 * ## Design Principles
 * - **Integer-only arithmetic**: All calculations use bigint
 * - **Explicit precision**: Target decimals are always explicit, never inferred
 * - **Deterministic rounding**: Configurable RoundingMode (HALF_UP, TRUNCATE, CEIL, FLOOR)
 * - **Asset-aware**: Works with AssetMetadata or raw decimals
 */

import { AssetMetadata } from "./types";
import { getDecimalScaleFactor, assertValidDecimals, DEFAULT_ASSET_DECIMALS } from "./decimals";
// `RoundingMode` is defined once in `amountParsing.ts` and re-exported here
// (rather than redeclared) so the SDK has a single canonical enum —
// `amountParsing`/`compat-exports` already treat it as canonical. The
// package barrel (`assets/index.ts`) re-exports this module's other members
// explicitly to avoid re-exporting `RoundingMode` from two places.
import { RoundingMode } from "./amountParsing";

export { RoundingMode };

/**
 * Validates that a value is a recognized `RoundingMode`.
 *
 * Guards against callers passing arbitrary strings (e.g. from JSON config
 * or user input) that would otherwise silently fall through to truncation.
 *
 * @param mode - Value to validate.
 * @throws {Error} If the value is not a recognized rounding mode.
 */
function assertValidRoundingMode(mode: RoundingMode): void {
  const validModes: readonly RoundingMode[] = [
    RoundingMode.HALF_UP,
    RoundingMode.TRUNCATE,
    RoundingMode.CEIL,
    RoundingMode.FLOOR,
  ];
  if (!validModes.includes(mode)) {
    throw new Error(
      `Invalid rounding mode: ${String(mode)}. Expected one of: ${validModes.join(", ")}`
    );
  }
}

/**
 * Options for rounding an amount to a target precision.
 */
export interface RoundAmountOptions {
  /**
   * Rounding strategy. Defaults to HALF_UP.
   */
  rounding?: RoundingMode;
  /**
   * Target decimal precision. If omitted, uses the asset's decimals.
   * When provided, the amount is scaled from its current precision to this precision.
   */
  targetDecimals?: number;
  /**
   * Source decimal precision of the input amount. If omitted, assumes
   * the amount is already in the asset's native precision (or uses
   * asset.decimals when asset is provided).
   */
  sourceDecimals?: number;
}

/**
 * Result of a rounding operation.
 */
export interface RoundedAmount {
  /** The rounded amount in the target precision's base units. */
  amount: bigint;
  /** The target decimal precision used. */
  targetDecimals: number;
  /** Whether rounding changed the value. */
  wasRounded: boolean;
  /** The original amount before rounding. */
  originalAmount: bigint;
  /** The source decimal precision used. */
  sourceDecimals: number;
}

/**
 * Rounds a bigint amount from one decimal precision to another.
 *
 * This is the core low-level function. It takes an amount expressed in
 * base units of `sourceDecimals` precision and returns the equivalent
 * amount in base units of `targetDecimals` precision, applying the
 * specified rounding mode.
 *
 * @example
 * ```ts
 * // Scale 1.500 XLM (7 decimals = 15_000_000 stroops) to 2 decimals (150 cents)
 * roundAmount(15_000_000n, 7, 2); // => 150n (1.50)
 *
 * // Scale 1.999 USDC (6 decimals = 1_999_000) to 2 decimals with HALF_UP
 * roundAmount(1_999_000n, 6, 2, { rounding: RoundingMode.HALF_UP }); // => 2000n (20.00)
 * ```
 *
 * @param amount         - Amount in source precision base units (e.g., stroops).
 * @param sourceDecimals - Decimal precision of the input amount.
 * @param targetDecimals - Desired decimal precision of the output.
 * @param options        - Rounding mode and options.
 * @returns Rounded amount with metadata.
 * @throws {Error} If `sourceDecimals` or `targetDecimals` is invalid, or if
 *   `options.rounding` is not a recognized `RoundingMode`.
 */
export function roundAmount(
  amount: bigint,
  sourceDecimals: number,
  targetDecimals: number,
  options: RoundAmountOptions = {}
): RoundedAmount {
  assertValidDecimals(sourceDecimals);
  assertValidDecimals(targetDecimals);

  const rounding = options.rounding ?? RoundingMode.HALF_UP;
  assertValidRoundingMode(rounding);

  // If precisions are the same, no scaling needed
  if (sourceDecimals === targetDecimals) {
    return {
      amount,
      targetDecimals,
      wasRounded: false,
      originalAmount: amount,
      sourceDecimals,
    };
  }

  const sourceScale = getDecimalScaleFactor(sourceDecimals);
  const targetScale = getDecimalScaleFactor(targetDecimals);

  let result: bigint;
  let wasRounded = false;

  if (targetDecimals > sourceDecimals) {
    // Increasing precision: multiply (add trailing zeros)
    const multiplier = getDecimalScaleFactor(targetDecimals - sourceDecimals);
    result = amount * multiplier;
  } else {
    // Decreasing precision: divide with rounding
    const divisor = getDecimalScaleFactor(sourceDecimals - targetDecimals);
    const quotient = amount / divisor;
    const remainder = amount % divisor;

    switch (rounding) {
      case RoundingMode.TRUNCATE:
        // For positive amounts, truncation is just integer division
        result = quotient;
        wasRounded = remainder !== 0n;
        break;

      case RoundingMode.HALF_UP:
        // Round half up: if remainder >= divisor/2, increment
        const halfDivisor = divisor / 2n;
        result = quotient + (remainder >= halfDivisor ? 1n : 0n);
        wasRounded = remainder !== 0n;
        break;

      case RoundingMode.CEIL:
        // Ceiling: if any remainder, increment
        result = quotient + (remainder > 0n ? 1n : 0n);
        wasRounded = remainder !== 0n;
        break;

      case RoundingMode.FLOOR:
        // Floor: just integer division for positive amounts
        result = quotient;
        wasRounded = remainder !== 0n;
        break;

      default:
        // Unreachable: assertValidRoundingMode above rejects unknown modes.
        throw new Error(`Unsupported rounding mode: ${String(rounding)}`);
    }
  }

  return {
    amount: result,
    targetDecimals,
    wasRounded,
    originalAmount: amount,
    sourceDecimals,
  };
}

/**
 * Rounds an amount to the asset's native precision.
 *
 * Convenience wrapper that uses the asset's decimals as both source
 * and target (no-op unless the amount has excess precision from a
 * higher-precision source).
 *
 * @param amount - Amount in base units (assumed to be in asset's precision).
 * @param asset  - Asset metadata.
 * @param options - Rounding options.
 * @returns The amount unchanged (bigint amounts are already canonical).
 */
export function roundToAssetPrecision(
  amount: bigint,
  asset: AssetMetadata,
  options: RoundAmountOptions = {}
): RoundedAmount {
  return roundAmount(amount, asset.decimals, asset.decimals, options);
}

/**
 * Converts an amount from one asset's precision to another asset's precision.
 *
 * This handles the common case of converting between two different assets
 * (e.g., XLM to USDC) where the decimal precisions may differ.
 *
 * @param amount       - Amount in source asset's base units.
 * @param sourceAsset  - Source asset metadata.
 * @param targetAsset  - Target asset metadata.
 * @param options      - Rounding options.
 * @returns Amount in target asset's base units.
 */
export function convertAmountPrecision(
  amount: bigint,
  sourceAsset: AssetMetadata,
  targetAsset: AssetMetadata,
  options: RoundAmountOptions = {}
): RoundedAmount {
  return roundAmount(amount, sourceAsset.decimals, targetAsset.decimals, options);
}

/**
 * Rounds a parsed payroll amount (from string) to a target asset's precision.
 *
 * Useful when you have a human-readable amount for one asset but need to
 * express it in another asset's precision (e.g., user enters "100.50 XLM"
 * but payment is in USDC).
 *
 * @param amountStr    - Human-readable amount string (e.g., "100.50").
 * @param sourceAsset  - Asset the input amount is denominated in.
 * @param targetAsset  - Asset to convert to.
 * @param options      - Rounding options.
 * @returns Rounded amount in target asset's base units.
 */
export function roundParsedAmount(
  amountStr: string,
  sourceAsset: AssetMetadata,
  targetAsset: AssetMetadata,
  options: RoundAmountOptions = {}
): RoundedAmount {
  // Parse the string amount in source asset's precision
  const { parsePayrollAmount } = require("./amountParsing");
  const parsed = parsePayrollAmount(amountStr, sourceAsset, {
    rounding: options.rounding,
  });

  // Convert to target asset's precision
  return convertAmountPrecision(parsed.amount, sourceAsset, targetAsset, options);
}

/**
 * Rounds an amount down to the nearest multiple of a given increment.
 *
 * Useful for enforcing minimum step sizes (e.g., "round to nearest 0.01").
 *
 * @param amount       - Amount in base units.
 * @param increment    - Increment to round to (in same base units).
 * @param asset        - Asset metadata (for validation).
 * @returns Rounded amount.
 */
export function roundToIncrement(
  amount: bigint,
  increment: bigint,
  asset: AssetMetadata
): RoundedAmount {
  if (increment <= 0n) {
    throw new Error(`Increment must be positive, received ${increment.toString()}`);
  }

  const remainder = amount % increment;
  const rounded = amount - remainder;

  return {
    amount: rounded,
    targetDecimals: asset.decimals,
    wasRounded: remainder !== 0n,
    originalAmount: amount,
    sourceDecimals: asset.decimals,
  };
}

/**
 * Checks if an amount can be represented exactly in a target precision
 * without rounding loss.
 *
 * @param amount       - Amount in source precision base units.
 * @param sourceDecimals - Source decimal precision.
 * @param targetDecimals - Target decimal precision.
 * @returns True if exact representation is possible.
 */
export function canRepresentExactly(
  amount: bigint,
  sourceDecimals: number,
  targetDecimals: number
): boolean {
  assertValidDecimals(sourceDecimals);
  assertValidDecimals(targetDecimals);

  if (targetDecimals >= sourceDecimals) {
    return true; // Increasing precision never loses information
  }

  const divisor = getDecimalScaleFactor(sourceDecimals - targetDecimals);
  return amount % divisor === 0n;
}

/**
 * Gets the minimum non-zero amount representable at a given precision.
 *
 * @param decimals - Decimal precision.
 * @returns Minimum amount (1 base unit).
 */
export function getMinimumRepresentableAmount(decimals: number): bigint {
  assertValidDecimals(decimals);
  return 1n;
}

/**
 * Formats a rounded amount for display with the asset symbol.
 *
 * @param rounded  - RoundedAmount result.
 * @param asset    - Asset metadata for symbol and decimals.
 * @returns Human-readable string (e.g., "100.50 XLM").
 */
export function formatRoundedAmount(rounded: RoundedAmount, asset: AssetMetadata): string {
  const scale = getDecimalScaleFactor(rounded.targetDecimals);
  const whole = rounded.amount / scale;
  const frac = rounded.amount % scale;

  if (frac === 0n) {
    return `${whole} ${asset.symbol}`;
  }

  const fracStr = frac.toString().padStart(rounded.targetDecimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr} ${asset.symbol}`;
}

/**
 * Non-throwing variant of roundAmount that returns a result object.
 */
export function tryRoundAmount(
  amount: bigint,
  sourceDecimals: number,
  targetDecimals: number,
  options: RoundAmountOptions = {}
): { ok: true; value: RoundedAmount } | { ok: false; error: Error } {
  try {
    const value = roundAmount(amount, sourceDecimals, targetDecimals, options);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
