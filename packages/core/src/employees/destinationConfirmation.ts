/**
 * Employee Payment Destination Confirmation (#698).
 *
 * Implements pure SDK-layer validation and confirmation matching for employee
 * payment destinations, ensuring payouts are only dispatched to valid, verified,
 * and matched Stellar addresses.
 */

import { StrKey } from "@stellar/stellar-sdk";

export type PaymentDestinationStatus = "confirmed" | "unconfirmed" | "mismatch" | "invalid";

export interface EmployeeDestinationItem {
  readonly employeeId: string;
  readonly expectedAddress: string;
  readonly proposedAddress?: string;
  readonly memo?: string;
  readonly isVerified?: boolean;
}

export interface DestinationConfirmationIssue {
  readonly code:
    | "EMPTY_EMPLOYEE_ID"
    | "INVALID_EXPECTED_ADDRESS"
    | "INVALID_PROPOSED_ADDRESS"
    | "DESTINATION_MISMATCH"
    | "DESTINATION_UNVERIFIED";
  readonly employeeId: string;
  readonly message: string;
}

export interface EmployeeDestinationCheckResult {
  readonly employeeId: string;
  readonly status: PaymentDestinationStatus;
  readonly confirmedAddress?: string;
  readonly issues: readonly DestinationConfirmationIssue[];
}

export interface BatchDestinationConfirmationInput {
  readonly destinations: readonly EmployeeDestinationItem[];
  /** If true, requires item.isVerified to be explicitly true (default: false) */
  readonly requireVerified?: boolean;
}

export interface BatchDestinationConfirmationResult {
  readonly allConfirmed: boolean;
  readonly results: readonly EmployeeDestinationCheckResult[];
  readonly confirmedCount: number;
  readonly failureCount: number;
  readonly allIssues: readonly DestinationConfirmationIssue[];
}

export class DestinationConfirmationError extends Error {
  readonly code = "DESTINATION_CONFIRMATION_FAILED";
  readonly issues: readonly DestinationConfirmationIssue[];

  constructor(message: string, issues: readonly DestinationConfirmationIssue[]) {
    super(message);
    this.name = "DestinationConfirmationError";
    this.issues = issues;
  }
}

function isValidStellarAddress(addr: string): boolean {
  if (!addr || typeof addr !== "string") return false;
  return StrKey.isValidEd25519PublicKey(addr) || StrKey.isValidMed25519PublicKey(addr);
}

/**
 * Validates and confirms an individual employee's payment destination.
 */
export function confirmEmployeeDestination(
  item: EmployeeDestinationItem,
  options?: { requireVerified?: boolean }
): EmployeeDestinationCheckResult {
  const issues: DestinationConfirmationIssue[] = [];
  const employeeId = item.employeeId?.trim() || "";

  if (!employeeId) {
    issues.push({
      code: "EMPTY_EMPLOYEE_ID",
      employeeId: "",
      message: "Employee ID is required",
    });
  }

  const expectedValid = isValidStellarAddress(item.expectedAddress);
  if (!expectedValid) {
    issues.push({
      code: "INVALID_EXPECTED_ADDRESS",
      employeeId,
      message: "Expected payment destination is not a valid Stellar address",
    });
  }

  const proposed = item.proposedAddress?.trim();
  if (proposed !== undefined) {
    if (!isValidStellarAddress(proposed)) {
      issues.push({
        code: "INVALID_PROPOSED_ADDRESS",
        employeeId,
        message: "Proposed payment destination is not a valid Stellar address",
      });
    } else if (expectedValid && proposed !== item.expectedAddress) {
      issues.push({
        code: "DESTINATION_MISMATCH",
        employeeId,
        message: "Proposed destination does not match registered employee address",
      });
    }
  }

  if (options?.requireVerified && !item.isVerified) {
    issues.push({
      code: "DESTINATION_UNVERIFIED",
      employeeId,
      message: "Employee payment destination has not completed verification",
    });
  }

  let status: PaymentDestinationStatus = "confirmed";
  if (issues.some((i) => i.code === "DESTINATION_MISMATCH")) {
    status = "mismatch";
  } else if (
    issues.some(
      (i) =>
        i.code === "INVALID_EXPECTED_ADDRESS" ||
        i.code === "INVALID_PROPOSED_ADDRESS" ||
        i.code === "EMPTY_EMPLOYEE_ID"
    )
  ) {
    status = "invalid";
  } else if (issues.some((i) => i.code === "DESTINATION_UNVERIFIED")) {
    status = "unconfirmed";
  }

  return {
    employeeId,
    status,
    confirmedAddress: status === "confirmed" ? (proposed ?? item.expectedAddress) : undefined,
    issues,
  };
}

/**
 * Validates and confirms a batch of employee payment destinations.
 */
export function confirmEmployeeDestinations(
  input: BatchDestinationConfirmationInput
): BatchDestinationConfirmationResult {
  const results = input.destinations.map((item) =>
    confirmEmployeeDestination(item, { requireVerified: input.requireVerified })
  );

  const allIssues = results.flatMap((r) => r.issues);
  const confirmedCount = results.filter((r) => r.status === "confirmed").length;
  const failureCount = results.length - confirmedCount;

  return {
    allConfirmed: failureCount === 0,
    results,
    confirmedCount,
    failureCount,
    allIssues,
  };
}

/**
 * Asserts that all employee payment destinations are confirmed, throwing if any fail.
 */
export function assertEmployeeDestinationsConfirmed(
  input: BatchDestinationConfirmationInput
): BatchDestinationConfirmationResult {
  const result = confirmEmployeeDestinations(input);
  if (!result.allConfirmed) {
    throw new DestinationConfirmationError(
      `Payment destination confirmation failed for ${result.failureCount} employee(s)`,
      result.allIssues
    );
  }
  return result;
}
