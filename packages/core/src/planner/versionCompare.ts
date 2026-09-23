/**
 * Minimal semantic-version comparison for the contract readiness check.
 *
 * Only the `major.minor.patch` numeric core is compared — pre-release and
 * build metadata suffixes are ignored, which is sufficient for comparing
 * deployed contract versions against a supported range.
 *
 * @module
 */

/** Parses a `major.minor.patch` version string into its numeric parts. */
function parseVersion(version: string): [number, number, number] {
  const core = version.split(/[-+]/, 1)[0];
  const parts = core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Compares two version strings.
 *
 * @returns `-1` when `a` < `b`, `0` when equal, `1` when `a` > `b`.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

/** Returns `true` when `version` falls within `[minVersion, maxVersion]` inclusive. */
export function isVersionInRange(version: string, minVersion: string, maxVersion: string): boolean {
  return compareVersions(version, minVersion) >= 0 && compareVersions(version, maxVersion) <= 0;
}
