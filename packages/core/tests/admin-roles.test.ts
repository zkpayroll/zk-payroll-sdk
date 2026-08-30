import {
  listAdminRoles,
  RoleListError,
  SIGNER_ROLE_GROUPS,
  type RawRoleAssignment,
} from "../src/authorization/roles";

describe("listAdminRoles", () => {
  it("normalizes a populated response, grouping members by role", async () => {
    const raw: RawRoleAssignment[] = [
      { role: "payroll_admin", address: "GADMIN1" },
      { role: "payroll_admin", address: "GADMIN2", assignedAt: 123 },
      { role: "treasury_operator", address: "GTREASURY1" },
    ];

    const result = await listAdminRoles(async () => raw);

    expect(result.roles.payroll_admin).toHaveLength(2);
    expect(result.roles.payroll_admin[1].assignedAt).toBe(123);
    expect(result.roles.treasury_operator).toHaveLength(1);
    expect(result.totalMembers).toBe(3);
  });

  it("represents every supported role group as an empty array when the response is empty", async () => {
    const result = await listAdminRoles(async () => []);

    for (const role of SIGNER_ROLE_GROUPS) {
      expect(result.roles[role]).toEqual([]);
    }
    expect(result.totalMembers).toBe(0);
  });

  it("drops entries with an unrecognized role instead of throwing", async () => {
    const raw = [
      { role: "payroll_admin", address: "GADMIN1" },
      { role: "not_a_real_role", address: "GBOGUS" },
    ] as RawRoleAssignment[];

    const result = await listAdminRoles(async () => raw);

    expect(result.totalMembers).toBe(1);
    expect(result.roles.payroll_admin).toHaveLength(1);
  });

  it("wraps a thrown fetch error in a RoleListError, preserving the cause", async () => {
    const original = new Error("contract read failed");

    await expect(
      listAdminRoles(async () => {
        throw original;
      })
    ).rejects.toMatchObject({
      name: "RoleListError",
      message: "Failed to fetch admin role list",
      cause: original,
    });
  });

  it("covers all four supported role groups", () => {
    expect(SIGNER_ROLE_GROUPS).toEqual([
      "payroll_admin",
      "treasury_operator",
      "compliance_reviewer",
      "emergency_approver",
    ]);
  });
});
