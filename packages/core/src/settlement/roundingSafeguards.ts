/**
 * Cross-currency payout rounding safeguards for ZK Payroll.
 *
 * Provides precision checks, drift monitoring, and batch-level rounding safeguards
 * to prevent underfunding and unexpected precision loss across currency conversions.
 */

export type RoundingMode = 'floor' | 'ceil' | 'round' | 'truncate';

export type RoundingSafeguardErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_DECIMALS'
  | 'INVALID_EXCHANGE_RATE'
  | 'EXCESSIVE_DRIFT'
  | 'CUMULATIVE_DRIFT_EXCEEDED'
  | 'MISMATCHED_TARGET_AMOUNT';

export interface PayoutRoundingItem {
  id?: string;
  recipientId?: string;
  sourceAmount: string | bigint | number;
  sourceDecimals: number;
  targetDecimals: number;
  exchangeRate: number | string;
  expectedTargetAmount?: string | bigint | number;
}

export interface RoundingItemValidationResult {
  index: number;
  id?: string;
  recipientId?: string;
  valid: boolean;
  computedTargetAmount: string;
  expectedTargetAmount?: string;
  driftBps: number;
  deltaAmount: string;
  precisionLoss: boolean;
  error?: {
    code: RoundingSafeguardErrorCode;
    message: string;
  };
}

export interface RoundingSafeguardOptions {
  /** Maximum acceptable drift per item in basis points (1 bps = 0.01%). Default: 5 bps */
  maxItemDriftBps?: number;
  /** Maximum cumulative batch drift in basis points. Default: 10 bps */
  maxBatchDriftBps?: number;
  /** Rounding mode to apply when converting to integer stroops/units. Default: 'round' */
  roundingMode?: RoundingMode;
  /** Allow zero amounts. Default: false */
  allowZero?: boolean;
}

export interface RoundingSafeguardReport {
  valid: boolean;
  totalItems: number;
  passedItems: number;
  failedItems: number;
  totalSourceAmount: string;
  totalComputedTargetAmount: string;
  totalExpectedTargetAmount: string;
  cumulativeDriftBps: number;
  maxObservedDriftBps: number;
  items: RoundingItemValidationResult[];
  errors: Array<{
    index?: number;
    code: RoundingSafeguardErrorCode;
    message: string;
  }>;
}

/**
 * Computes target payout amount with precision tracking and drift measurement.
 */
export function computeTargetPayoutAmount(
  sourceAmount: string | bigint | number,
  sourceDecimals: number,
  targetDecimals: number,
  exchangeRate: number | string,
  roundingMode: RoundingMode = 'round'
): { targetAmount: string; precisionLoss: boolean } {
  const sourceNum = typeof sourceAmount === 'bigint' ? Number(sourceAmount) : Number(sourceAmount);
  const rateNum = Number(exchangeRate);

  if (!Number.isFinite(sourceNum) || sourceNum < 0) {
    throw new Error(`Invalid source amount: ${sourceAmount}`);
  }
  if (!Number.isFinite(rateNum) || rateNum <= 0) {
    throw new Error(`Invalid exchange rate: ${exchangeRate}`);
  }
  if (sourceDecimals < 0 || sourceDecimals > 18 || !Number.isInteger(sourceDecimals)) {
    throw new Error(`Invalid source decimals: ${sourceDecimals}`);
  }
  if (targetDecimals < 0 || targetDecimals > 18 || !Number.isInteger(targetDecimals)) {
    throw new Error(`Invalid target decimals: ${targetDecimals}`);
  }

  // Base conversion calculation in high precision
  // targetUnits = (sourceUnits / 10^sourceDec) * rate * 10^targetDec
  const decimalAdjustment = targetDecimals - sourceDecimals;
  const rawTarget = sourceNum * rateNum * Math.pow(10, decimalAdjustment);

  let targetRounded: bigint;
  let hasLoss = false;

  if (roundingMode === 'floor' || roundingMode === 'truncate') {
    targetRounded = BigInt(Math.floor(rawTarget));
    hasLoss = rawTarget !== Math.floor(rawTarget);
  } else if (roundingMode === 'ceil') {
    targetRounded = BigInt(Math.ceil(rawTarget));
    hasLoss = rawTarget !== Math.ceil(rawTarget);
  } else {
    // Standard half-up rounding
    targetRounded = BigInt(Math.round(rawTarget));
    hasLoss = rawTarget !== Math.round(rawTarget);
  }

  return {
    targetAmount: targetRounded.toString(),
    precisionLoss: hasLoss,
  };
}

/**
 * Validates a batch of cross-currency payout items against rounding safeguards.
 */
export function validateCrossCurrencyPayoutRounding(
  items: PayoutRoundingItem[],
  options: RoundingSafeguardOptions = {}
): RoundingSafeguardReport {
  const maxItemDriftBps = options.maxItemDriftBps ?? 5;
  const maxBatchDriftBps = options.maxBatchDriftBps ?? 10;
  const roundingMode = options.roundingMode ?? 'round';
  const allowZero = options.allowZero ?? false;

  const itemResults: RoundingItemValidationResult[] = [];
  const reportErrors: Array<{ index?: number; code: RoundingSafeguardErrorCode; message: string }> = [];

  let sumSource = 0n;
  let sumComputedTarget = 0n;
  let sumExpectedTarget = 0n;
  let maxObservedDriftBps = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const sourceNum = typeof item.sourceAmount === 'bigint' ? Number(item.sourceAmount) : Number(item.sourceAmount);
    const rateNum = Number(item.exchangeRate);

    // Validate parameters
    if (!Number.isFinite(sourceNum) || (!allowZero && sourceNum <= 0) || (allowZero && sourceNum < 0)) {
      itemResults.push({
        index: i,
        id: item.id,
        recipientId: item.recipientId,
        valid: false,
        computedTargetAmount: '0',
        expectedTargetAmount: item.expectedTargetAmount?.toString(),
        driftBps: 0,
        deltaAmount: '0',
        precisionLoss: false,
        error: {
          code: 'INVALID_AMOUNT',
          message: `Item at index ${i} has invalid source amount: ${item.sourceAmount}`,
        },
      });
      reportErrors.push({
        index: i,
        code: 'INVALID_AMOUNT',
        message: `Item at index ${i} has invalid source amount: ${item.sourceAmount}`,
      });
      continue;
    }

    if (
      item.sourceDecimals < 0 ||
      item.sourceDecimals > 18 ||
      item.targetDecimals < 0 ||
      item.targetDecimals > 18
    ) {
      itemResults.push({
        index: i,
        id: item.id,
        recipientId: item.recipientId,
        valid: false,
        computedTargetAmount: '0',
        expectedTargetAmount: item.expectedTargetAmount?.toString(),
        driftBps: 0,
        deltaAmount: '0',
        precisionLoss: false,
        error: {
          code: 'INVALID_DECIMALS',
          message: `Item at index ${i} has invalid decimal configuration. Decimals must be between 0 and 18.`,
        },
      });
      reportErrors.push({
        index: i,
        code: 'INVALID_DECIMALS',
        message: `Item at index ${i} has invalid decimal configuration.`,
      });
      continue;
    }

    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      itemResults.push({
        index: i,
        id: item.id,
        recipientId: item.recipientId,
        valid: false,
        computedTargetAmount: '0',
        expectedTargetAmount: item.expectedTargetAmount?.toString(),
        driftBps: 0,
        deltaAmount: '0',
        precisionLoss: false,
        error: {
          code: 'INVALID_EXCHANGE_RATE',
          message: `Item at index ${i} has invalid exchange rate: ${item.exchangeRate}`,
        },
      });
      reportErrors.push({
        index: i,
        code: 'INVALID_EXCHANGE_RATE',
        message: `Item at index ${i} has invalid exchange rate: ${item.exchangeRate}`,
      });
      continue;
    }

    // Compute target amount
    const computed = computeTargetPayoutAmount(
      item.sourceAmount,
      item.sourceDecimals,
      item.targetDecimals,
      item.exchangeRate,
      roundingMode
    );

    const computedVal = BigInt(computed.targetAmount);
    sumSource += BigInt(Math.floor(sourceNum));
    sumComputedTarget += computedVal;

    let itemValid = true;
    let itemError: { code: RoundingSafeguardErrorCode; message: string } | undefined;
    let driftBps = 0;
    let deltaAmount = '0';

    if (item.expectedTargetAmount !== undefined) {
      const expectedVal = BigInt(item.expectedTargetAmount.toString());
      sumExpectedTarget += expectedVal;

      const diff = computedVal > expectedVal ? computedVal - expectedVal : expectedVal - computedVal;
      deltaAmount = diff.toString();

      if (expectedVal > 0n) {
        driftBps = Number((diff * 10000n) / expectedVal);
      } else if (computedVal > 0n) {
        driftBps = 10000;
      }

      if (driftBps > maxObservedDriftBps) {
        maxObservedDriftBps = driftBps;
      }

      if (driftBps > maxItemDriftBps) {
        itemValid = false;
        itemError = {
          code: 'EXCESSIVE_DRIFT',
          message: `Item at index ${i} exceeds maximum drift threshold: observed ${driftBps} bps, limit is ${maxItemDriftBps} bps.`,
        };
        reportErrors.push({
          index: i,
          code: 'EXCESSIVE_DRIFT',
          message: itemError.message,
        });
      }
    } else {
      sumExpectedTarget += computedVal;
    }

    itemResults.push({
      index: i,
      id: item.id,
      recipientId: item.recipientId,
      valid: itemValid,
      computedTargetAmount: computed.targetAmount,
      expectedTargetAmount: item.expectedTargetAmount?.toString(),
      driftBps,
      deltaAmount,
      precisionLoss: computed.precisionLoss,
      error: itemError,
    });
  }

  // Check cumulative batch drift if expected amounts were provided
  let cumulativeDriftBps = 0;
  if (sumExpectedTarget > 0n) {
    const totalDiff =
      sumComputedTarget > sumExpectedTarget
        ? sumComputedTarget - sumExpectedTarget
        : sumExpectedTarget - sumComputedTarget;
    cumulativeDriftBps = Number((totalDiff * 10000n) / sumExpectedTarget);

    if (cumulativeDriftBps > maxBatchDriftBps) {
      reportErrors.push({
        code: 'CUMULATIVE_DRIFT_EXCEEDED',
        message: `Batch cumulative drift of ${cumulativeDriftBps} bps exceeds maximum allowed limit of ${maxBatchDriftBps} bps.`,
      });
    }
  }

  const passedCount = itemResults.filter((r) => r.valid).length;
  const overallValid = reportErrors.length === 0 && passedCount === items.length;

  return {
    valid: overallValid,
    totalItems: items.length,
    passedItems: passedCount,
    failedItems: items.length - passedCount,
    totalSourceAmount: sumSource.toString(),
    totalComputedTargetAmount: sumComputedTarget.toString(),
    totalExpectedTargetAmount: sumExpectedTarget.toString(),
    cumulativeDriftBps,
    maxObservedDriftBps,
    items: itemResults,
    errors: reportErrors,
  };
}
