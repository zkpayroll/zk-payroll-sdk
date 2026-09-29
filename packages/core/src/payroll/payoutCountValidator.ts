/**
 * Payout Count Validator
 *
 * Validates the number of payout entries in a payroll batch against
 * configurable minimum/maximum count bounds before the batch is signed or
 * submitted. Catches empty batches and oversized batches that would exceed
 * the per-transaction payout budget, while keeping the failure actionable.
 *
 * ## Privacy & Security Guarantees
 * - Messages only ever contain aggregate counts (never salaries or amounts).
 * - Recipient identifiers are masked by default in user-facing messages.
 * - Raw recipient identifiers are only included when `redactRecipients`
 *   is explicitly set to `false` (e.g. for internal logs).
 */

/** Default minimum number of payouts required in a batch. */
export const DEFAULT_MIN_PAYOUT_COUNT = 1;

/**
 * Default maximum number of payouts allowed in a single batch.
 *
 * Kept aligned with `LARGE_DRAFT_THRESHOLD` in the draft builder so that a
 * batch accepted here is never flagged as oversized during submission.
 */
export const DEFAULT_MAX_PAYOUT_COUNT = 500;

/** A single payout entry to inspect for count validation. */
export interface PayoutCountEntry {
  /** Employee or recipient identifier (masked in messages by default). */
  employeeId?: string;
}

/** Payout count violation codes. */
export type PayoutCountViolationCode =
  | "EMPTY_PAYOUT_BATCH"
  | "BELOW_MIN_COUNT"
  | "ABOVE_MAX_COUNT"
  | "INVALID_COUNT_BOUNDS"
  | "INVALID_PAYOUT_COUNT";

/** Structured violation descriptor. */
export interface PayoutCountViolation {
  code: PayoutCountViolationCode;
  /** Observed number of payouts. */
  count: number;
  /** Inclusive lower bound that was applied. */
  minCount: number;
  /** Inclusive upper bound that was applied. */
  maxCount: number;
  /** Message safe for user-facing surfaces (aggregate counts only). */
  message: string;
  /** Alias of `message`, kept for parity with other validators. */
  redactedMessage: string;
  /** Payouts that must be added to satisfy `minCount`, when short. */
  missingCount?: number;
  /** Payouts that must be removed to satisfy `maxCount`, when over. */
  excessCount?: number;
  /**
   * Recipients beyond `maxCount` (masked when `redactRecipients` is true).
   * Only populated by {@link validatePayoutCountForEntries}.
   */
  offendingRecipients?: string[];
  /** Actionable remediation hint; never contains sensitive values. */
  suggestedFix: string;
}

/** Validation options. */
export interface PayoutCountValidatorOptions {
  /** Minimum number of payouts required. Defaults to 1. */
  minCount?: number;
  /** Maximum number of payouts allowed. Defaults to 500. */
  maxCount?: number;
  /** Mask recipient identifiers in messages. Defaults to true. */
  redactRecipients?: boolean;
}

/** Result of validating a payout count. */
export interface PayoutCountValidationResult {
  isValid: boolean;
  count: number;
  minCount: number;
  maxCount: number;
  violation?: PayoutCountViolation;
}

/**
 * Error thrown by {@link assertValidPayoutCount}. Carries the resolved bounds
 * and an actionable, privacy-preserving remediation hint.
 */
export class PayoutCountValidationError extends Error {
  readonly code: PayoutCountViolationCode;
  readonly count: number;
  readonly minCount: number;
  readonly maxCount: number;
  readonly suggestedFix: string;

  constructor(violation: PayoutCountViolation) {
    super(violation.redactedMessage);
    this.name = "PayoutCountValidationError";
    this.code = violation.code;
    this.count = violation.count;
    this.minCount = violation.minCount;
    this.maxCount = violation.maxCount;
    this.suggestedFix = violation.suggestedFix;
  }
}

/** Mask a recipient identifier so it stays safe to surface. */
function redactRecipientId(id?: string): string {
  if (!id || id.trim().length === 0) return "[ANONYMOUS_RECIPIENT]";
  const clean = id.trim();
  if (clean.length <= 4) return "[REDACTED_RECIPIENT]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

function resolveBounds(options: PayoutCountValidatorOptions): {
  minCount: number;
  maxCount: number;
} {
  return {
    minCount: options.minCount ?? DEFAULT_MIN_PAYOUT_COUNT,
    maxCount: options.maxCount ?? DEFAULT_MAX_PAYOUT_COUNT,
  };
}

/**
 * Validate the number of payouts in a batch against min/max bounds.
 *
 * Only the aggregate count is ever reported, so no employee identifier,
 * recipient address, or salary value can leak through the result.
 */
export function validatePayoutCount(
  count: number,
  options: PayoutCountValidatorOptions = {}
): PayoutCountValidationResult {
  const { minCount, maxCount } = resolveBounds(options);

  if (
    !Number.isInteger(minCount) ||
    !Number.isInteger(maxCount) ||
    minCount < 0 ||
    maxCount < 0 ||
    minCount > maxCount
  ) {
    const message =
      "Invalid payout count bounds: minCount and maxCount must be integers with 0 <= minCount <= maxCount.";
    return {
      isValid: false,
      count,
      minCount,
      maxCount,
      violation: {
        code: "INVALID_COUNT_BOUNDS",
        count,
        minCount,
        maxCount,
        message,
        redactedMessage: message,
        suggestedFix: "Provide integer bounds with 0 <= minCount <= maxCount.",
      },
    };
  }

  if (!Number.isInteger(count) || count < 0) {
    const message = "Invalid payout count: expected a non-negative integer.";
    return {
      isValid: false,
      count,
      minCount,
      maxCount,
      violation: {
        code: "INVALID_PAYOUT_COUNT",
        count,
        minCount,
        maxCount,
        message,
        redactedMessage: message,
        suggestedFix: "Provide a non-negative integer payout count.",
      },
    };
  }

  if (count < minCount) {
    const empty = count === 0;
    const missingCount = minCount - count;
    const code: PayoutCountViolationCode = empty ? "EMPTY_PAYOUT_BATCH" : "BELOW_MIN_COUNT";
    const message = empty
      ? `Payout batch is empty; at least ${minCount} payout(s) are required.`
      : `Payout batch has ${count} payout(s); at least ${minCount} are required.`;
    return {
      isValid: false,
      count,
      minCount,
      maxCount,
      violation: {
        code,
        count,
        minCount,
        maxCount,
        message,
        redactedMessage: message,
        missingCount,
        suggestedFix: `Add at least ${missingCount} more payout(s) before submitting.`,
      },
    };
  }

  if (count > maxCount) {
    const excessCount = count - maxCount;
    return {
      isValid: false,
      count,
      minCount,
      maxCount,
      violation: {
        code: "ABOVE_MAX_COUNT",
        count,
        minCount,
        maxCount,
        message: `Payout batch has ${count} payout(s); at most ${maxCount} are allowed.`,
        redactedMessage: `Payout batch has ${count} payout(s); at most ${maxCount} are allowed.`,
        excessCount,
        suggestedFix: `Remove or split out ${excessCount} payout(s); each batch may hold at most ${maxCount}.`,
      },
    };
  }

  return { isValid: true, count, minCount, maxCount };
}

/**
 * Validate the number of entries in a payout batch and, when the batch is too
 * large, list the offending recipients (masked by default).
 */
export function validatePayoutCountForEntries(
  entries: readonly PayoutCountEntry[],
  options: PayoutCountValidatorOptions = {}
): PayoutCountValidationResult {
  const result = validatePayoutCount(entries.length, options);
  if (result.isValid || !result.violation) return result;

  const { excessCount = 0 } = result.violation;
  if (excessCount <= 0) return result;

  const redact = options.redactRecipients ?? true;
  const offendingRecipients = entries
    .slice(result.maxCount)
    .map((entry) =>
      redact ? redactRecipientId(entry.employeeId) : (entry.employeeId ?? "[ANONYMOUS_RECIPIENT]")
    );

  return {
    ...result,
    violation: { ...result.violation, offendingRecipients },
  };
}

/**
 * Throw a {@link PayoutCountValidationError} when the payout count is outside
 * the configured bounds. Returns the resolved result when valid.
 */
export function assertValidPayoutCount(
  count: number,
  options: PayoutCountValidatorOptions = {}
): PayoutCountValidationResult {
  const result = validatePayoutCount(count, options);
  if (!result.isValid && result.violation) {
    throw new PayoutCountValidationError(result.violation);
  }
  return result;
}

/** Quick boolean check whether a payout count is within the configured bounds. */
export function isPayoutCountValid(
  count: number,
  options: PayoutCountValidatorOptions = {}
): boolean {
  return validatePayoutCount(count, options).isValid;
}
