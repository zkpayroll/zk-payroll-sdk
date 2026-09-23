/**
 * Treasury Reservation Memo Helpers
 *
 * Utilities for validating and formatting the optional `memo` field on
 * `ReserveRequest` / `FundingReservation` (see `./types`) before it is sent
 * to the contract or shown to a user.
 */

import { ValidationResult } from "../core/validation";

/** Maximum number of characters allowed in a reservation memo. */
export const MEMO_MAX_LENGTH = 100;

/** Maximum length of the truncated preview returned by `previewMemo`. */
export const MEMO_PREVIEW_LENGTH = 40;

/**
 * Characters allowed in a reservation memo: printable ASCII (space through
 * tilde). Control characters (including newlines and tabs) are rejected so
 * a memo can always be rendered safely on a single line in a UI or log.
 */
const MEMO_ALLOWED_PATTERN = /^[\x20-\x7E]*$/;

/**
 * Validates a reservation memo's length and character set.
 *
 * A missing/undefined memo is valid, since the field is optional.
 *
 * @param memo - The memo to validate, or undefined.
 * @returns A ValidationResult indicating if the memo is valid and listing any errors.
 */
export function validateMemo(memo?: string): ValidationResult {
  const errors: { field: string; message: string }[] = [];

  if (memo === undefined || memo === null) {
    return { isValid: true, errors };
  }

  if (memo.length > MEMO_MAX_LENGTH) {
    errors.push({
      field: "memo",
      message: `Memo must be at most ${MEMO_MAX_LENGTH} characters (got ${memo.length})`,
    });
  }

  if (!MEMO_ALLOWED_PATTERN.test(memo)) {
    errors.push({
      field: "memo",
      message: "Memo contains unsupported characters; only printable ASCII is allowed",
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Formats a memo for storage/transmission by trimming surrounding whitespace.
 *
 * Does not throw on invalid input — call `validateMemo` separately to check
 * length/character constraints.
 *
 * @param memo - The raw memo string, or undefined.
 * @returns The trimmed memo, or undefined if no memo was given (or it was blank).
 */
export function formatMemo(memo?: string): string | undefined {
  if (memo === undefined || memo === null) {
    return undefined;
  }
  const trimmed = memo.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Returns a display-safe, truncated preview of a memo, suitable for
 * rendering in constrained UI space (e.g. a table cell or notification).
 *
 * @param memo - The memo to preview, or undefined.
 * @returns The formatted memo truncated to `MEMO_PREVIEW_LENGTH` characters
 *   (with an ellipsis if truncated), or undefined if there is no memo.
 */
export function previewMemo(memo?: string): string | undefined {
  const formatted = formatMemo(memo);
  if (formatted === undefined) {
    return undefined;
  }
  if (formatted.length <= MEMO_PREVIEW_LENGTH) {
    return formatted;
  }
  return `${formatted.slice(0, MEMO_PREVIEW_LENGTH - 1)}…`;
}
