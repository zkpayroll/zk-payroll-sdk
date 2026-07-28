import { BatchPaymentEntry } from "./BatchPayloadBuilder";

export type DeduplicationKey = keyof BatchPaymentEntry;

export interface DuplicateGroup {
  key: DeduplicationKey;
  value: string | bigint;
  indices: number[];
}

export interface DeduplicationResult {
  duplicates: DuplicateGroup[];
  hasDuplicates: boolean;
}

/**
 * Detects duplicate employee entries in a payroll batch using configurable identity keys.
 *
 * @param entries - The batch payment entries to check.
 * @param keys - The fields to use as identity keys for deduplication. Defaults to `["recipient"]`.
 * @returns A result object describing any duplicate groups found.
 *
 * @example
 * const result = detectDuplicates(entries, ["recipient"]);
 * if (result.hasDuplicates) {
 *   console.error(result.duplicates);
 * }
 */
export function detectDuplicates(
  entries: BatchPaymentEntry[],
  keys: DeduplicationKey[] = ["recipient"]
): DeduplicationResult {
  const duplicates: DuplicateGroup[] = [];

  for (const key of keys) {
    const seen = new Map<string, number[]>();

    for (let i = 0; i < entries.length; i++) {
      const raw = entries[i][key];
      const normalized = typeof raw === "bigint" ? raw.toString() : String(raw);
      const existing = seen.get(normalized);
      if (existing) {
        existing.push(i);
      } else {
        seen.set(normalized, [i]);
      }
    }

    for (const [normalized, indices] of seen) {
      if (indices.length > 1) {
        const raw = entries[indices[0]][key];
        duplicates.push({
          key,
          value: typeof raw === "bigint" ? raw : normalized,
          indices,
        });
      }
    }
  }

  return { duplicates, hasDuplicates: duplicates.length > 0 };
}
