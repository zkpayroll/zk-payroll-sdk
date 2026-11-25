/**
 * Payroll configuration version comparison.
 *
 * Helpers for ordering payroll configuration versions so integrators can tell
 * whether a new configuration supersedes the one already in use. Two version
 * forms are accepted:
 *
 * - a positive safe integer revision number, such as `3`, and
 * - a dotted numeric string of up to three segments, such as `"0.9"` or `"1.0.2"`.
 *
 * A bare integer `n` is treated as `n.0.0`, so `2` and `"2.0.0"` compare equal.
 *
 * ## Privacy & Security Guarantees
 * - Errors never echo the rejected value. They only describe the expected form.
 *
 * @module
 */

import { ValidationError } from "../core/errors";

/** Stable error code for a value that is not a configuration version. */
export const CONFIGURATION_VERSION_INVALID = "CONFIGURATION_VERSION_INVALID" as const;

/** Stable error code for a version that does not advance past its predecessor. */
export const CONFIGURATION_VERSION_NOT_ADVANCING = "CONFIGURATION_VERSION_NOT_ADVANCING" as const;

/** A payroll configuration version: a positive integer revision or a dotted numeric string. */
export type PayrollConfigurationVersion = number | string;

/** Result of {@link compareConfigurationVersions}: `-1` (a < b), `0` (equal), or `1` (a > b). */
export type ConfigurationVersionOrder = -1 | 0 | 1;

/** Up to three dot-separated numeric segments, each at most nine digits. */
const DOTTED_VERSION_PATTERN = /^\d{1,9}(\.\d{1,9}){0,2}$/;

/** Error thrown for malformed or non-advancing configuration versions. */
export class ConfigurationVersionError extends ValidationError {
  constructor(
    message: string,
    code: typeof CONFIGURATION_VERSION_INVALID | typeof CONFIGURATION_VERSION_NOT_ADVANCING
  ) {
    super(message, "version", code);
    this.name = "ConfigurationVersionError";
  }
}

type VersionSegments = readonly [number, number, number];

function parseConfigurationVersion(value: unknown): VersionSegments | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? [value, 0, 0] : null;
  }
  if (typeof value === "string" && DOTTED_VERSION_PATTERN.test(value)) {
    const [major, minor = "0", patch = "0"] = value.split(".");
    return [Number(major), Number(minor), Number(patch)];
  }
  return null;
}

/**
 * Whether a value is a configuration version this module can compare.
 *
 * Never throws.
 */
export function isValidConfigurationVersion(
  value: unknown
): value is PayrollConfigurationVersion {
  return parseConfigurationVersion(value) !== null;
}

/**
 * Compare two configuration versions.
 *
 * @returns `-1` when `a` is older than `b`, `0` when they are equal, `1` when `a` is newer.
 * @throws ConfigurationVersionError with `CONFIGURATION_VERSION_INVALID` when
 *   either input is not a valid configuration version.
 */
export function compareConfigurationVersions(
  a: PayrollConfigurationVersion,
  b: PayrollConfigurationVersion
): ConfigurationVersionOrder {
  const left = parseConfigurationVersion(a);
  const right = parseConfigurationVersion(b);
  if (!left || !right) {
    throw new ConfigurationVersionError(
      'Configuration version must be a positive integer or a dotted numeric string such as "1.0".',
      CONFIGURATION_VERSION_INVALID
    );
  }

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Whether `next` is strictly newer than `previous`.
 *
 * @throws ConfigurationVersionError when either input is not a valid version.
 */
export function isConfigurationVersionUpgrade(
  previous: PayrollConfigurationVersion,
  next: PayrollConfigurationVersion
): boolean {
  return compareConfigurationVersions(next, previous) === 1;
}

/**
 * Assert that `next` strictly advances past `previous`. Equal or older
 * versions are rejected so a configuration cannot silently replace itself or
 * roll back.
 *
 * @throws ConfigurationVersionError with `CONFIGURATION_VERSION_INVALID` for
 *   malformed input, or `CONFIGURATION_VERSION_NOT_ADVANCING` when `next` is
 *   not newer than `previous`.
 */
export function assertConfigurationVersionUpgrade(
  previous: PayrollConfigurationVersion,
  next: PayrollConfigurationVersion
): void {
  if (!isConfigurationVersionUpgrade(previous, next)) {
    throw new ConfigurationVersionError(
      "Configuration version must advance past the current version. Increment it before saving this configuration.",
      CONFIGURATION_VERSION_NOT_ADVANCING
    );
  }
}
