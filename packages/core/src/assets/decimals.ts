/**
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
