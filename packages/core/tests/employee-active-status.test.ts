/**
 * Tests for EmployeeActiveStatusHelper (#411).
 *
 * Tests SDK helper for reading and normalizing employee active status
 * responses. Dashboard forms need a simple way to check whether an
 * employee can be used in payroll drafts.
 */

import { isEmployeeActive, checkEmployeesActive, formatActiveStatus, EmployeeActiveStatusResult, EmployeeProfile, sampleEmployeeProfiles } from "../src/employees/activeStatus";

const EMPLOYER = "GTESTEMPLOYER1234567890abcdef";

describe("EmployeeActiveStatusHelper", () => {
  describe("isEmployeeActive", () => {
    it("should return active status for employee with active status", () => {
      const activeEmployee = {
        employeeId: "GALICE1234567890abcdef",
        recipient: "GALICE1234567890abcdef",
        department: "Engineering",
        status: "active",
      } as EmployeeProfile;

      const result = isEmployeeActive(activeEmployee);
      expect(result.status).toBe("active");
      expect(result.canUseInDrafts).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.employee).toBeDefined();
    });

    it("should return inactive status for employee without eligibility", () => {
      const employeeNoEligibility = {
        employeeId: "GTEST1234567890abcdef",
        recipient: "GTEST1234567890abcdef",
      } as EmployeeProfile;

      const result = isEmployeeActive(employeeNoEligibility as any);
      // Employee with no status field defaults to "unknown"
      expect(result.status).toBe("unknown");
      expect(result.canUseInDrafts).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("should return suspended status for suspended employee", () => {
      const suspendedEmployee = {
        employeeId: "GBOB1234567890abcdef",
        recipient: "GBOB1234567890abcdef",
        department: "Marketing",
        status: "suspended",
      } as EmployeeProfile;

      const result = isEmployeeActive(suspendedEmployee as any);
      expect(result.status).toBe("suspended");
      expect(result.canUseInDrafts).toBe(false);
      expect(result.reason).toBe("Employee status is suspended");
    });

    it("should return inactive status for inactive employee", () => {
      const inactiveEmployee = {
        employeeId: "GCHARLIE1234567890abcd",
        recipient: "GCHARLIE1234567890abcd",
        department: "Sales",
        status: "inactive",
      } as EmployeeProfile;

      const result = isEmployeeActive(inactiveEmployee as any);
      expect(result.status).toBe("inactive");
      expect(result.canUseInDrafts).toBe(false);
      expect(result.reason).toBe("Employee is inactive");
    });

    it("should return unknown status for employee with no status", () => {
      const employeeNoStatus = {
        employeeId: "GTEST1234567890abcdef",
        recipient: "GTEST1234567890abcdef",
        department: "Engineering",
      } as EmployeeProfile;

      const result = isEmployeeActive(employeeNoStatus as any);
      expect(result.status).toBe("unknown");
      expect(result.canUseInDrafts).toBe(false);
      expect(result.reason).toBe("Employee status not evaluated");
    });

    it("should format active status for UI display", () => {
      const activeResult: EmployeeActiveStatusResult = {
        status: "active",
        canUseInDrafts: true,
        employee: {} as EmployeeProfile,
      };

      expect(formatActiveStatus(activeResult)).toContain("Active");
      expect(formatActiveStatus(activeResult)).toContain("Can be used in payroll drafts");
    });

    it("should format inactive status for UI display", () => {
      const inactiveResult: EmployeeActiveStatusResult = {
        status: "inactive",
        canUseInDrafts: false,
        reason: "Employee is inactive",
        employee: {} as EmployeeProfile,
      };

      expect(formatActiveStatus(inactiveResult)).toContain("Inactive");
      expect(formatActiveStatus(inactiveResult)).toContain("Employee is inactive");
    });
  });

  describe("checkEmployeesActive", () => {
    it("should check multiple employees and return results for each", () => {
      const results = checkEmployeesActive(sampleEmployeeProfiles);

      expect(results).toBeDefined();
      expect(results["GALICE1234567890abcdef"]).toBeDefined();
      expect(results["GBOB1234567890abcdef"]).toBeDefined();
      expect(results["GCHARLIE1234567890abcd"]).toBeDefined();

      expect(results["GALICE1234567890abcdef"].status).toBe("active");
      expect(results["GBOB1234567890abcdef"].status).toBe("suspended");
      expect(results["GCHARLIE1234567890abcd"].status).toBe("inactive");
    });
  });

  describe("with sample employee profiles", () => {
    it("should correctly identify active employees from fixtures", () => {
      const results = checkEmployeesActive(sampleEmployeeProfiles);

      const aliceResult = results["GALICE1234567890abcdef"];
      expect(aliceResult.status).toBe("active");
      expect(aliceResult.canUseInDrafts).toBe(true);

      const bobResult = results["GBOB1234567890abcdef"];
      expect(bobResult.status).toBe("suspended");
      expect(bobResult.canUseInDrafts).toBe(false);

      const charlieResult = results["GCHARLIE1234567890abcd"];
      expect(charlieResult.status).toBe("inactive");
      expect(charlieResult.canUseInDrafts).toBe(false);
    });
  });
});