/**
 * Payout Minimum Threshold Validator
 *
 * Validates payout amounts against configurable per-asset minimum thresholds
 * before payroll disbursement. Prevents dust payouts and failed transactions
 * from sub-minimum transfers.
 *
 * ## Privacy & Security Guarantees
 * - Payout amounts are redacted by default in user-facing messages.
 * - Employee identifiers are masked in external-safe messages.
 */

/** Per-asset threshold configuration */
export interface AssetThresholdConfig {
  /** Asset identifier (e.g., "native", contract ID, or symbol) */
  asset: string;
  /** Minimum payout amount in base units (stroops) */
  minimumAmount: bigint;
  /** Optional human-readable asset label for messages */
  label?: string;
}

/** A single payout entry to validate */
export interface PayoutEntry {
  /** Employee or recipient identifier */
  employeeId?: string;
  /** Payout amount in base units */
  amount: bigint;
  /** Asset identifier */
  asset: string;
}

/** Threshold violation codes */
export type PayoutThresholdViolationCode =
  "BELOW_THRESHOLD" | "ZERO_AMOUNT" | "NEGATIVE_AMOUNT" | "UNKNOWN_ASSET";

/** Structured violation descriptor */
export interface PayoutThresholdViolation {
  code: PayoutThresholdViolationCode;
  employeeId?: string;
  redactedEmployeeId: string;
  asset: string;
  message: string;
  redactedMessage: string;
  threshold?: bigint;
}

/** Validation options */
export interface PayoutThresholdValidatorOptions {
  /** Per-asset threshold configs. If an asset is not listed, defaultThreshold is used. */
  thresholds?: AssetThresholdConfig[];
  /** Default minimum threshold for assets not in the thresholds list. Defaults to 1n. */
  defaultThreshold?: bigint;
  /** Whether to reject unknown assets (not in thresholds list). Defaults to false. */
  rejectUnknownAssets?: boolean;
  /** Redact employee IDs in messages. Defaults to true. */
  redactEmployeeId?: boolean;
  /** Redact amounts in messages. Defaults to true. */
  redactAmounts?: boolean;
}

/** Result for single payout validation */
export interface PayoutThresholdValidationResult {
  isValid: boolean;
  violation?: PayoutThresholdViolation;
}

/** Batch validation result */
export interface PayoutThresholdBatchResult {
  isValid: boolean;
  violations: PayoutThresholdViolation[];
  summary: {
    totalEntries: number;
    validCount: number;
    violationCount: number;
    belowThresholdCount: number;
    zeroCount: number;
    negativeCount: number;
    unknownAssetCount: number;
  };
}

function redactEmpId(id?: string): string {
  if (!id || id.trim().length === 0) return "[ANONYMOUS_RECIPIENT]";
  const clean = id.trim();
  if (clean.length <= 4) return "[REDACTED_EMPLOYEE]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

function buildThresholdMap(
  configs?: AssetThresholdConfig[]
): Map<string, { min: bigint; label?: string }> {
  const map = new Map<string, { min: bigint; label?: string }>();
  if (!configs) return map;
  for (const cfg of configs) {
    map.set(cfg.asset, { min: cfg.minimumAmount, label: cfg.label });
  }
  return map;
}

/**
 * Validate a single payout entry against threshold configuration.
 */
export function validatePayoutThreshold(
  entry: PayoutEntry,
  options: PayoutThresholdValidatorOptions = {}
): PayoutThresholdValidationResult {
  const {
    thresholds,
    defaultThreshold = 1n,
    rejectUnknownAssets = false,
    redactEmployeeId: shouldRedactEmp = true,
    redactAmounts: shouldRedactAmt = true,
  } = options;

  const empDisplay = entry.employeeId || "anonymous";
  const empRedacted = shouldRedactEmp ? redactEmpId(entry.employeeId) : empDisplay;
  const thresholdMap = buildThresholdMap(thresholds);

  // Negative amount
  if (entry.amount < 0n) {
    return {
      isValid: false,
      violation: {
        code: "NEGATIVE_AMOUNT",
        employeeId: entry.employeeId,
        redactedEmployeeId: empRedacted,
        asset: entry.asset,
        message: `Negative payout amount for employee ${empDisplay} (${entry.asset}).`,
        redactedMessage: `Negative payout amount for employee ${empRedacted} (${entry.asset}).`,
      },
    };
  }

  // Zero amount
  if (entry.amount === 0n) {
    return {
      isValid: false,
      violation: {
        code: "ZERO_AMOUNT",
        employeeId: entry.employeeId,
        redactedEmployeeId: empRedacted,
        asset: entry.asset,
        message: `Zero payout amount for employee ${empDisplay} (${entry.asset}).`,
        redactedMessage: `Zero payout amount for employee ${empRedacted} (${entry.asset}).`,
      },
    };
  }

  // Unknown asset check
  const assetConfig = thresholdMap.get(entry.asset);
  if (!assetConfig && rejectUnknownAssets) {
    return {
      isValid: false,
      violation: {
        code: "UNKNOWN_ASSET",
        employeeId: entry.employeeId,
        redactedEmployeeId: empRedacted,
        asset: entry.asset,
        message: `Unknown asset "${entry.asset}" for employee ${empDisplay}; no threshold configured.`,
        redactedMessage: `Unknown asset for employee ${empRedacted}; no threshold configured.`,
      },
    };
  }

  // Threshold check
  const threshold = assetConfig?.min ?? defaultThreshold;
  if (entry.amount < threshold) {
    const amtDisplay = shouldRedactAmt ? "[REDACTED]" : `${entry.amount}`;
    const assetLabel = assetConfig?.label ?? entry.asset;
    return {
      isValid: false,
      violation: {
        code: "BELOW_THRESHOLD",
        employeeId: entry.employeeId,
        redactedEmployeeId: empRedacted,
        asset: entry.asset,
        message: `Payout amount ${amtDisplay} for employee ${empDisplay} is below minimum threshold of ${threshold} (${assetLabel}).`,
        redactedMessage: `Payout amount for employee ${empRedacted} is below minimum threshold (${assetLabel}).`,
        threshold,
      },
    };
  }

  return { isValid: true };
}

/**
 * Validate a batch of payout entries against threshold configuration.
 */
export function validatePayoutThresholdBatch(
  entries: PayoutEntry[],
  options: PayoutThresholdValidatorOptions = {}
): PayoutThresholdBatchResult {
  const violations: PayoutThresholdViolation[] = [];
  let belowThresholdCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;
  let unknownAssetCount = 0;

  for (const entry of entries) {
    const result = validatePayoutThreshold(entry, options);
    if (!result.isValid && result.violation) {
      violations.push(result.violation);
      switch (result.violation.code) {
        case "BELOW_THRESHOLD":
          belowThresholdCount++;
          break;
        case "ZERO_AMOUNT":
          zeroCount++;
          break;
        case "NEGATIVE_AMOUNT":
          negativeCount++;
          break;
        case "UNKNOWN_ASSET":
          unknownAssetCount++;
          break;
      }
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
    summary: {
      totalEntries: entries.length,
      validCount: entries.length - violations.length,
      violationCount: violations.length,
      belowThresholdCount,
      zeroCount,
      negativeCount,
      unknownAssetCount,
    },
  };
}

/**
 * Quick boolean check whether a payout meets its asset's minimum threshold.
 */
export function isPayoutAboveThreshold(
  amount: bigint,
  asset: string,
  thresholds?: AssetThresholdConfig[],
  defaultThreshold: bigint = 1n
): boolean {
  const result = validatePayoutThreshold({ amount, asset }, { thresholds, defaultThreshold });
  return result.isValid;
}
