/**
 * Transaction Hash Normalization for Receipt Helpers (#991)
 *
 * Normalizes transaction hashes across receipt helpers to guarantee consistent
 * format (lowercase 64-character hex strings), strip optional 0x/0X prefixes,
 * and validate integrity without leaking any sensitive payroll information.
 *
 * ## Privacy & Security Guarantees
 * - Error messages and diagnostics never contain salary, employee, proof,
 *   or payment amounts.
 * - Throws sanitized, predictable validation errors.
 */

/**
 * Regex matching standard 64-character hexadecimal hashes (with optional 0x/0X prefix).
 */
const TX_HASH_FLEX_RE = /^(?:0[xX])?([a-fA-F0-9]{64})$/;

/**
 * Options for formatting normalized transaction hashes.
 */
export interface FormatTransactionHashOptions {
  /** Whether to prepend standard '0x' prefix @default false */
  prefix0x?: boolean;
  /** Whether to format hex digits in uppercase @default false */
  uppercase?: boolean;
}

/**
 * Validates whether an arbitrary input is a valid Stellar/Soroban transaction hash.
 *
 * Accepts:
 * - 64-character hexadecimal strings (case-insensitive)
 * - 66-character hexadecimal strings with '0x' or '0X' prefix
 *
 * @param input - Value to check
 * @returns True if valid transaction hash format, false otherwise
 */
export function isValidTransactionHash(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const trimmed = input.trim();
  return TX_HASH_FLEX_RE.test(trimmed);
}

/**
 * Safely normalizes an input into a standard 64-character lowercase hex transaction hash.
 * Returns null if the input is missing or malformed.
 *
 * @param input - Hash string or unknown value
 * @returns Standard 64-char lowercase hex string, or null if invalid
 *
 * @example
 * ```ts
 * safeNormalizeTransactionHash("0xABCD...1234"); // "abcd...1234"
 * safeNormalizeTransactionHash("invalid"); // null
 * ```
 */
export function safeNormalizeTransactionHash(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const match = TX_HASH_FLEX_RE.exec(trimmed);
  if (!match || !match[1]) return null;
  return match[1].toLowerCase();
}

/**
 * Normalizes a transaction hash into a standard 64-character lowercase hex string (#991).
 *
 * Strips whitespace, removes optional '0x'/'0X' prefix, lowercases hex digits,
 * and asserts that the resulting string is exactly 64 hexadecimal characters.
 *
 * @param input - The raw transaction hash to normalize
 * @returns Standardized 64-character lowercase hexadecimal hash string
 * @throws TypeError when input is not a string or has invalid format
 *
 * @example
 * ```ts
 * normalizeTransactionHash("0xABCD...64chars..."); // "abcd...64chars..."
 * ```
 */
export function normalizeTransactionHash(input: unknown): string {
  if (typeof input !== "string") {
    throw new TypeError(
      `Invalid transaction hash: expected string, received ${typeof input}.`
    );
  }
  const normalized = safeNormalizeTransactionHash(input);
  if (!normalized) {
    throw new TypeError(
      "Invalid transaction hash format: expected 64 hexadecimal characters (with optional 0x prefix)."
    );
  }
  return normalized;
}

/**
 * Formats a valid transaction hash with custom styling options (e.g. 0x prefix or uppercase).
 *
 * @param input - The transaction hash to format
 * @param options - Formatting options
 * @returns Formatted hash string
 */
export function formatTransactionHash(
  input: string,
  options: FormatTransactionHashOptions = {}
): string {
  const normalized = normalizeTransactionHash(input);
  let hex = options.uppercase ? normalized.toUpperCase() : normalized;
  if (options.prefix0x) {
    hex = `0x${hex}`;
  }
  return hex;
}
