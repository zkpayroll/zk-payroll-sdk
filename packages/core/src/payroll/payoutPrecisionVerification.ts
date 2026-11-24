/**
 * Validation for Payout Amount Precision (#999)
 *
 * Validates payout amounts against target and source asset decimal precisions
 * before any blockchain transaction or ZK proof generation is attempted.
 * Prevents precision loss, silent truncation, and invalid decimal fractions.
 *
 * ## Privacy & Security Guarantees
 * - Messages and diagnostics NEVER contain employee identifiers, salaries,
 *   recipient addresses, or proof witnesses.
 * - Only sanitized asset codes and decimal precision metadata are surfaced.
 */

import {
  DEFAULT_ASSET_DECIMALS,
  MIN_SUPPORTED_DECIMALS,
  MAX_SUPPORTED_DECIMALS,
  isValidDecimals,
  getDecimalScaleFactor,
} from "../assets/decimals";

/**
 * Standard violation codes for payout precision validation.
 */
export type PayoutPrecisionViolationCode =
  | "PRECISION_LOSS"
  | "NEGATIVE_AMOUNT"
  | "ZERO_AMOUNT"
  | "INVALID_SOURCE_DECIMALS"
  | "INVALID_TARGET_DECIMALS"
  | "EXCESS_FRACTIONAL_DIGITS"
  | "BELOW_MINIMUM_BASE_UNIT"
  | "AMOUNT_NON_NUMERIC";

/**
 * Structured violation details explaining why precision validation failed.
 */
export interface PayoutPrecisionViolation {
  /** Stable violation code */
  code: PayoutPrecisionViolationCode;
  /** Privacy-safe explanation */
  message: string;
  /** Actionable guidance for the operator */
  action: string;
  /** Optional sanitized context (never contains salary or employee data) */
  details?: Record<string, unknown>;
}

/**
 * Result of payout precision verification.
 */
export interface PayoutPrecisionVerificationResult {
  /** True when the amount satisfies all precision criteria */
  isValid: boolean;
  /** Violation descriptor when `isValid` is false */
  violation?: PayoutPrecisionViolation;
  /** Resolved base units as bigint when valid */
  baseUnits?: bigint;
  /** Resolved decimal precision used for verification */
  decimals: number;
  /** Number of fractional digits in human-readable input */
  fractionalDigits?: number;
  /** Human-readable status message */
  message?: string;
}

/**
 * Descriptor for an asset specifying its decimal precision and symbol.
 */
export interface PayoutAssetDescriptor {
  id?: string;
  symbol?: string;
  label?: string;
  decimals: number;
}

/**
 * Options for payout precision validation.
 */
export interface PayoutPrecisionOptions {
  /** Source decimal precision if converting between asset precisions */
  sourceDecimals?: number;
  /** Custom minimum amount in base units */
  minAmount?: bigint;
  /** Whether a zero amount is permissible @default false */
  allowZero?: boolean;
}

/**
 * Custom error thrown when payout amount precision verification fails.
 */
export class PayoutPrecisionError extends Error {
  public readonly code: PayoutPrecisionViolationCode;
  public readonly violation: PayoutPrecisionViolation;

  constructor(violation: PayoutPrecisionViolation) {
    super(violation.message);
    this.name = "PayoutPrecisionError";
    this.code = violation.code;
    this.violation = violation;
  }
}

/**
 * Resolves target decimals and asset symbol from either a number or an asset descriptor.
 */
function resolveAssetInfo(assetOrDecimals: number | PayoutAssetDescriptor): {
  decimals: number;
  symbol: string;
} {
  if (typeof assetOrDecimals === "number") {
    return {
      decimals: assetOrDecimals,
      symbol: "ASSET",
    };
  }
  return {
    decimals: assetOrDecimals.decimals,
    symbol: assetOrDecimals.symbol ?? assetOrDecimals.label ?? "ASSET",
  };
}

/**
 * Validates payout amount precision against asset decimal rules (#999).
 *
 * @param amount - The payout amount as a string, bigint base units, or number
 * @param assetOrDecimals - Asset descriptor or target decimal precision (0 to 18)
 * @param options - Additional verification options
 * @returns Comprehensive precision verification result
 */
export function verifyPayoutPrecision(
  amount: string | number | bigint,
  assetOrDecimals: number | PayoutAssetDescriptor = DEFAULT_ASSET_DECIMALS,
  options: PayoutPrecisionOptions = {}
): PayoutPrecisionVerificationResult {
  const { decimals, symbol } = resolveAssetInfo(assetOrDecimals);

  // 1. Validate target decimals
  if (!isValidDecimals(decimals)) {
    return {
      isValid: false,
      decimals,
      violation: {
        code: "INVALID_TARGET_DECIMALS",
        message: `Target decimal precision (${decimals}) is out of supported range [${MIN_SUPPORTED_DECIMALS}, ${MAX_SUPPORTED_DECIMALS}].`,
        action: `Specify a valid target decimal precision between ${MIN_SUPPORTED_DECIMALS} and ${MAX_SUPPORTED_DECIMALS}.`,
      },
    };
  }

  // 2. Validate source decimals if specified
  if (options.sourceDecimals !== undefined && !isValidDecimals(options.sourceDecimals)) {
    return {
      isValid: false,
      decimals,
      violation: {
        code: "INVALID_SOURCE_DECIMALS",
        message: `Source decimal precision (${options.sourceDecimals}) is out of supported range [${MIN_SUPPORTED_DECIMALS}, ${MAX_SUPPORTED_DECIMALS}].`,
        action: `Specify a valid source decimal precision between ${MIN_SUPPORTED_DECIMALS} and ${MAX_SUPPORTED_DECIMALS}.`,
      },
    };
  }

  // 3. Handle bigint input
  if (typeof amount === "bigint") {
    if (amount < 0n) {
      return {
        isValid: false,
        decimals,
        violation: {
          code: "NEGATIVE_AMOUNT",
          message: "Payout amount cannot be negative.",
          action: "Provide a positive payout amount in base units.",
        },
      };
    }
    if (amount === 0n && !options.allowZero) {
      return {
        isValid: false,
        decimals,
        violation: {
          code: "ZERO_AMOUNT",
          message: "Payout amount must be greater than zero.",
          action: "Provide a non-zero payout amount.",
        },
      };
    }

    // Check downscaling precision loss if sourceDecimals > decimals
    if (options.sourceDecimals !== undefined && options.sourceDecimals > decimals) {
      const diff = options.sourceDecimals - decimals;
      const divisor = 10n ** BigInt(diff);
      const remainder = amount % divisor;
      if (remainder !== 0n) {
        return {
          isValid: false,
          decimals,
          violation: {
            code: "PRECISION_LOSS",
            message: `Converting payout amount from ${options.sourceDecimals} decimals to ${decimals} decimals results in precision loss for ${symbol}.`,
            action: `Ensure the amount has no fractional remainder beyond ${decimals} decimal places.`,
            details: { sourceDecimals: options.sourceDecimals, targetDecimals: decimals },
          },
        };
      }
      const scaled = amount / divisor;
      return {
        isValid: true,
        decimals,
        baseUnits: scaled,
        message: "Payout amount is representable without precision loss.",
      };
    }

    return {
      isValid: true,
      decimals,
      baseUnits: amount,
      message: "Payout amount is valid in base units.",
    };
  }

  // 4. Handle string or number input
  const strAmount = typeof amount === "number" ? String(amount) : String(amount).trim();

  // Validate numeric format
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(strAmount);
  if (!match || (!match[2] && !match[3])) {
    return {
      isValid: false,
      decimals,
      violation: {
        code: "AMOUNT_NON_NUMERIC",
        message: "Payout amount is not a valid decimal number string.",
        action: "Provide a valid non-negative decimal string (e.g., '10.50').",
      },
    };
  }

  const isNegative = Boolean(match[1]);
  if (isNegative) {
    return {
      isValid: false,
      decimals,
      violation: {
        code: "NEGATIVE_AMOUNT",
        message: "Payout amount cannot be negative.",
        action: "Provide a positive payout amount.",
      },
    };
  }

  const integerPart = match[2] || "0";
  const fractionPart = match[3] || "";
  const fractionalDigits = fractionPart.length;

  // Check excess fractional digits
  if (fractionalDigits > decimals) {
    return {
      isValid: false,
      decimals,
      fractionalDigits,
      violation: {
        code: "PRECISION_LOSS",
        message: `Payout amount has ${fractionalDigits} fractional digits but asset ${symbol} supports only ${decimals} decimals.`,
        action: `Adjust or round the amount to at most ${decimals} decimal places.`,
        details: { fractionalDigits, maxDecimals: decimals },
      },
    };
  }

  const scale = getDecimalScaleFactor(decimals);
  const paddedFraction = fractionPart.padEnd(decimals, "0");
  const baseUnits = BigInt(integerPart) * scale + BigInt(paddedFraction || "0");

  if (baseUnits === 0n && !options.allowZero) {
    return {
      isValid: false,
      decimals,
      fractionalDigits,
      violation: {
        code: "ZERO_AMOUNT",
        message: "Payout amount resolves to zero base units.",
        action: "Provide a non-zero payout amount.",
      },
    };
  }

  const min = options.minAmount ?? (options.allowZero ? 0n : 1n);
  if (baseUnits < min) {
    return {
      isValid: false,
      decimals,
      fractionalDigits,
      violation: {
        code: "BELOW_MINIMUM_BASE_UNIT",
        message: `Payout amount resolves to less than the minimum required base units (${min.toString()}).`,
        action: "Increase the payout amount to satisfy the minimum threshold.",
      },
    };
  }

  return {
    isValid: true,
    decimals,
    fractionalDigits,
    baseUnits,
    message: `Payout amount is valid with exact precision for ${symbol}.`,
  };
}

/**
 * Asserts that a payout amount satisfies precision constraints, throwing
 * a privacy-safe {@link PayoutPrecisionError} if validation fails.
 */
export function assertPayoutPrecision(
  amount: string | number | bigint,
  assetOrDecimals: number | PayoutAssetDescriptor = DEFAULT_ASSET_DECIMALS,
  options: PayoutPrecisionOptions = {}
): bigint {
  const result = verifyPayoutPrecision(amount, assetOrDecimals, options);
  if (!result.isValid || result.violation || result.baseUnits === undefined) {
    const violation = result.violation ?? {
      code: "PRECISION_LOSS",
      message: "Payout amount precision validation failed.",
      action: "Review payout amount precision.",
    };
    throw new PayoutPrecisionError(violation);
  }
  return result.baseUnits;
}
