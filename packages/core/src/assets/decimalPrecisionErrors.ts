/*
 * Safe, typed errors for asset decimal precision failures (#940).
 *
 * Decimal-precision checks sit directly on the payout path, so the values they
 * inspect are frequently salary amounts. Errors raised here therefore follow
 * strict privacy rules:
 *
 * - Messages NEVER echo the raw amount, its base-unit value, or any employee or
 *   recipient identifier.
 * - Only asset-level metadata (decimal counts, supported range, the smallest
 *   representable unit) and structural facts (e.g. how many fractional digits
 *   were supplied, or the JavaScript type received) are surfaced.
 * - Every error carries a stable machine-readable `code` and an actionable
 *   `action` string so integrators can branch on and display failures without
 *   string-matching messages.
 */

import { ValidationError } from "../core/errors";

/**
 * Stable codes describing why an asset decimal precision check failed.
 */
export const AssetDecimalPrecisionErrorCode = {
  /** The decimals value is not an integer number (e.g. `2.5`, `"7"`, `null`). */
  DECIMALS_NOT_INTEGER: "ASSET_DECIMALS_NOT_INTEGER",
  /** The decimals value is an integer outside the supported `[0, 18]` range. */
  DECIMALS_OUT_OF_RANGE: "ASSET_DECIMALS_OUT_OF_RANGE",
  /** The amount was not supplied as a string. */
  AMOUNT_NOT_STRING: "ASSET_AMOUNT_NOT_STRING",
  /** The amount string is not a plain non-negative decimal (e.g. `"1.23"`). */
  AMOUNT_MALFORMED: "ASSET_AMOUNT_MALFORMED",
  /** The amount has more fractional digits than the asset supports. */
  EXCESS_FRACTIONAL_DIGITS: "ASSET_AMOUNT_EXCESS_FRACTIONAL_DIGITS",
  /** The amount resolves to less than the asset's smallest unit (1 base unit). */
  BELOW_MINIMUM_UNIT: "ASSET_AMOUNT_BELOW_MINIMUM_UNIT",
} as const;

export type AssetDecimalPrecisionErrorCodeType =
  (typeof AssetDecimalPrecisionErrorCode)[keyof typeof AssetDecimalPrecisionErrorCode];

/**
 * Privacy-safe structured context attached to an {@link AssetDecimalPrecisionError}.
 *
 * Only asset-level metadata and structural facts are included; amounts and
 * identifiers are never present.
 */
export interface AssetDecimalPrecisionDetails {
  /** The asset's decimal count, when it was valid. */
  decimals?: number;
  /** The decimals value received, only when it was a safe finite integer. */
  receivedDecimals?: number;
  /** Lower bound of the supported decimals range. */
  minDecimals?: number;
  /** Upper bound of the supported decimals range. */
  maxDecimals?: number;
  /** Number of fractional digits present in the supplied amount. */
  fractionalDigits?: number;
  /** The asset's smallest representable amount, e.g. `"0.0000001"`. */
  minimumAmount?: string;
  /** JavaScript type of a value that had the wrong type, e.g. `"number"`. */
  receivedType?: string;
}

/**
 * Thrown when an asset decimal count or an amount's precision is invalid.
 *
 * Extends {@link ValidationError} (and therefore `ZkPayrollError`), so it can
 * be caught alongside other SDK validation failures.
 *
 * @example
 * ```ts
 * try {
 *   assertPayoutPrecision(input, 7);
 * } catch (err) {
 *   if (err instanceof AssetDecimalPrecisionError &&
 *       err.code === AssetDecimalPrecisionErrorCode.EXCESS_FRACTIONAL_DIGITS) {
 *     showHint(err.action);
 *   }
 * }
 * ```
 */
export class AssetDecimalPrecisionError extends ValidationError {
  declare public readonly code: AssetDecimalPrecisionErrorCodeType;
  /** Actionable guidance for resolving the failure. */
  public readonly action: string;
  /** Privacy-safe structured details. */
  public readonly details: AssetDecimalPrecisionDetails;

  constructor(
    code: AssetDecimalPrecisionErrorCodeType,
    message: string,
    action: string,
    field: "decimals" | "amount",
    details: AssetDecimalPrecisionDetails = {}
  ) {
    super(`${message} ${action}`, field, code, { ...details });
    this.name = "AssetDecimalPrecisionError";
    this.action = action;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Describe the type of an unexpected value without revealing its contents.
 */
export function describeValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return typeof value;
}

/**
 * Type guard for {@link AssetDecimalPrecisionError}.
 */
export function isAssetDecimalPrecisionError(err: unknown): err is AssetDecimalPrecisionError {
  return err instanceof AssetDecimalPrecisionError;
}
