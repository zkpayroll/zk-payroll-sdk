/**
 * Salary Commitment Scheme Version Validation (#850)
 *
 * Enforces cryptographic salary commitment scheme version checks in the SDK layer
 * prior to proof witness compilation or circuit synthesis.
 *
 * Rejects unsupported scheme versions fail-closed and guarantees that private
 * payroll data (salary amounts, recipient identifiers, blinding factors, and preimages)
 * are NEVER included in error messages, validation issues, or logs.
 *
 * @module
 */

import {
  SalaryCommitmentVersion,
  SUPPORTED_SALARY_COMMITMENT_VERSIONS,
  SalaryCommitmentVersionErrorCode,
  SalaryCommitmentVersionError,
  parseSalaryCommitmentVersion,
} from "./salaryCommitmentVersionState";
import {
  formatSafeSalaryCommitmentVersionIssue,
  SalaryCommitmentVersionValidationError,
} from "./salaryCommitmentVersionErrors";
import {
  SalaryCommitmentVersionValidationResult,
  validateSalaryCommitmentVersion,
} from "./salaryCommitmentVersionValidation";

/** Supported cryptographic primitive schemes for salary commitments. */
export type SalaryCommitmentScheme = "pedersen" | "poseidon" | "multi-asset-poseidon";

/** Alias for salary commitment scheme versions. */
export type SalaryCommitmentSchemeVersion = SalaryCommitmentVersion;

/** Information descriptor for a supported salary commitment scheme version. */
export interface SalaryCommitmentSchemeInfo {
  readonly version: SalaryCommitmentSchemeVersion;
  readonly scheme: SalaryCommitmentScheme;
  readonly primitive: string;
  readonly curveOrField: string;
  readonly hashFunction: string;
  readonly inputs: readonly string[];
}

/** Registry of supported schemes and their technical specifications. */
export const SALARY_COMMITMENT_SCHEMES: Readonly<
  Record<SalaryCommitmentSchemeVersion, SalaryCommitmentSchemeInfo>
> = Object.freeze({
  1: Object.freeze({
    version: 1 as const,
    scheme: "pedersen" as const,
    primitive: "Pedersen Commitment",
    curveOrField: "BabyJubjub / BN254",
    hashFunction: "Pedersen / EC Point",
    inputs: Object.freeze(["salary", "blinder"]),
  }),
  2: Object.freeze({
    version: 2 as const,
    scheme: "poseidon" as const,
    primitive: "Poseidon Bound Commitment",
    curveOrField: "BN254 Scalar Field",
    hashFunction: "Poseidon (rate=3)",
    inputs: Object.freeze(["salary", "blinder", "employeeId", "version"]),
  }),
  3: Object.freeze({
    version: 3 as const,
    scheme: "multi-asset-poseidon" as const,
    primitive: "Multi-Asset Poseidon",
    curveOrField: "BN254 Scalar Field",
    hashFunction: "Poseidon (rate=5)",
    inputs: Object.freeze(["amount", "assetTag", "blinder", "employeeId", "scheduleHash"]),
  }),
});

export const SUPPORTED_SALARY_COMMITMENT_SCHEME_VERSIONS: readonly SalaryCommitmentSchemeVersion[] =
  SUPPORTED_SALARY_COMMITMENT_VERSIONS;

export const SUPPORTED_SALARY_COMMITMENT_SCHEMES: readonly SalaryCommitmentScheme[] = Object.freeze(
  ["pedersen", "poseidon", "multi-asset-poseidon"]
);

/**
 * Checks whether a given value is a supported salary commitment scheme version (1, 2, or 3).
 */
export function isSupportedSalaryCommitmentSchemeVersion(
  value: unknown
): value is SalaryCommitmentSchemeVersion {
  if (typeof value === "number" && Number.isInteger(value)) {
    return (SUPPORTED_SALARY_COMMITMENT_SCHEME_VERSIONS as readonly number[]).includes(value);
  }
  return false;
}

/**
 * Checks whether a string identifies a supported salary commitment scheme primitive.
 */
export function isSupportedSalaryCommitmentScheme(
  value: unknown
): value is SalaryCommitmentScheme {
  return (
    typeof value === "string" &&
    (SUPPORTED_SALARY_COMMITMENT_SCHEMES as readonly string[]).includes(value.toLowerCase().trim())
  );
}

/**
 * Retrieves specification metadata for a supported salary commitment scheme version.
 *
 * @throws {SalaryCommitmentVersionError} if version is unsupported.
 */
export function getSalaryCommitmentSchemeInfo(
  version: unknown
): SalaryCommitmentSchemeInfo {
  let parsed: SalaryCommitmentSchemeVersion;
  try {
    parsed = parseSalaryCommitmentVersion(version);
  } catch {
    throw new SalaryCommitmentVersionError(
      "Unsupported salary commitment scheme version. Supported scheme versions are 1 (Pedersen), 2 (Poseidon), and 3 (Multi-Asset Poseidon).",
      SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION,
      { field: "schemeVersion" }
    );
  }
  return SALARY_COMMITMENT_SCHEMES[parsed];
}

/**
 * Validates a salary commitment scheme version input.
 * Accepts numeric versions (1, 2, 3) or string versions ("v1", "v2", "v3", "1", "2", "3").
 * Returns a discriminated result object.
 */
export function validateSalaryCommitmentSchemeVersion(
  value: unknown,
  expected?: SalaryCommitmentSchemeVersion,
  field: string = "schemeVersion"
): SalaryCommitmentVersionValidationResult {
  return validateSalaryCommitmentVersion(value, expected, field);
}

/**
 * Asserts that a salary commitment scheme version is valid and supported.
 *
 * @param value - The scheme version header to validate
 * @param expected - Optional expected version constraint
 * @param field - Context field name for reporting (defaults to "schemeVersion")
 * @returns The validated SalaryCommitmentSchemeVersion (1, 2, or 3)
 * @throws {SalaryCommitmentVersionValidationError} if the version is missing, malformed, unsupported, or mismatched.
 */
export function assertSupportedSalaryCommitmentSchemeVersion(
  value: unknown,
  expected?: SalaryCommitmentSchemeVersion,
  field: string = "schemeVersion"
): SalaryCommitmentSchemeVersion {
  const result = validateSalaryCommitmentSchemeVersion(value, expected, field);
  if (!result.ok) {
    throw new SalaryCommitmentVersionValidationError(result.issues, {
      field,
      expectedVersion: expected,
    });
  }
  return result.version;
}
