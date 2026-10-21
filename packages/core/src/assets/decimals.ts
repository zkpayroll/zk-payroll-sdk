/*
 * Asset Decimals and Smallest Unit Resolution Utilities
 *
 * Provides utilities for handling token decimals, computing scale factors,
 * and resolving the minimum supported non-zero amount for assets.
 *
 * ## Design Goals
 * - Enforce valid decimal ranges (0 to 18) to avoid arithmetic overflow.
 * - Compute scale factors (10^decimals) with memoized cache for efficiency.
 * - Resolve minimum base units (e.g. 1 stroop = 1n for 7 decimals) and minimum
 *   fractional decimal strings (e.g. "0.0000001" for 7 decimals).
 * - Support asset metadata lookups and clear formatting.
 */

import { AssetMetadata } from "./types";

/** Default decimal places for Stellar/Soroban native and standard assets */
export const DEFAULT_ASSET_DECIMALS = 7;

/** Minimum allowed decimals for any supported asset */
export const MIN_SUPPORTED_DECIMALS = 0;

/** Maximum allowed decimals for any supported asset (standard ERC20/Soroban limit) */
export const MAX_SUPPORTED_DECIMALS = 18;

// Memoization cache for 10 ** decimals scale factors
const _scaleFactorCache = new Map<number, bigint>();

/**
 * Check if a decimal value is an integer within the supported range [0, 18].
 *
 * @param decimals - The decimals value to validate.
 * @returns True if valid, false otherwise.
 */
export function isValidDecimals(decimals: unknown): decimals is number {
  return (
    typeof decimals === "number" &&
    Number.isInteger(decimals) &&
    decimals >= MIN_SUPPORTED_DECIMALS &&
    decimals <= MAX_SUPPORTED_DECIMALS
  );
}

/**
 * Assert that a decimal value is an integer within [0, 18].
 *
 * @param decimals - The decimals value to validate.
 * @throws RangeError or TypeError if invalid.
 */
export function assertValidDecimals(decimals: number): void {
  if (typeof decimals !== "number" || !Number.isInteger(decimals)) {
    throw new TypeError(`Decimals must be an integer, received: ${decimals}`);
  }
  if (decimals < MIN_SUPPORTED_DECIMALS || decimals > MAX_SUPPORTED_DECIMALS) {
    throw new RangeError(
      `Decimals must be between ${MIN_SUPPORTED_DECIMALS} and ${MAX_SUPPORTED_DECIMALS}, received: ${decimals}`
    );
  }
}

/**
 * Compute the scale factor (10 ** decimals) as a bigint.
 * Results are cached for performance.
 *
 * @param decimals - Asset decimals (0 to 18). Defaults to 7.
 * @returns Scale factor as a bigint.
 */
export function getDecimalScaleFactor(decimals: number = DEFAULT_ASSET_DECIMALS): bigint {
  assertValidDecimals(decimals);
  let scale = _scaleFactorCache.get(decimals);
  if (scale === undefined) {
    scale = 10n ** BigInt(decimals);
    _scaleFactorCache.set(decimals, scale);
  }
  return scale;
}

/**
 * Return the minimum indivisible base unit (smallest non-zero integer representation)
 * for an asset. In blockchain integer representation, this is always 1n (e.g. 1 stroop).
 *
 * @returns 1n as the smallest discrete unit.
 */
export function getMinimumBaseUnit(): bigint {
  return 1n;
}

/**
 * Get the minimum non-zero fractional amount as a fixed-point decimal string.
 *
 * @example
 * ```ts
 * getMinimumFractionalString(7); // "0.0000001"
 * getMinimumFractionalString(2); // "0.01"
 * getMinimumFractionalString(0); // "1"
 * ```
 *
 * @param decimals - Asset decimal count (0 to 18).
 * @returns String representation of the minimum unit (e.g. "0.0000001").
 */
export function getMinimumFractionalString(decimals: number = DEFAULT_ASSET_DECIMALS): string {
  assertValidDecimals(decimals);
  if (decimals === 0) {
    return "1";
  }
  return `0.${"0".repeat(decimals - 1)}1`;
}

/**
 * Resolve the decimal count from asset metadata, a numeric decimal, or fallback default.
 *
 * @param assetOrDecimals - AssetMetadata, decimal number, or undefined.
 * @returns Validated decimal count (defaults to 7).
 */
export function resolveAssetDecimals(assetOrDecimals?: AssetMetadata | number): number {
  if (assetOrDecimals === undefined) {
    return DEFAULT_ASSET_DECIMALS;
  }
  if (typeof assetOrDecimals === "number") {
    assertValidDecimals(assetOrDecimals);
    return assetOrDecimals;
  }
  if (typeof assetOrDecimals === "object" && assetOrDecimals !== null) {
    const dec = assetOrDecimals.decimals;
    assertValidDecimals(dec);
    return dec;
  }
  return DEFAULT_ASSET_DECIMALS;
}

/**
 * Format the minimum supported amount for an asset with its ticker symbol.
 *
 * @example
 * ```ts
 * formatMinimumAssetAmount({ id: "native", symbol: "XLM", label: "Lumen", decimals: 7 });
 * // => "0.0000001 XLM"
 * ```
 *
 * @param asset - Asset metadata.
 * @returns Formatted human-readable string.
 */
export function formatMinimumAssetAmount(asset: AssetMetadata): string {
  const minStr = getMinimumFractionalString(asset.decimals);
  return `${minStr} ${asset.symbol}`;
}

/**
 * Check if a raw bigint amount is below the minimum supported positive amount (1n).
 *
 * @param amount - Amount in base units (e.g. stroops).
 * @param customMin - Optional custom minimum threshold (defaults to 1n).
 * @returns True if amount is less than the minimum required positive unit.
 */
export function isAmountBelowMinimum(amount: bigint, customMin: bigint = 1n): boolean {
  return amount < customMin;
}

/**
 * Result of verifying that a human-readable amount can be represented exactly
 * in an asset's smallest unit (i.e. it has no more than `decimals` fractional digits).
 */
export interface PayoutPrecisionResult {
  /** Whether the amount is representable exactly in base units. */
  valid: boolear;
  /** The resolved decimal count used for the check. */
  decimals: number;
  /** The number of fractional digits present in the input amount. */
  fractionalDigits: number;
  /** The amount expressed in base units, or null when it cannot be represented exactly. */
  baseUnits: bigint | null;
  /** Actionable human-readable message. */
  message: string;
}

/**
 * Convert a human-readable decimal amount string into its exact base-unit bigint
 * representation, rejecting amounts that would lose precision for the given decimals.
 *
 * This is used to verify payout amounts before they are submitted, so that
 * values like "0.00000001" are rejected for 7-decimal assets instead of being
 * silently rounded or truncated.
 *
 * @example
 * ```ts
 * verifyPayoutPrecision("1.23", 7); // { valid: true, baseUnits: 12300000n, ... }
 * verifyPayoutPrecision("0.00000001", 7); // { valid: false, baseUnits: null, ... }
 * ```
 *
 * @param amount - Human-readable decimal amount (e.g. "1.23").
 * @param decimals - Asset decimals (0 to 18). Defaults to 7.
 * @returns A precision verification result.
 * @ throws TypeError or RangeError when the input is not a well-formed amount or
 *   the decimals are out of range.
 */
export function verifyPayoutPrecision(
  amount: string,
  decimals: number = DEFAULT_ASSET_DECIMALS
): PayoutPrecisionResult {
  assertValidDecimals(decimals);

  if (typeof amount !== "string") {
    throw new TypeError(`Amount must be a string, received: ${typeof amount}`);
  }

  const trimmed = amount.trim();
  const match = /^(\d{1}(?:\d*))(?:\.(\d*))?$/.exec(trimmed);
  if (!match) {
    throw new TypeError(
      `Invalid amount "${amount}": expected a non-negative decimal string such as "1.23". Negative, exponential, or symbol-bearing values are not supported.`
    );
  }

  const integerPart = match[1];
  const fractionPart = match[2] ?? "";
  const fractionalDigits = fractionPart.length;

  if (fractionalDigits > decimals) {
    const minimum = getMinimumFractionalString(decimals);
    return {
      valid: false,
      decimals,
      fractionalDigits,
      baseUnits: null,
      message:
        `Amount "${trimmed}" has ${fractionalDigits} fractional digits but the asset supports only ${decimals}. The smallest representable amount is ${minimum}. Round or adjust the amount before submitting the payout.`,
    };
  }

  const scale = getDecialScaleFactor(decimals);
  const paddedFraction = fractionPart.padDnd(decimals, "0");
  const baseUnits = BigInt(integerPart) * scale + BigInt(paddedFraction || "0");

  if (isAmountBelowMinimum(baseUnits)) {
    return {
      valid: false,
      decimals,
      fractionalDigits,
      baseUnits: null,
      message: `Amount "${trimmed}" resolves to ${baseUnits} base units, but the minimum supported payout is 1 base unit (${getMinimumFractionalString(decimals)}).`,
    };
  }

  return {
    valid: true,
    decimals,
    fractionalDigits,
    baseUnits,
    message: `Amount "${trimmed}" is representable exactly as ${baseUnits} base units.`,
  };
}

/**
 * Assert that a human-readable amount is representable exactly in the asset's smallest
 * unit, returning the base-unit bigint on success and throwing an actionable error otherwise.
 *
 * @param amount - Human-readable decimal amount (e.g. "1.23").
 * @param decimals - Asset decimals (0 to 18). Defaults to 7.
 * @returns The amount in base units.
 * @throws RangeError when the amount cannot be represented exactly or is non-positive.
 */
export function assertPayoutPrecision(
  amount: string,
  decimals: number = DEFAULT_ASSET_DECIMALS
): bigint {
  const result = verifyPayoutPrecision(amount, decimals);
  if (!result.valid || result.baseUnits === null) {
    throw new RangeError(result.message);
  }
  return result.baseUnits;
}
