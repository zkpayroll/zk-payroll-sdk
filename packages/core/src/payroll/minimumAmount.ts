/**
 * Minimum Payroll Amount Validator
 *
 * Validates that individual payroll entries and batches meet or exceed the minimum
 * supported non-zero transferable amount for a given asset before contract submission.
 *
 * ## Why This Matters
 * Sub-minimum amounts cause contract reverts, precision truncation, rounding-sensitive
 * dust balances, and wasted transaction submission fees on-chain.
 *
 * ## Privacy & Security Guarantees
 * - Implements strict redaction by default for employee identifiers and salary amounts
 *   in logs, error messages, and external telemetry.
 * - Unredacted details are available only when explicitly requested for internal audits.
 */

import { AssetMetadata } from "../assets/types";
import { AssetRegistry } from "../assets/AssetRegistry";
import {
  DEFAULT_ASSET_DECIMALS,
  getDecimalScaleFactor,
  getMinimumFractionalString,
  resolveAssetDecimals,
} from "../assets/decimals";

/**
 * Status classification for amount validation checks.
 */
export type MinimumAmountStatus =
  "valid" | "below_minimum" | "zero_amount" | "negative_amount" | "invalid_amount";

/**
 * Input structure representing a payroll payment entry.
 */
export interface PayrollEntryAmountInput {
  /** Employee or recipient identifier (address, ID, or public key) */
  employeeId?: string;
  /** Payment amount as base unit bigint, decimal string ("10.50"), or number */
  amount: bigint | string | number;
  /** Asset metadata or string asset identifier ("native", contract ID, or symbol) */
  asset?: AssetMetadata | string;
  /** Optional explicit asset decimal precision (defaults to asset metadata or 7) */
  decimals?: number;
  /** Optional custom minimum threshold in base units */
  customMinAmount?: bigint;
}

/**
 * Configuration options for minimum amount validation.
 */
export interface ValidateMinimumAmountOptions {
  /** Custom minimum threshold in base units (defaults to 1n = 1 smallest unit) */
  customMinAmount?: bigint;
  /** Fallback asset metadata if not specified in the entry */
  metadata?: AssetMetadata;
  /** Fallback decimal precision (defaults to 7) */
  decimals?: number;
  /** Redact employee ID in user-facing error messages (defaults to true) */
  redactEmployeeId?: boolean;
  /** Redact amount in error messages to preserve payroll confidentiality (defaults to true) */
  redactAmounts?: boolean;
  /** Whether zero amounts are allowed (defaults to false for payroll payments) */
  allowZero?: boolean;
}

/**
 * Detailed validation issue descriptor.
 */
export interface MinimumAmountValidationIssue {
  /** Status classification */
  status: MinimumAmountStatus;
  /** Machine-readable error code */
  code: string;
  /** Full descriptive message (may contain amount/employeeId for internal debugging) */
  message: string;
  /** Redacted message safe for UI display, telemetry, and external logs */
  redactedMessage: string;
  /** Employee identifier if present */
  employeeId?: string;
  /** Redacted employee identifier */
  redactedEmployeeId?: string;
  /** Parsed base unit amount if valid integer representation */
  amount?: bigint;
  /** Minimum required amount in base units */
  minRequired: bigint;
  /** Minimum required amount formatted as human-readable string */
  minRequiredFormatted: string;
  /** Asset symbol */
  assetSymbol: string;
}

/**
 * Result of batch validation across multiple payroll entries.
 */
export interface PayrollBatchMinimumAmountValidationResult {
  /** True if all entries passed minimum amount validation */
  isValid: boolean;
  /** Array of validation issues for failed entries */
  issues: MinimumAmountValidationIssue[];
  /** Summary statistics */
  summary: {
    totalEntries: number;
    validCount: number;
    invalidCount: number;
    belowMinimumCount: number;
    zeroCount: number;
    negativeCount: number;
    invalidCountFormat: number;
  };
}

/**
 * Structured error thrown when a payroll entry violates minimum amount constraints.
 */
export class PayrollMinimumAmountError extends Error {
  readonly code: string;
  readonly status: MinimumAmountStatus;
  readonly issue: MinimumAmountValidationIssue;

  constructor(issue: MinimumAmountValidationIssue, useRedactedMessage = true) {
    super(useRedactedMessage ? issue.redactedMessage : issue.message);
    this.name = "PayrollMinimumAmountError";
    this.code = issue.code;
    this.status = issue.status;
    this.issue = issue;
  }
}

/**
 * Redact an employee identifier for privacy-preserving logs.
 * E.g. "GABCD...1234" or "emp-98765" -> "emp-***65" or "[REDACTED_EMPLOYEE]"
 */
export function redactEmployeeId(id?: string): string {
  if (!id || id.trim().length === 0) {
    return "[ANONYMOUS_RECIPIENT]";
  }
  const clean = id.trim();
  if (clean.length <= 4) {
    return "[REDACTED_EMPLOYEE]";
  }
  const start = clean.slice(0, 3);
  const end = clean.slice(-3);
  return `${start}***${end}`;
}

/**
 * Helper to resolve asset symbol and decimals from input and options.
 */
function resolveAssetInfo(
  entryAsset?: AssetMetadata | string,
  entryDecimals?: number,
  fallbackMetadata?: AssetMetadata,
  fallbackDecimals?: number
): { symbol: string; decimals: number } {
  let symbol = "ASSET";
  let decimals = DEFAULT_ASSET_DECIMALS;

  if (typeof entryAsset === "object" && entryAsset !== null) {
    symbol = entryAsset.symbol || symbol;
    decimals = resolveAssetDecimals(entryAsset);
  } else if (typeof entryAsset === "string") {
    const fromRegistry = AssetRegistry.get(entryAsset);
    if (fromRegistry) {
      symbol = fromRegistry.symbol;
      decimals = fromRegistry.decimals;
    } else {
      symbol = entryAsset.toUpperCase();
      if (entryDecimals !== undefined) {
        decimals = resolveAssetDecimals(entryDecimals);
      }
    }
  } else if (fallbackMetadata) {
    symbol = fallbackMetadata.symbol || symbol;
    decimals = resolveAssetDecimals(fallbackMetadata);
  } else if (fallbackDecimals !== undefined) {
    decimals = resolveAssetDecimals(fallbackDecimals);
  }

  return { symbol, decimals };
}

/**
 * Parse an input amount into a bigint base-unit representation.
 * Supports bigint, decimal strings ("1.5"), integers, and numbers.
 */
function parseToBaseUnits(
  rawAmount: bigint | string | number,
  decimals: number
): { baseUnits: bigint | null; errorStatus?: MinimumAmountStatus } {
  if (typeof rawAmount === "bigint") {
    if (rawAmount < 0n) {
      return { baseUnits: rawAmount, errorStatus: "negative_amount" };
    }
    if (rawAmount === 0n) {
      return { baseUnits: rawAmount, errorStatus: "zero_amount" };
    }
    return { baseUnits: rawAmount };
  }

  if (typeof rawAmount === "number") {
    if (!Number.isFinite(rawAmount) || Number.isNaN(rawAmount)) {
      return { baseUnits: null, errorStatus: "invalid_amount" };
    }
    if (rawAmount < 0) {
      return { baseUnits: null, errorStatus: "negative_amount" };
    }
    if (rawAmount === 0) {
      return { baseUnits: 0n, errorStatus: "zero_amount" };
    }
    // Convert float to string representation to avoid precision loss
    rawAmount = rawAmount.toString();
  }

  if (typeof rawAmount === "string") {
    const trimmed = rawAmount.trim();
    if (!trimmed || trimmed === "") {
      return { baseUnits: null, errorStatus: "invalid_amount" };
    }

    if (trimmed.startsWith("-")) {
      return { baseUnits: null, errorStatus: "negative_amount" };
    }

    // Check for valid decimal or integer pattern
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      return { baseUnits: null, errorStatus: "invalid_amount" };
    }

    const [wholePart, fracPart = ""] = trimmed.split(".");
    if (wholePart === "0" && (!fracPart || /^0+$/.test(fracPart))) {
      return { baseUnits: 0n, errorStatus: "zero_amount" };
    }

    const scale = getDecimalScaleFactor(decimals);
    const wholeBig = BigInt(wholePart) * scale;

    const paddedFrac = fracPart.slice(0, decimals).padEnd(decimals, "0");
    const fracBig = BigInt(paddedFrac);

    const total = wholeBig + fracBig;
    return { baseUnits: total };
  }

  return { baseUnits: null, errorStatus: "invalid_amount" };
}

/**
 * Validate a single payroll entry against the minimum supported amount.
 *
 * @param entry - Payroll entry to validate.
 * @param options - Configuration options (custom threshold, redaction, etc.).
 * @returns A `MinimumAmountValidationIssue` if invalid, or `null` if valid.
 */
export function validatePayrollEntryMinimumAmount(
  entry: PayrollEntryAmountInput,
  options: ValidateMinimumAmountOptions = {}
): MinimumAmountValidationIssue | null {
  const {
    customMinAmount,
    metadata,
    decimals: optDecimals,
    redactEmployeeId: shouldRedactEmp = true,
    redactAmounts: shouldRedactAmount = true,
    allowZero = false,
  } = options;

  const { symbol, decimals } = resolveAssetInfo(entry.asset, entry.decimals, metadata, optDecimals);

  const minRequired = entry.customMinAmount ?? customMinAmount ?? 1n;
  const minRequiredFormatted = `${getMinimumFractionalString(decimals)} ${symbol}`;
  const empDisplay = entry.employeeId || "anonymous";
  const empRedacted = shouldRedactEmp ? redactEmployeeId(entry.employeeId) : empDisplay;

  const { baseUnits, errorStatus } = parseToBaseUnits(entry.amount, decimals);

  if (errorStatus === "invalid_amount" || baseUnits === null) {
    const rawStr = String(entry.amount);
    const displayedRaw = shouldRedactAmount ? "[REDACTED]" : `"${rawStr}"`;
    return {
      status: "invalid_amount",
      code: "INVALID_PAYROLL_AMOUNT",
      message: `Invalid amount format ${displayedRaw} for employee ${empDisplay} (${symbol}).`,
      redactedMessage: `Invalid amount format for employee ${empRedacted} (${symbol}).`,
      employeeId: entry.employeeId,
      redactedEmployeeId: empRedacted,
      minRequired,
      minRequiredFormatted,
      assetSymbol: symbol,
    };
  }

  if (errorStatus === "negative_amount" || baseUnits < 0n) {
    return {
      status: "negative_amount",
      code: "NEGATIVE_PAYROLL_AMOUNT",
      message: `Negative amount ${baseUnits} is not permitted for employee ${empDisplay} (${symbol}).`,
      redactedMessage: `Negative payroll amount is not permitted for employee ${empRedacted} (${symbol}).`,
      employeeId: entry.employeeId,
      redactedEmployeeId: empRedacted,
      amount: baseUnits,
      minRequired,
      minRequiredFormatted,
      assetSymbol: symbol,
    };
  }

  if (baseUnits === 0n) {
    if (allowZero) {
      return null;
    }
    return {
      status: "zero_amount",
      code: "ZERO_PAYROLL_AMOUNT",
      message: `Zero payroll amount is not permitted for employee ${empDisplay} (${symbol}). Minimum required is ${minRequiredFormatted}.`,
      redactedMessage: `Zero payroll amount is not permitted for employee ${empRedacted} (${symbol}). Minimum required is ${minRequiredFormatted}.`,
      employeeId: entry.employeeId,
      redactedEmployeeId: empRedacted,
      amount: 0n,
      minRequired,
      minRequiredFormatted,
      assetSymbol: symbol,
    };
  }

  if (baseUnits < minRequired) {
    const actualStr = shouldRedactAmount ? "[REDACTED]" : `${baseUnits} base units`;
    return {
      status: "below_minimum",
      code: "AMOUNT_BELOW_MINIMUM",
      message: `Payroll amount ${actualStr} for employee ${empDisplay} is below the minimum required threshold of ${minRequiredFormatted} (${minRequired} base units).`,
      redactedMessage: `Payroll amount for employee ${empRedacted} is below the minimum required threshold of ${minRequiredFormatted}.`,
      employeeId: entry.employeeId,
      redactedEmployeeId: empRedacted,
      amount: baseUnits,
      minRequired,
      minRequiredFormatted,
      assetSymbol: symbol,
    };
  }

  return null;
}

/**
 * Assert that a payroll entry meets minimum amount requirements.
 * Throws `PayrollMinimumAmountError` if validation fails.
 *
 * @param entry - Payroll entry to validate.
 * @param options - Configuration options.
 */
export function assertPayrollEntryMinimumAmount(
  entry: PayrollEntryAmountInput,
  options: ValidateMinimumAmountOptions = {}
): void {
  const issue = validatePayrollEntryMinimumAmount(entry, options);
  if (issue) {
    const useRedacted = options.redactAmounts ?? true;
    throw new PayrollMinimumAmountError(issue, useRedacted);
  }
}

/**
 * Validate an array of payroll entries. Returns aggregated results and issues.
 *
 * @param entries - Array of payroll entries.
 * @param options - Validation configuration options.
 * @returns Aggregated batch validation result.
 */
export function validateBatchPayrollMinimumAmounts(
  entries: PayrollEntryAmountInput[],
  options: ValidateMinimumAmountOptions = {}
): PayrollBatchMinimumAmountValidationResult {
  const issues: MinimumAmountValidationIssue[] = [];
  let belowMinimumCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;
  let invalidCountFormat = 0;

  for (const entry of entries) {
    const issue = validatePayrollEntryMinimumAmount(entry, options);
    if (issue) {
      issues.push(issue);
      if (issue.status === "below_minimum") belowMinimumCount++;
      else if (issue.status === "zero_amount") zeroCount++;
      else if (issue.status === "negative_amount") negativeCount++;
      else if (issue.status === "invalid_amount") invalidCountFormat++;
    }
  }

  const totalEntries = entries.length;
  const invalidCount = issues.length;
  const validCount = totalEntries - invalidCount;

  return {
    isValid: invalidCount === 0,
    issues,
    summary: {
      totalEntries,
      validCount,
      invalidCount,
      belowMinimumCount,
      zeroCount,
      negativeCount,
      invalidCountFormat,
    },
  };
}

/**
 * Quick boolean check whether an amount is below the minimum threshold.
 *
 * @param amount - Amount in base units or decimal string or number.
 * @param assetOrDecimals - AssetMetadata or numeric decimal places (default: 7).
 * @param customMin - Optional minimum base units (default: 1n).
 * @returns True if below minimum or non-positive.
 */
export function isPayrollAmountBelowMinimum(
  amount: bigint | string | number,
  assetOrDecimals?: AssetMetadata | number,
  customMin: bigint = 1n
): boolean {
  const issue = validatePayrollEntryMinimumAmount({
    amount,
    asset: typeof assetOrDecimals === "object" ? assetOrDecimals : undefined,
    decimals: typeof assetOrDecimals === "number" ? assetOrDecimals : undefined,
    customMinAmount: customMin,
  });
  return issue !== null;
}
