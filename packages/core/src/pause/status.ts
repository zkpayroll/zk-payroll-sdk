/**
 * Pause status typing and normalization (Issue #374).
 *
 * Dashboards need to know which operation categories are currently paused
 * before attempting an action, so a disabled button can explain itself
 * instead of the user discovering the pause only after a failed contract
 * call. This module defines the typed shape and normalizes a raw contract
 * response into it — treating any category missing from the response as
 * `false` (not paused) rather than `undefined`, so UI code never has to
 * handle a third "unknown" boolean state per category.
 */

/** Operation categories the contract can pause independently. */
export type PauseCategory = "deposits" | "withdrawals" | "payroll" | "proofs" | "reservations";

export const PAUSE_CATEGORIES: readonly PauseCategory[] = [
  "deposits",
  "withdrawals",
  "payroll",
  "proofs",
  "reservations",
];

/** Normalized pause status, safe for direct UI consumption. */
export interface PauseStatus {
  /** `true` if every known category is paused. */
  globallyPaused: boolean;
  /** Per-category pause flags. Every entry in `PAUSE_CATEGORIES` is present. */
  categories: Record<PauseCategory, boolean>;
  /** Categories present in the raw response that aren't in `PAUSE_CATEGORIES` —
   * surfaced rather than silently dropped, in case the contract has added a
   * new pausable category this SDK version doesn't know about yet. */
  unknownCategories: string[];
}

/** Loosely-typed shape of the raw decoded contract response — a map from
 * category name to a boolean-ish value. Fields may be missing entirely if
 * the contract has never had that category paused. */
export type RawPauseStatusResponse = Record<string, boolean | undefined>;

/**
 * Normalize a raw pause-status response into a `PauseStatus`.
 *
 * Missing categories normalize to `false` (not paused) — the safer default,
 * since treating an absent field as "paused" would block legitimate actions
 * whenever the contract simply hasn't reported that category.
 */
export function normalizePauseStatus(raw: RawPauseStatusResponse | null | undefined): PauseStatus {
  const categories = {} as Record<PauseCategory, boolean>;
  for (const category of PAUSE_CATEGORIES) {
    categories[category] = Boolean(raw?.[category]);
  }

  const knownKeys = new Set<string>(PAUSE_CATEGORIES);
  const unknownCategories = raw ? Object.keys(raw).filter((key) => !knownKeys.has(key)) : [];

  const globallyPaused = PAUSE_CATEGORIES.every((category) => categories[category]);

  return { globallyPaused, categories, unknownCategories };
}
