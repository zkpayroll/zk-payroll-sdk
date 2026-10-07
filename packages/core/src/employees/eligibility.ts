/**
 * Employee payroll eligibility status evaluation (#612).
 *
 * Combines an employee's lifecycle status ({@link EmployeeStatus}, from
 * `./lifecycle`) with any applicable compliance holds (`../compliance`) into
 * a single categorical {@link EligibilityStatus}, with clear, privacy-safe
 * reasons a dashboard or backend integrator can act on.
 *
 * This does not duplicate the compliance module's blocking logic -- it calls
 * {@link isPayrollActionBlocked} directly and layers lifecycle state and a
 * "released hold" advisory on top of it.
 */

import { isPayrollActionBlocked } from "../compliance/PayrollBlockChecker";
import type { ComplianceHold } from "../compliance/types";
import { EmployeeEligibilityValidationError } from "./errors";
import type { EmployeeStatus } from "./lifecycle";
import type {
  EligibilityReason,
  EmployeeEligibilityInput,
  EmployeeEligibilityStatusResult,
} from "./eligibilityTypes";

export type {
  EligibilityStatus,
  EligibilityReasonCode,
  EligibilityReason,
  EmployeeEligibilityInput,
  EmployeeEligibilityStatusResult,
} from "./eligibilityTypes";
export { ELIGIBILITY_STATUS_LABELS, describeEligibilityStatus } from "./eligibilityTypes";

const VALID_STATUSES: readonly EmployeeStatus[] = ["active", "suspended", "offboarded"];

/** A single validation problem found on an {@link EmployeeEligibilityInput}. */
export interface EligibilityValidationIssue {
  field: string;
  message: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Validates an {@link EmployeeEligibilityInput} without throwing. Returns an
 * array of issues; an empty array means the input is valid.
 */
export function validateEmployeeEligibilityInput(
  input: EmployeeEligibilityInput
): EligibilityValidationIssue[] {
  const issues: EligibilityValidationIssue[] = [];

  if (!isNonEmptyString(input.employeeAddress)) {
    issues.push({
      field: "employeeAddress",
      message: "employeeAddress is required to evaluate eligibility.",
    });
  }

  if (!VALID_STATUSES.includes(input.status)) {
    issues.push({
      field: "status",
      message: `status must be one of: ${VALID_STATUSES.join(", ")}.`,
    });
  }

  if (input.complianceHolds !== undefined && !isNonEmptyString(input.employerId)) {
    issues.push({
      field: "employerId",
      message: "employerId is required when complianceHolds is provided, to scope the check.",
    });
  }

  return issues;
}

/**
 * Asserts that an {@link EmployeeEligibilityInput} is valid.
 *
 * @throws {EmployeeEligibilityValidationError} If the input fails validation.
 */
export function assertValidEmployeeEligibilityInput(input: EmployeeEligibilityInput): void {
  const issues = validateEmployeeEligibilityInput(input);
  if (issues.length > 0) {
    throw new EmployeeEligibilityValidationError(
      `Employee eligibility input failed validation with ${issues.length} error(s): ${issues[0].message}`,
      issues[0].field,
      { issues }
    );
  }
}

/** Finds a released compliance hold scoped specifically to this employee, if any. */
function findReleasedEmployeeHold(
  employeeAddress: string,
  holds: readonly ComplianceHold[]
): ComplianceHold | undefined {
  return holds.find(
    (h) =>
      h.target.scope === "employee" && h.target.id === employeeAddress && h.state === "released"
  );
}

/**
 * Evaluates an employee's payroll eligibility status by combining their
 * lifecycle status with any applicable compliance holds.
 *
 * Evaluation order (first match wins):
 * 1. `offboarded` / `suspended` lifecycle status -- always `ineligible`,
 *    since resuming payroll requires an explicit reactivation decision.
 * 2. An actively enforced compliance hold (or one whose status could not be
 *    determined) -- `ineligible`, or `pending` when the hold's status is
 *    `"unknown"` (fails closed, but the block is expected to resolve once
 *    the hold status is confirmed rather than needing a data fix).
 * 3. A released compliance hold on record for the employee -- `conditional`,
 *    surfaced for dashboard visibility but not blocking.
 * 4. Otherwise -- `eligible`.
 *
 * @throws {EmployeeEligibilityValidationError} If the input fails validation.
 */
export function evaluateEmployeeEligibilityStatus(
  input: EmployeeEligibilityInput
): EmployeeEligibilityStatusResult {
  assertValidEmployeeEligibilityInput(input);

  const { employeeAddress, status, complianceHolds, employerId } = input;

  if (status === "offboarded") {
    return {
      employeeAddress,
      status: "ineligible",
      reasons: [
        {
          code: "EMPLOYEE_OFFBOARDED",
          message: "Employee has been offboarded and cannot be included in a payroll run.",
        },
      ],
    };
  }

  if (status === "suspended") {
    return {
      employeeAddress,
      status: "ineligible",
      reasons: [
        {
          code: "EMPLOYEE_SUSPENDED",
          message: "Employee is suspended and must be reactivated before payroll can resume.",
        },
      ],
    };
  }

  if (complianceHolds && employerId) {
    const holdCheck = isPayrollActionBlocked(
      { employer: employerId, employee: employeeAddress },
      complianceHolds
    );

    if (holdCheck.blocked) {
      const isIndeterminate = holdCheck.hold?.state === "unknown";
      const reason: EligibilityReason = {
        code: isIndeterminate ? "COMPLIANCE_HOLD_STATUS_UNKNOWN" : "COMPLIANCE_HOLD_ACTIVE",
        message: holdCheck.explanation,
      };
      return {
        employeeAddress,
        status: isIndeterminate ? "pending" : "ineligible",
        reasons: [reason],
      };
    }

    const releasedHold = findReleasedEmployeeHold(employeeAddress, complianceHolds);
    if (releasedHold) {
      return {
        employeeAddress,
        status: "conditional",
        reasons: [
          {
            code: "COMPLIANCE_HOLD_RELEASED",
            message: `Employee has a released compliance hold on record (hold ${releasedHold.holdId}). This no longer blocks payroll but is worth reviewing.`,
          },
        ],
      };
    }
  }

  return {
    employeeAddress,
    status: "eligible",
    reasons: [
      {
        code: "EMPLOYEE_ACTIVE",
        message: "Employee is active with no blocking compliance hold.",
      },
    ],
  };
}

/** Convenience helper returning just the categorical status. */
export function getEmployeeEligibilityStatus(
  input: EmployeeEligibilityInput
): EmployeeEligibilityStatusResult["status"] {
  return evaluateEmployeeEligibilityStatus(input).status;
}
