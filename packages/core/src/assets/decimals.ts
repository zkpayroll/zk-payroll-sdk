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
import {
  AssetDecimalPrecisionError,
  AssetDecimalPrecisionErrorCode,
  AssetDecimalPrecisionErrorCodeType,
  describeValueType,
} from "./decimalPrecisionErrors";

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
 * The thrown error never echoes non-integer input (which may be a mis-passed
 * amount); it reports only the received type. Out-of-range integers are
 * reported because they are asset metadata, not payroll data.
 *
 * @param decimals - The decimals value to validate.
 * @throws {AssetDecimalPrecisionError} with code `ASSET_DECIMALS_NOT_INTEGER`
 *   or `ASSET_DECIMALS_OUT_OF_RANGE` if invalid.
 */
export function assertValidDecimals(decimals: number): void {
  if (typeof decimals !== "number" || !Number.isInteger(decimals)) {
    throw new AssetDecimalPrecisionError(
      AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER,
      `Asset decimals must be an integer, but a non-integer value of type "${describeValueType(decimals)}" was provided.`,
      `Use an integer between ${MIN_SUPPORTED_DECIMALS} and ${MAX_SUPPORTED_DECIMALS} from the asset's metadata.`,
      "decimals",
      {
        receivedType: describeValueType(decimals),
        minDecimals: MIN_SUPPORTED_DECIMALS,
        maxDecimals: MAX_SUPPORTED_DECIMALS,
      }
    );
  }
  if (decimals < MIN_SUPPORTED_DECIMALS || decimals > MAX_SUPPORTED_DECIMALS) {
    const safeReceived = Number.isSafeInteger(decimals) ? decimals : undefined;
    throw new AssetDecimalPrecisionError(
      AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE,
      `Asset decimals${safeReceived !== undefined ? ` (${safeReceived})` : ""} are outside the supported range ${MIN_SUPPORTED_DECIMALS}-${MAX_SUPPORTED_DECIMALS}.`,
      `Check the asset's metadata; supported assets use between ${MIN_SUPPORTED_DECIMALS} and ${MAX_SUPPORTED_DECIMALS} decimals.`,
      "decimals",
      {
        receivedDecimals: safeReceived,
        minDecimals: MIN_SUPPORTED_DECIMALS,
        maxDecimals: MAX_SUPPORTED_DECIMALS,
      }
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
  valid: boolean;
  /** The resolved decimal count used for the check. */
  decimals: number;
  /** The number of fractional digits present in the input amount. */
  fractionalDigits: number;
  /** The amount expressed in base units, or null when it cannot be represented exactly. */
  baseUnits: bigint | null;
  /**
   * Actionable human-readable message. Never contains the amount or its
   * base-unit value, so it is safe to log or surface to end users.
   */
  message: string;
  /** Stable failure code; present only when `valid` is `false`. */
  code?: AssetDecimalPrecisionErrorCodeType;
  /** Actionable guidance; present only when `valid` is `false`. */
  action?: string;
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
 * @returns A precision verification result. Messages never include the amount.
 * @throws {AssetDecimalPrecisionError} when the decimals are invalid
 *   (`ASSET_DECIMALS_*`) or the amount is not a well-formed decimal string
 *   (`ASSET_AMOUNT_NOT_STRING`, `ASSET_AMOUNT_MALFORMED`).
 */
export function verifyPayoutPrecision(
  amount: string,
  decimals: number = DEFAULT_ASSET_DECIMALS
): PayoutPrecisionResult {
  assertValidDecimals(decimals);

  if (typeof amount !== "string") {
    throw new AssetDecimalPrecisionError(
      AssetDecimalPrecisionErrorCode.AMOUNT_NOT_STRING,
      `Amount must be a decimal string, but a value of type "${describeValueType(amount)}" was provided.`,
      `Pass the amount as a string such as "1.23" to avoid floating-point precision loss.`,
      "amount",
      { receivedType: describeValueType(amount), decimals }
    );
  }

  const trimmed = amount.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) {
    throw new AssetDecimalPrecisionError(
      AssetDecimalPrecisionErrorCode.AMOUNT_MALFORMED,
      "Amount is not a valid non-negative decimal string.",
      `Use plain digits with an optional decimal point, such as "1.23". Negative, exponential, grouped, or symbol-bearing values are not supported.`,
      "amount",
      { decimals }
    );
  }

  const integerPart = match[1];
  const fractionPart = match[2] ?? "";
  const fractionalDigits = fractionPart.length;
  const minimumAmount = getMinimumFractionalString(decimals);

  if (fractionalDigits > decimals) {
    return {
      valid: false,
      decimals,
      fractionalDigits,
      baseUnits: null,
      code: AssetDecimalPrecisionErrorCode.EXCESS_FRACTIONAL_DIGITS,
      message: `Amount has ${fractionalDigits} fractional digits but the asset supports only ${decimals}. The smallest representable amount is ${minimumAmount}.`,
      action: `Round or adjust the amount to at most ${decimals} decimal places before submitting the payout.`,
    };
  }

  const scale = getDecimalScaleFactor(decimals);
  const paddedFraction = fractionPart.padEnd(decimals, "0");
  const baseUnits = BigInt(integerPart) * scale + BigInt(paddedFraction || "0");

  if (isAmountBelowMinimum(baseUnits)) {
    return {
      valid: false,
      decimals,
      fractionalDigits,
      baseUnits: null,
      code: AssetDecimalPrecisionErrorCode.BELOW_MINIMUM_UNIT,
      message: `Amount is below the asset's smallest unit. The minimum supported payout is 1 base unit (${minimumAmount}).`,
      action: `Increase the amount to at least ${minimumAmount}.`,
    };
  }

  return {
    valid: true,
    decimals,
    fractionalDigits,
    baseUnits,
    message: "Amount is representable exactly in the asset's base units.",
  };
}

/**
 * Assert that a human-readable amount is representable exactly in the asset's smallest
 * unit, returning the base-unit bigint on success and throwing an actionable error otherwise.
 *
 * @param amount - Human-readable decimal amount (e.g. "1.23").
 * @param decimals - Asset decimals (0 to 18). Defaults to 7.
 * @returns The amount in base units.
 * @throws {AssetDecimalPrecisionError} when the decimals or amount are invalid,
 *   the amount has excess fractional digits, or it is below the smallest unit.
 *   The error never includes the amount itself.
 */
export function assertPayoutPrecision(
  amount: string,
  decimals: number = DEFAULT_ASSET_DECIMALS
): bigint {
  const result = verifyPayoutPrecision(amount, decimals);
  if (!result.valid || result.baseUnits === null) {
    throw new AssetDecimalPrecisionError(
      result.code ?? AssetDecimalPrecisionErrorCode.EXCESS_FRACTIONAL_DIGITS,
      result.message,
      result.action ?? `Adjust the amount to at most ${result.decimals} decimal places.`,
      "amount",
      {
        decimals: result.decimals,
        fractionalDigits: result.fractionalDigits,
        minimumAmount: getMinimumFractionalString(result.decimals),
      }
    );
  }
  return result.baseUnits;
}
