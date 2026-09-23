/**
 * Settlement Receipt ID Validator
 *
 * Validates settlement receipt identifiers generated following payroll finalization
 * and on-chain contract settlement.
 *
 * ## Why This Matters
 * Receipt ID validation keeps audit screens, reconciliation pipelines, and settlement
 * views uniform and prevents malformed IDs from corrupting indexing pipelines.
 */

/**
 * Result of validating a settlement receipt identifier.
 */
export interface SettlementReceiptIdValidationResult {
  /** True if the receipt ID satisfies all length and character format rules */
  isValid: boolean;
  /** Detailed human-readable error description when invalid */
  error?: string;
  /** Specific machine-readable validation failure code */
  code?:
    | "EMPTY_INPUT"
    | "INVALID_TYPE"
    | "TOO_SHORT"
    | "TOO_LONG"
    | "INVALID_CHARACTERS"
    | "INVALID_FORMAT";
  /** Cleaned and trimmed receipt ID when valid */
  sanitizedReceiptId?: string;
}

/** Minimum allowed character length for a settlement receipt ID */
export const MIN_RECEIPT_ID_LENGTH = 8;

/** Maximum allowed character length for a settlement receipt ID */
export const MAX_RECEIPT_ID_LENGTH = 128;

/** Allowed characters: alphanumeric, hyphens, underscores, and dots */
const RECEIPT_ID_REGEX = /^[a-zA-Z0-9_.-]+$/;

/** Standard prefixes commonly used in ZK Payroll settlement receipts */
export const STANDARD_RECEIPT_PREFIXES = ["rcpt_", "settle_", "zkpay_"] as const;

/**
 * Redact a receipt ID to preserve privacy in external logs or public screens.
 * E.g. "rcpt_9876543210abcdef" -> "rcp***def"
 *
 * @param receiptId - Raw receipt ID.
 * @returns Masked identifier safe for logging.
 */
export function redactReceiptId(receiptId?: string): string {
  if (!receiptId || receiptId.trim().length === 0) {
    return "[ANONYMOUS_RECEIPT]";
  }
  const clean = receiptId.trim();
  if (clean.length <= 6) {
    return "[REDACTED_RECEIPT]";
  }
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Validate a settlement receipt identifier against format constraints.
 *
 * @param receiptId - Value to validate (expected string).
 * @returns `SettlementReceiptIdValidationResult` with isValid and error details.
 */
export function validateSettlementReceiptId(
  receiptId: unknown
): SettlementReceiptIdValidationResult {
  if (typeof receiptId !== "string") {
    return {
      isValid: false,
      code: "INVALID_TYPE",
      error: "Settlement receipt ID must be a string",
    };
  }

  const trimmed = receiptId.trim();
  if (trimmed.length === 0) {
    return {
      isValid: false,
      code: "EMPTY_INPUT",
      error: "Settlement receipt ID cannot be empty or whitespace",
    };
  }

  if (trimmed.length < MIN_RECEIPT_ID_LENGTH) {
    return {
      isValid: false,
      code: "TOO_SHORT",
      error: `Settlement receipt ID must be at least ${MIN_RECEIPT_ID_LENGTH} characters long (received ${trimmed.length})`,
    };
  }

  if (trimmed.length > MAX_RECEIPT_ID_LENGTH) {
    return {
      isValid: false,
      code: "TOO_LONG",
      error: `Settlement receipt ID cannot exceed ${MAX_RECEIPT_ID_LENGTH} characters (received ${trimmed.length})`,
    };
  }

  if (!RECEIPT_ID_REGEX.test(trimmed)) {
    return {
      isValid: false,
      code: "INVALID_CHARACTERS",
      error:
        "Settlement receipt ID must contain only alphanumeric characters, hyphens, underscores, or dots",
    };
  }

  // Prevent leading or trailing punctuation
  if (/^[._-]|[._-]$/.test(trimmed)) {
    return {
      isValid: false,
      code: "INVALID_FORMAT",
      error: "Settlement receipt ID cannot start or end with hyphens, underscores, or dots",
    };
  }

  return {
    isValid: true,
    sanitizedReceiptId: trimmed,
  };
}

/**
 * Assert that a settlement receipt ID is valid.
 * Throws an Error if invalid, returns the sanitized ID if valid.
 *
 * @param receiptId - Receipt ID to check.
 * @returns Cleaned receipt ID string.
 * @throws Error if validation fails.
 */
export function assertValidSettlementReceiptId(receiptId: unknown): string {
  const result = validateSettlementReceiptId(receiptId);
  if (!result.isValid) {
    throw new Error(`Invalid settlement receipt ID: ${result.error}`);
  }
  return result.sanitizedReceiptId!;
}

/**
 * Boolean predicate check whether a value is a valid settlement receipt ID.
 *
 * @param receiptId - Value to test.
 * @returns True if valid, false otherwise.
 */
export function isSettlementReceiptId(receiptId: unknown): receiptId is string {
  return validateSettlementReceiptId(receiptId).isValid;
}

/**
 * Format a human-readable display label for a settlement receipt ID.
 *
 * @param receiptId - Receipt ID.
 * @param options - Optional redaction flag.
 * @returns Formatted label string.
 */
export function formatSettlementReceiptLabel(
  receiptId: string,
  options: { redact?: boolean } = {}
): string {
  const displayId = options.redact ? redactReceiptId(receiptId) : receiptId;
  return `Receipt #${displayId}`;
}
