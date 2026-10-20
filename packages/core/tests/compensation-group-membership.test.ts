import type { CompensationGroup } from "../src/payroll/compensationGroupMembership";
import { validateCompensationGroupMembership } from "../src/payroll/compensationGroupMembership";

describe("validateCompensationGroupMembership", () => {
  it("reports no violations for a clean, fully-partitioned roster", () => {
    const groups: CompensationGroup[] = [
      { groupId: "tier-a", memberIds: ["EMP-001", "EMP-002"] },
      { groupId: "tier-b", memberIds: ["EMP-003"] },
    ];

    const result = validateCompensationGroupMembership(groups, {
      knownEmployeeIds: ["EMP-001", "EMP-002", "EMP-003"],
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.membershipByEmployee.get("EMP-001")).toEqual(["tier-a"]);
  });

  it("flags an employee assigned to more than one group", () => {
    const groups: CompensationGroup[] = [
      { groupId: "tier-a", memberIds: ["EMP-001"] },
      { groupId: "tier-b", memberIds: ["EMP-001"] },
    ];

    const result = validateCompensationGroupMembership(groups, {
      requireEveryEmployeeAssigned: false,
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      code: "MULTIPLE_GROUP_MEMBERSHIP",
      employeeId: "EMP-001",
      groupIds: ["tier-a", "tier-b"],
    });
  });

  it("flags a duplicate groupId", () => {
    const groups: CompensationGroup[] = [
      { groupId: "tier-a", memberIds: ["EMP-001"] },
      { groupId: "tier-a", memberIds: ["EMP-002"] },
    ];

    const result = validateCompensationGroupMembership(groups, {
      requireEveryEmployeeAssigned: false,
    });

    expect(result.violations.some((v) => v.code === "DUPLICATE_GROUP_ID")).toBe(true);
  });

  it("flags an empty groupId", () => {
    const groups: CompensationGroup[] = [{ groupId: "", memberIds: ["EMP-001"] }];

    const result = validateCompensationGroupMembership(groups, {
      requireEveryEmployeeAssigned: false,
    });

    expect(result.violations.some((v) => v.code === "EMPTY_GROUP_ID")).toBe(true);
  });

  it("flags an empty member id within a group", () => {
    const groups: CompensationGroup[] = [{ groupId: "tier-a", memberIds: ["EMP-001", ""] }];

    const result = validateCompensationGroupMembership(groups, {
      requireEveryEmployeeAssigned: false,
    });

    expect(result.violations.some((v) => v.code === "EMPTY_MEMBER_ID")).toBe(true);
  });

  it("flags a group member who is not a known employee", () => {
    const groups: CompensationGroup[] = [{ groupId: "tier-a", memberIds: ["EMP-999"] }];

    const result = validateCompensationGroupMembership(groups, {
      knownEmployeeIds: ["EMP-001"],
      requireEveryEmployeeAssigned: false,
    });

    expect(result.violations).toEqual([
      expect.objectContaining({ code: "UNKNOWN_MEMBER", employeeId: "EMP-999" }),
    ]);
  });

  it("flags a known employee not assigned to any group when required", () => {
    const groups: CompensationGroup[] = [{ groupId: "tier-a", memberIds: ["EMP-001"] }];

    const result = validateCompensationGroupMembership(groups, {
      knownEmployeeIds: ["EMP-001", "EMP-002"],
    });

    expect(result.violations).toEqual([
      expect.objectContaining({ code: "UNASSIGNED_EMPLOYEE", employeeId: "EMP-002" }),
    ]);
  });

  it("does not require every employee to be assigned when the option is disabled", () => {
    const groups: CompensationGroup[] = [{ groupId: "tier-a", memberIds: ["EMP-001"] }];

    const result = validateCompensationGroupMembership(groups, {
      knownEmployeeIds: ["EMP-001", "EMP-002"],
      requireEveryEmployeeAssigned: false,
    });

    expect(result.valid).toBe(true);
  });

  it("skips the known-employee checks entirely when knownEmployeeIds is omitted", () => {
    const groups: CompensationGroup[] = [{ groupId: "tier-a", memberIds: ["EMP-999"] }];

    const result = validateCompensationGroupMembership(groups);

    expect(result.valid).toBe(true);
  });

  it("reports violations in a deterministic order across repeated calls", () => {
    const groups: CompensationGroup[] = [
      { groupId: "tier-b", memberIds: ["EMP-002", "EMP-001"] },
      { groupId: "tier-a", memberIds: ["EMP-001"] },
    ];
    const options = { requireEveryEmployeeAssigned: false };

    const first = validateCompensationGroupMembership(groups, options);
    const second = validateCompensationGroupMembership(groups, options);

    expect(first.violations).toEqual(second.violations);
  });

  it("handles an empty group list", () => {
    const result = validateCompensationGroupMembership([]);

    expect(result.valid).toBe(true);
    expect(result.membershipByEmployee.size).toBe(0);
  });
});
