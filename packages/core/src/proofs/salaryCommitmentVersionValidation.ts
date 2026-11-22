import {
  SalaryCommitmentVersion,
  parseSalaryCommitmentVersion,
} from "./salaryCommitmentVersionState";
import {
  SafeSalaryCommitmentVersionIssue,
  SalaryCommitmentVersionIssueCode,
  SalaryCommitmentVersionValidationError,
  formatSafeSalaryCommitmentVersionIssue,
} from "./salaryCommitmentVersionErrors";

export type SalaryCommitmentVersionValidationResult =
  | { readonly ok: true; readonly version: SalaryCommitmentVersion; readonly issues: readonly [] }
  | {
      readonly ok: false;
      readonly version?: undefined;
      readonly issues: readonly SafeSalaryCommitmentVersionIssue[];
    };

function invalid(
  code: SalaryCommitmentVersionIssueCode,
  field: string
): SalaryCommitmentVersionValidationResult {
  return {
    ok: false,
    issues: Object.freeze([formatSafeSalaryCommitmentVersionIssue(code, field)]),
  };
}

function issue(
  code: SalaryCommitmentVersionIssueCode,
  field: string
): SafeSalaryCommitmentVersionIssue {
  return formatSafeSalaryCommitmentVersionIssue(code, field);
}

export function validateSalaryCommitmentVersion(
  value: unknown,
  expected?: SalaryCommitmentVersion,
  field: string = "commitmentVersion"
): SalaryCommitmentVersionValidationResult {
  if (value === undefined || value === null) {
    return invalid("HEADER_MISSING", field);
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return invalid("TYPE_INVALID", field);
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    return invalid("TYPE_INVALID", field);
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return invalid("HEADER_MISSING", field);
  }

  let version: SalaryCommitmentVersion;
  try {
    version = parseSalaryCommitmentVersion(value);
  } catch {
    return invalid("UNSUPPORTED", field);
  }

  if (expected !== undefined && version !== expected) {
    return {
      ok: false,
      issues: Object.freeze([issue("MISMATCH", field)]),
    };
  }

  return { ok: true, version, issues: Object.freeze([]) };
}

export function validateWitnessCommitmentVersion(
  witness: unknown,
  expected?: SalaryCommitmentVersion
): SalaryCommitmentVersionValidationResult {
  if (!witness || typeof witness !== "object" || Array.isArray(witness)) {
    return invalid("HEADER_MISSING", "witness");
  }
  if (!Object.prototype.hasOwnProperty.call(witness, "commitmentVersion")) {
    return invalid("HEADER_MISSING", "commitmentVersion");
  }
  return validateSalaryCommitmentVersion(
    (witness as Record<string, unknown>).commitmentVersion,
    expected
  );
}

export function assertValidSalaryCommitmentVersion(
  value: unknown,
  expected?: SalaryCommitmentVersion,
  field: string = "commitmentVersion"
): SalaryCommitmentVersion {
  const result = validateSalaryCommitmentVersion(value, expected, field);
  if (!result.ok) {
    throw new SalaryCommitmentVersionValidationError(result.issues, {
      field,
      expectedVersion: expected,
    });
  }
  return result.version;
}

export function assertValidWitnessCommitmentVersion(
  witness: unknown,
  expected?: SalaryCommitmentVersion
): SalaryCommitmentVersion {
  const result = validateWitnessCommitmentVersion(witness, expected);
  if (!result.ok) {
    throw new SalaryCommitmentVersionValidationError(result.issues, {
      field: "commitmentVersion",
      expectedVersion: expected,
    });
  }
  return result.version;
}
