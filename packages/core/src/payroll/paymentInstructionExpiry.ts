/**
 * Payment Instruction Expiry Helper
 *
 * Validates payment instruction expiry status to ensure instructions are
 * still valid before processing. Checks expiry timestamps and provides
 * clear operational feedback without exposing sensitive payment values.
 *
 * ## Privacy & Security Guarantees
 * - Payment amounts and recipient details are never exposed in messages.
 * - Only non-sensitive metadata is included in error messages.
 */

/** A payment instruction entry to validate for expiry. */
export interface PaymentInstructionEntry {
  /** Unique identifier for the payment instruction. */
  instructionId?: string;
  /** Expiry timestamp (Unix milliseconds). */
  expiryTimestamp: number;
  /** Optional reference ID for logging. */
  referenceId?: string;
}

/** Payment instruction expiry violation codes. */
export type PaymentInstructionExpiryViolationCode =
  | "INSTRUCTION_EXPIRED"
  | "INVALID_EXPIRY_TIMESTAMP"
  | "NO_EXPIRY_SET"
  | "EXPIRY_IN_PAST";

/** Structured expiry violation descriptor. */
export interface PaymentInstructionExpiryViolation {
  code: PaymentInstructionExpiryViolationCode;
  instructionId?: string;
  redactedInstructionId: string;
  message: string;
  redactedMessage: string;
  expiryTimestamp?: number;
  timeUntilExpiry?: number;
}

/** Validation options. */
export interface PaymentInstructionExpiryOptions {
  /** Current timestamp to use for comparison. Defaults to Date.now(). */
  currentTime?: number;
  /** Grace period in milliseconds before expiry. Defaults to 0. */
  gracePeriod?: number;
  /** Whether to redact instruction IDs in messages. Defaults to true. */
  redactInstructionId?: boolean;
}

/** Result of validating payment instruction expiry. */
export interface PaymentInstructionExpiryResult {
  isValid: boolean;
  violation?: PaymentInstructionExpiryViolation;
  timeUntilExpiry?: number;
}

function redactInstrId(id?: string): string {
  if (!id || id.trim().length === 0) return "[NO_INSTRUCTION_ID]";
  const clean = id.trim();
  if (clean.length <= 4) return "[REDACTED_INSTRUCTION]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Validate a payment instruction's expiry status.
 */
export function validatePaymentInstructionExpiry(
  entry: PaymentInstructionEntry,
  options: PaymentInstructionExpiryOptions = {}
): PaymentInstructionExpiryResult {
  const {
    currentTime = Date.now(),
    gracePeriod = 0,
    redactInstructionId: shouldRedactId = true,
  } = options;

  const instrDisplay = entry.instructionId || "unknown";
  const instrRedacted = shouldRedactId
    ? redactInstrId(entry.instructionId)
    : instrDisplay;

  // Invalid expiry timestamp
  if (!Number.isFinite(entry.expiryTimestamp)) {
    return {
      isValid: false,
      violation: {
        code: "INVALID_EXPIRY_TIMESTAMP",
        instructionId: entry.instructionId,
        redactedInstructionId: instrRedacted,
        message: `Invalid expiry timestamp for instruction ${instrDisplay}.`,
        redactedMessage: `Invalid expiry timestamp for instruction ${instrRedacted}.`,
      },
    };
  }

  // Expiry in the past
  if (entry.expiryTimestamp <= 0) {
    return {
      isValid: false,
      violation: {
        code: "EXPIRY_IN_PAST",
        instructionId: entry.instructionId,
        redactedInstructionId: instrRedacted,
        message: `Expiry timestamp is in the past for instruction ${instrDisplay}.`,
        redactedMessage: `Expiry timestamp is in the past for instruction ${instrRedacted}.`,
      },
    };
  }

  // Check if instruction is expired (with grace period)
  const effectiveExpiry = entry.expiryTimestamp + gracePeriod;
  if (currentTime > effectiveExpiry) {
    const timeExpired = currentTime - entry.expiryTimestamp;
    return {
      isValid: false,
      violation: {
        code: "INSTRUCTION_EXPIRED",
        instructionId: entry.instructionId,
        redactedInstructionId: instrRedacted,
        message: `Payment instruction ${instrDisplay} expired ${timeExpired}ms ago.`,
        redactedMessage: `Payment instruction ${instrRedacted} has expired.`,
        expiryTimestamp: entry.expiryTimestamp,
        timeUntilExpiry: -timeExpired,
      },
    };
  }

  // Instruction is valid
  const timeUntilExpiry = effectiveExpiry - currentTime;
  return {
    isValid: true,
    timeUntilExpiry,
  };
}

/**
 * Validate multiple payment instructions' expiry status.
 */
export function validatePaymentInstructionExpiryBatch(
  entries: PaymentInstructionEntry[],
  options: PaymentInstructionExpiryOptions = {}
): Array<PaymentInstructionExpiryResult> {
  return entries.map((entry) => validatePaymentInstructionExpiry(entry, options));
}

/**
 * Quick check if a payment instruction is still valid.
 */
export function isPaymentInstructionValid(
  expiryTimestamp: number,
  currentTime: number = Date.now(),
  gracePeriod: number = 0
): boolean {
  return currentTime <= expiryTimestamp + gracePeriod && expiryTimestamp > 0;
}

/**
 * Get time remaining until a payment instruction expires.
 */
export function getTimeUntilPaymentInstructionExpiry(
  expiryTimestamp: number,
  currentTime: number = Date.now()
): number {
  return Math.max(0, expiryTimestamp - currentTime);
}
