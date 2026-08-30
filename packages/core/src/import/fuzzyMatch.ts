/**
 * Normalization and fuzzy-matching helpers for import duplicate detection.
 *
 * All helpers are pure functions so clustering output is fully deterministic.
 */

/**
 * Normalizes an identifier-like string for comparison:
 * trims whitespace, collapses internal runs of whitespace, and lowercases.
 *
 * Returns null for empty/missing input.
 */
export function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Computes the Levenshtein edit distance between two strings.
 *
 * Uses a rolling single-row DP table with O(min) memory. Deterministic.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let previous: number[] = new Array(b.length + 1);
  let current: number[] = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    previous[j] = j;
  }

  for (let i = 0; i < a.length; i++) {
    current[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const substitutionCost = a[i] === b[j] ? 0 : 1;
      current[j + 1] = Math.min(
        previous[j + 1] + 1,
        current[j] + 1,
        previous[j] + substitutionCost
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length];
}

/**
 * Returns true when two names should be considered "similar".
 *
 * Names are normalized first; similarity means edit distance within the
 * given threshold or one normalized name fully containing the other
 * (catches "Bob" vs "Robert Bob Smith"-style truncations).
 */
export function namesAreSimilar(a: unknown, b: unknown, threshold: number): boolean {
  const na = normalizeIdentifier(a);
  const nb = normalizeIdentifier(b);
  if (na === null || nb === null) {
    return false;
  }
  if (na === nb) {
    return true;
  }
  if (Math.abs(na.length - nb.length) > threshold) {
    // Still allow containment matches despite large length gaps.
    return na.includes(nb) || nb.includes(na);
  }
  return levenshteinDistance(na, nb) <= threshold;
}
