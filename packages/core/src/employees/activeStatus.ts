/**
 * Employee Active Status Helper (#411).
 *
 * SDK helper for reading and normalizing employee active status responses.
 * Dashboard forms need a simple way to check whether an employee can be
 * used in payroll drafts.
 */

import { EmployeeProfile } from "./types";
export { EmployeeProfile } from "./types";
import { SupportedAsset } from "../client";

/**
 * Normalized employee active status.
 */
export type EmployeeActiveStatus = "active" | "inactive" | "suspended" | "unknown";

/**
 * Result of checking employee active status, including the status and
 * any relevant metadata.
 */
export interface EmployeeActiveStatusResult {
  /** The normalized active status */
  status: EmployeeActiveStatus;
  /** Whether the employee can be used in payroll drafts */
  canUseInDrafts: boolean;
  /** Reason for the status, if not active */
  reason?: string;
  /** The employee profile (may have additional details) */
  employee: EmployeeProfile;
}

/**
 * Checks if an employee profile is active and can be used in payroll drafts.
 *
 * @param employee - Employee profile to check
 * @returns EmployeeActiveStatusResult with status and usability info
 */
export function isEmployeeActive(
  employee: EmployeeProfile
): EmployeeActiveStatusResult {
  // Use employeeId and status from the EmployeeProfile/EmployeeEligibilityRecord
  const employeeId = employee.employeeId;
  const employeeStatus = employee.status;

  let status: EmployeeActiveStatus = "unknown"; // Default to unknown when status not provided
  let canUseInDrafts = false;
  let reason: string | undefined;

  // Check status field from the employee record
  if (employeeStatus === "active") {
    status = "active";
    canUseInDrafts = true;
  } else if (employeeStatus === "suspended") {
    status = "suspended";
    canUseInDrafts = false;
    reason = "Employee status is suspended";
  } else if (employeeStatus === "inactive") {
    status = "inactive";
    canUseInDrafts = false;
    reason = "Employee is inactive";
  } else if (employeeStatus === "pending" || employeeStatus === "terminated") {
    status = "inactive";
    canUseInDrafts = false;
    reason = `Employee status is ${employeeStatus}`;
  } else if (employeeStatus !== undefined && employeeStatus !== null) {
    // Has a status but it's not one we recognize
    status = "unknown";
    canUseInDrafts = false;
    reason = "Employee status unknown";
  } else {
    // No status provided - status is unknown
    reason = "Employee status not evaluated";
  }

  return {
    status,
    canUseInDrafts,
    reason,
    employee,
  };
}

/**
 * Checks multiple employee profiles for active status.
 *
 * @param employees - Array of employee profiles to check
 * @returns Object mapping employee address to active status result
 */
export function checkEmployeesActive(
  employees: EmployeeProfile[]
): Record<string, EmployeeActiveStatusResult> {
  const results: Record<string, EmployeeActiveStatusResult> = {};

  for (const employee of employees) {
    const result = isEmployeeActive(employee);
    // Use employeeId or recipient as the key
    const key = employee.employeeId || employee.recipient || "unknown";
    results[key] = result;
  }

  return results;
}

/**
 * Formats an EmployeeActiveStatusResult for UI display.
 *
 * @param result - The active status result
 * @returns UI-friendly status string
 */
export function formatActiveStatus(result: EmployeeActiveStatusResult): string {
  const statusMap: Record<EmployeeActiveStatus, string> = {
    active: "Active",
    inactive: "Inactive",
    suspended: "Suspended",
    unknown: "Unknown",
  };

  const display = statusMap[result.status];

  if (result.canUseInDrafts) {
    return `${display} - Can be used in payroll drafts`;
  }

  if (result.reason) {
    return `${display} - ${result.reason}`;
  }

  return `${display} - Cannot be used in payroll drafts`;
}

/**
 * Fixture: sample employee profiles for testing.
 * Uses the actual EmployeeProfile/EmployeeEligibilityRecord fields.
 */
export const sampleEmployeeProfiles: EmployeeProfile[] = [
  {
    employeeId: "GALICE1234567890abcdef",
    recipient: "GALICE1234567890abcdef",
    department: "Engineering",
    status: "active",
    effectiveDate: Date.now() - 86400000,
    expiryDate: undefined,
    isBlocked: false,
    name: "Alice",
    salary: undefined,
    asset: undefined,
    token: undefined,
  },
  {
    employeeId: "GBOB1234567890abcdef",
    recipient: "GBOB1234567890abcdef",
    department: "Marketing",
    status: "suspended",
    effectiveDate: Date.now() - 86400000,
    expiryDate: undefined,
    isBlocked: false,
    name: "Bob",
  },
  {
    employeeId: "GCHARLIE1234567890abcd",
    recipient: "GCHARLIE1234567890abcd",
    department: "Sales",
    status: "inactive",
    effectiveDate: Date.now() - 86400000,
    expiryDate: undefined,
    isBlocked: false,
    name: "Charlie",
  },
];