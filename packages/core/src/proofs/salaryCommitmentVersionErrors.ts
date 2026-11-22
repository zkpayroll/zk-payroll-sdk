import {
  SalaryCommitmentVersionError,
  SalaryCommitmentVersionErrorCode,
} from "./salaryCommitmentVersionState";

export const SalaryCommitmentVersionIssueCode = {
  HEADER_MISSING: "HEADER_MISSING",
  TYPE_INVALID: "TYPE_INVALID",
  UNSUPPORTED: "UNSUPPORTED",
  MISMATCH: "MISMATCH",
} as const;

export type SalaryCommitmentVersionIssueCode =
  (typeof SalaryCommitmentVersionIssueCode)[keyof typeof SalaryCommitmentVersionIssueCode];

export interface SafeSalaryCommitmentVersionIssue {
  readonly code: SalaryCommitmentVersionIssueCode;
  readonly field: string;
  readonly message: string;
}

export const SALARY_COMMITMENT_VERSION_ISSUE_ERROR_CODE: Readonly<
  Record<SalaryCommitmentVersionIssueCode, SalaryCommitmentVersionErrorCode>
> = Object.freeze({
  HEADER_MISSING: SalaryCommitmentVersionErrorCode.VERSION_HEADER_MISSING,
  TYPE_INVALID: SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION,
  UNSUPPORTED: SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION,
  MISMATCH: SalaryCommitmentVersionErrorCode.VERSION_MISMATCH,
});

const SAFE_MESSAGES: Readonly<Record<SalaryCommitmentVersionIssueCode, string>> = Object.freeze({
  HEADER_MISSING:
    "The salary commitment version header is missing. Read it from the active snapshot before compiling the witness.",
  TYPE_INVALID:
    "The salary commitment version header must be an integer or a V1, V2, or V3 string header.",
  UNSUPPORTED:
    "Unsupported salary commitment version. Use a supported V1, V2, or V3 version header before proof witness compilation.",
  MISMATCH:
    "The salary commitment version header does not match the active snapshot. Reload the snapshot before compiling the witness.",
});

export function formatSafeSalaryCommitmentVersionIssue(
  code: SalaryCommitmentVersionIssueCode,
  field: string
): SafeSalaryCommitmentVersionIssue {
  return Object.freeze({ code, field, message: SAFE_MESSAGES[code] });
}

export class SalaryCommitmentVersionValidationError extends SalaryCommitmentVersionError {
  public readonly issues: readonly SafeSalaryCommitmentVersionIssue[];

  constructor(
    issues: readonly SafeSalaryCommitmentVersionIssue[],
    context: Record<string, unknown> = {}
  ) {
    const first = issues[0];
    const code = first
      ? SALARY_COMMITMENT_VERSION_ISSUE_ERROR_CODE[first.code]
      : SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION;
    super(first ? first.message : SAFE_MESSAGES.UNSUPPORTED, code, {
      field: first?.field ?? "commitmentVersion",
      ...context,
    });
    this.name = "SalaryCommitmentVersionValidationError";
    this.issues = Object.freeze([...issues]);
  }
}
