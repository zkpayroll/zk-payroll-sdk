import {
  EmployerRoleChangeRecord,
  EmployerRoleError,
  EmployerRoleErrorCode,
  EmployerRoleStateManager,
  verifyEmployerRoleChangeIntegrity,
} from "../../src/access";

const EMPLOYER = "GBZXN7PIRZGNMHGA72XZBTWNTVANANCGICPOZS5JUU5PNO773VO4Q2L7";
const TARGET = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const SUCCESSOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const PRIVATE_CONTEXT = "SALARY_500K_EMPLOYEE_SECRET";
const NOW = 1_700_000_000_000;

function expectCode(code: EmployerRoleErrorCode): RegExp {
  return new RegExp(code);
}

describe("Employer role change state handling (#888)", () => {
  it("grants an active role as an immutable, hash-chained record", () => {
    const manager = new EmployerRoleStateManager();
    const grant = manager.grantRole({
      changeId: "grant_1",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "PAYROLL_OPERATOR",
      now: NOW,
    });

    expect(grant.status).toBe("ACTIVE");
    expect(grant.revision).toBe(1);
    expect(grant.effectiveAt).toBe(NOW);
    expect(Object.isFrozen(grant)).toBe(true);
    expect(verifyEmployerRoleChangeIntegrity(grant)).toBe(true);
    expect(manager.verifyIntegrity("grant_1")).toBe(true);
    expect(manager.verifyScopeIntegrity(EMPLOYER)).toBe(true);
    expect(manager.activeRoles(EMPLOYER, TARGET)).toEqual(["PAYROLL_OPERATOR"]);
  });

  it("returns the existing record for an identical retry and rejects a conflicting identifier", () => {
    const manager = new EmployerRoleStateManager();
    const params = {
      changeId: "grant_idem",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "AUDITOR" as const,
      now: NOW,
    };
    const first = manager.grantRole(params);
    expect(manager.grantRole({ ...params, now: NOW + 10_000 })).toBe(first);

    expect(() => manager.grantRole({ ...params, role: "SIGNER", now: NOW + 20_000 })).toThrow(
      expectCode("DUPLICATE_CHANGE")
    );
  });

  it("revokes and re-grants a role with monotonic revisions and an intact chain", () => {
    const manager = new EmployerRoleStateManager();
    manager.grantRole({
      changeId: "grant_revoke",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "SIGNER",
      now: NOW,
    });
    const revoke = manager.revokeRole({
      changeId: "revoke_1",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "SIGNER",
      now: NOW + 1,
      expectedRevision: 1,
    });
    expect(revoke.status).toBe("REVOKED");
    expect(revoke.revision).toBe(2);
    expect(revoke.previousHash).toBeDefined();
    expect(manager.activeRoles(EMPLOYER, TARGET)).toEqual([]);

    expect(() =>
      manager.grantRole({
        changeId: "grant_stale",
        employer: EMPLOYER,
        targetAccount: TARGET,
        role: "SIGNER",
        now: NOW + 2,
        expectedRevision: 1,
      })
    ).toThrow(expectCode("STALE_REVISION"));

    const again = manager.grantRole({
      changeId: "grant_again",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "SIGNER",
      now: NOW + 3,
      expectedRevision: 2,
    });
    expect(again.revision).toBe(3);
    expect(manager.verifyScopeIntegrity(EMPLOYER)).toBe(true);
  });

  it("transfers a role atomically and keeps the handoff idempotent", () => {
    const manager = new EmployerRoleStateManager();
    manager.grantRole({
      changeId: "grant_transfer",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "EMPLOYER_ADMIN",
      now: NOW,
    });

    const handoff = manager.transferRole({
      changeId: "transfer_1",
      employer: EMPLOYER,
      targetAccount: SUCCESSOR,
      fromAccount: TARGET,
      role: "EMPLOYER_ADMIN",
      now: NOW + 1,
      expectedRevision: 1,
    });

    expect(handoff.outgoing.status).toBe("REVOKED");
    expect(handoff.incoming.status).toBe("ACTIVE");
    expect(handoff.incoming.previousHash).toBe(handoff.outgoing.stateHash);
    expect(manager.activeRoles(EMPLOYER, TARGET)).toEqual([]);
    expect(manager.activeRoles(EMPLOYER, SUCCESSOR)).toEqual(["EMPLOYER_ADMIN"]);
    expect(manager.activeAdministrators(EMPLOYER)).toEqual([SUCCESSOR]);
    expect(manager.verifyScopeIntegrity(EMPLOYER)).toBe(true);
    expect(
      manager.transferRole({
        changeId: "transfer_1",
        employer: EMPLOYER,
        targetAccount: SUCCESSOR,
        fromAccount: TARGET,
        role: "EMPLOYER_ADMIN",
        now: NOW + 1,
        expectedRevision: 1,
      })
    ).toEqual(handoff);
  });

  it("rejects invalid transfers without mutating state", () => {
    const manager = new EmployerRoleStateManager();
    manager.grantRole({
      changeId: "grant_same",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "AUDITOR",
      now: NOW,
    });

    expect(() =>
      manager.transferRole({
        changeId: "same_account",
        employer: EMPLOYER,
        targetAccount: TARGET,
        fromAccount: TARGET,
        role: "AUDITOR",
        now: NOW,
      })
    ).toThrow(expectCode("SAME_ACCOUNT_TRANSFER"));
    expect(() =>
      manager.transferRole({
        changeId: "no_role",
        employer: EMPLOYER,
        targetAccount: SUCCESSOR,
        fromAccount: EMPLOYER,
        role: "AUDITOR",
        now: NOW,
      })
    ).toThrow(expectCode("INVALID_CHANGE_STATE"));
    expect(manager.getChange("same_account")).toBeUndefined();
    expect(manager.verifyScopeIntegrity(EMPLOYER)).toBe(true);
  });

  it("protects the last active administrator", () => {
    const manager = new EmployerRoleStateManager();
    manager.grantRole({
      changeId: "admin_only",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "EMPLOYER_ADMIN",
      now: NOW,
    });

    expect(() =>
      manager.revokeRole({
        changeId: "admin_revoke",
        employer: EMPLOYER,
        targetAccount: TARGET,
        role: "EMPLOYER_ADMIN",
        now: NOW + 1,
      })
    ).toThrow(expectCode("LAST_ADMIN_REMOVAL"));
    expect(manager.activeAdministrators(EMPLOYER)).toEqual([TARGET]);
  });

  it("detects tampered records before applying further changes", () => {
    const manager = new EmployerRoleStateManager();
    const record = manager.grantRole({
      changeId: "tampered",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "SIGNER",
      now: NOW,
    });
    const changed = { ...record, status: "REVOKED" } as EmployerRoleChangeRecord;
    expect(verifyEmployerRoleChangeIntegrity(changed)).toBe(false);

    const internal = manager as unknown as {
      changes: Map<string, EmployerRoleChangeRecord>;
    };
    internal.changes.set("tampered", changed);
    expect(manager.verifyIntegrity("tampered")).toBe(false);
    expect(manager.verifyScopeIntegrity(EMPLOYER)).toBe(false);
    expect(() =>
      manager.revokeRole({
        changeId: "tampered_revoke",
        employer: EMPLOYER,
        targetAccount: TARGET,
        role: "SIGNER",
        now: NOW + 1,
      })
    ).toThrow(expectCode("STATE_INTEGRITY_COMPROMISED"));
    expect(() =>
      manager.grantRole({
        changeId: "tampered",
        employer: EMPLOYER,
        targetAccount: TARGET,
        role: "SIGNER",
        now: NOW,
      })
    ).toThrow(expectCode("STATE_INTEGRITY_COMPROMISED"));
  });

  it("enforces structural boundaries without echoing private payroll context", () => {
    const manager = new EmployerRoleStateManager();
    const base = {
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "AUDITOR" as const,
      now: NOW,
    };

    expect(() =>
      manager.grantRole({ ...base, changeId: "  ", ...({ note: PRIVATE_CONTEXT } as object) })
    ).toThrow(expectCode("INVALID_CHANGE_ID"));
    expect(() => manager.grantRole({ ...base, changeId: "bad_key", employer: "Gshort" })).toThrow(
      expectCode("INVALID_EMPLOYER_ADDRESS")
    );
    expect(() =>
      manager.grantRole({ ...base, changeId: "boundary_expiry", expiresAt: NOW })
    ).toThrow(expectCode("EXPIRED_ROLE_GRANT"));
    expect(() =>
      manager.grantRole({
        ...base,
        changeId: "boundary_skew",
        effectiveAt: NOW - 5 * 60 * 1000 - 1,
      })
    ).toThrow(expectCode("INVALID_TIMESTAMP"));

    const inSkew = manager.grantRole({
      ...base,
      changeId: "boundary_skew_ok",
      effectiveAt: NOW - 5 * 60 * 1000,
    });
    expect(inSkew.status).toBe("ACTIVE");

    try {
      manager.grantRole({
        ...base,
        changeId: "bad_key",
        employer: "Gshort",
        ...({ note: PRIVATE_CONTEXT } as object),
      });
    } catch (error) {
      const typed = error as EmployerRoleError;
      expect(typed.code).toBe("INVALID_EMPLOYER_ADDRESS");
      expect(typed.message).not.toContain(PRIVATE_CONTEXT);
      expect(JSON.stringify(typed.issues)).not.toContain(PRIVATE_CONTEXT);
    }
  });

  it("expires an assignment while preserving its audit chain", () => {
    const manager = new EmployerRoleStateManager();
    manager.grantRole({
      changeId: "expiring_grant",
      employer: EMPLOYER,
      targetAccount: TARGET,
      role: "SIGNER",
      now: NOW,
    });
    const expired = manager.expireRole({
      changeId: "expiry_1",
      scopeId: EMPLOYER,
      account: TARGET,
      role: "SIGNER",
      now: NOW + 100,
      expectedRevision: 1,
    });

    expect(expired.status).toBe("EXPIRED");
    expect(expired.revision).toBe(2);
    expect(manager.activeRoles(EMPLOYER, TARGET)).toEqual([]);
    expect(manager.verifyIntegrity("expiry_1")).toBe(true);
    expect(manager.verifyScopeIntegrity(EMPLOYER)).toBe(true);
    expect(() =>
      manager.expireRole({
        changeId: "expiry_again",
        scopeId: EMPLOYER,
        account: TARGET,
        role: "SIGNER",
        now: NOW + 200,
      })
    ).toThrow(expectCode("INVALID_CHANGE_STATE"));
  });
});
