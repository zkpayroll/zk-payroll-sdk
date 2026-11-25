/**
 * Duplicate Recipient Position Detection (#831)
 *
 * Payout builders must reject a recipient that appears at more than one
 * position in the same batch. Paying the same address twice can double a
 * salary, silently inflate treasury reservations, and make reconciliation
 * reports disagree with the intended payroll.
 *
 * The comparison is performed on the *canonical* recipient value: surrounding
 * whitespace is stripped before comparing. Without this, `" GABC... "` and
 * `"GABC..."` — the same address as far as the network is concerned — would
 * pass a raw string comparison and occupy two payment positions.
 *
 * Error output contains positions only. Recipient addresses are never echoed,
 * so a validation failure cannot be used to enumerate payroll recipients.
 *
 * @module
 */

/** Minimal shape required to inspect recipient positions. */
export interface RecipientPositionEntry {
  /** Recipient address recorded for this payment position. */
  readonly recipient?: unknown;
}

/** A recipient that occupies more than one position in a payout batch. */
export interface DuplicateRecipientPosition {
  /**
   * Canonical (trimmed) recipient value shared by every reported position.
   *
   * Exposed for programmatic handling only. Do not render it in operator-facing
   * error messages; use {@link formatDuplicateRecipientPositions} instead.
   */
  readonly normalizedRecipient: string;
  /** First position at which the recipient appears. */
  readonly firstPosition: number;
  /** Every position after the first that repeats the same recipient. */
  readonly duplicatePositions: readonly number[];
  /** All positions occupied by the recipient, in ascending order. */
  readonly positions: readonly number[];
}

function assertValidPositionLimit(entries: readonly RecipientPositionEntry[], index: number): void {
  if (!entries[index]) {
    throw new Error(`Duplicate recipient scan lost entry at position ${index}; input must be stable.`);
  }
}

/**
 * Canonicalise a recipient value for position comparison.
 *
 * @param recipient - Raw recipient value from a payout entry.
 * @returns The trimmed recipient, or `null` when the value is not a usable
 *          recipient (non-string or blank). Blank recipients are reported by
 *          the existing `INVALID_RECIPIENT` checks, not as duplicates.
 */
export function normalizeRecipientPosition(recipient: unknown): string | null {
  if (typeof recipient !== "string") return null;
  const trimmed = recipient.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Finds every recipient that occupies more than one position in a payout
 * batch, comparing canonical (trimmed) recipient values.
 *
 * Positions are 0-based and always refer to the **input** array, so callers
 * can report errors against the exact order the operator committed.
 *
 * @param entries - Payout entries to scan.
 * @returns One group per duplicated recipient, ordered by first appearance.
 *
 * @example
 * const duplicates = findDuplicateRecipientPositions([
 *   { recipient: "GABC..." },
 *   { recipient: "GDEF..." },
 *   { recipient: " GABC... " },
 * ]);
 * // duplicates[0].positions => [0, 2]
 */
export function findDuplicateRecipientPositions(
  entries: readonly RecipientPositionEntry[]
): DuplicateRecipientPosition[] {
  if (!Array.isArray(entries)) {
    throw new Error("Duplicate recipient scan requires an array of payout entries.");
  }

  const keyToPositions = new Map<string, number[]>();

  for (let index = 0; index < entries.length; index++) {
    assertValidPositionLimit(entries, index);
    const normalized = normalizeRecipientPosition(entries[index].recipient);
    if (normalized === null) continue;

    const positions = keyToPositions.get(normalized);
    if (positions) {
      positions.push(index);
    } else {
      keyToPositions.set(normalized, [index]);
    }
  }

  const duplicates: DuplicateRecipientPosition[] = [];
  for (const [normalizedRecipient, positions] of keyToPositions) {
    if (positions.length < 2) continue;
    duplicates.push({
      normalizedRecipient,
      firstPosition: positions[0],
      duplicatePositions: positions.slice(1),
      positions,
    });
  }

  return duplicates;
}

/**
 * Formats a duplicate group as a privacy-safe, actionable message.
 *
 * @param duplicate - Group returned by {@link findDuplicateRecipientPositions}.
 * @returns Message naming positions only, never the recipient address.
 */
export function formatDuplicateRecipientPositionMessage(
  duplicate: DuplicateRecipientPosition
): string {
  return `Duplicate recipient at positions ${duplicate.positions.join(", ")}. Each recipient may occupy only one payout position; remove the repeated entry or merge the amounts.`;
}
