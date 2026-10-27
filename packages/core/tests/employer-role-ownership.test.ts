import {
  EmployerRoleOwnershipError,
  EmployerRoleOwnershipErrorCode,
  maskEmployerAddress,
  refreshEmployerRoleOwnershipBeforeSubmission,
  verifyEmployerRoleOwnershipSnapshot,
} from "../src/verification/employerRoleOwnership";

const EMPLOYER_A =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const EMPLOYER_B =
  "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR";

describe("refreshEmployerRoleOwnershipBeforeSubmission (#851)", () => {
  const now = new Date("2026-06-15T10:00:00Z");

  it("verifies ownership when live employer admin matches the submitting caller", async () => {
    const result = await refreshEmployerRoleOwnershipBeforeSubmission({
      companyId: "comp_stellar_01",
      callerAddress: EMPLOYER_A,
      cachedEmployerAdmin: EMPLOYER_A,
      now,
      fetchLiveEmployerRole: async (companyId) => ({
        companyId,
        employerAdmin: EMPLOYER_A,
        isActive: true,
        hasEmployerRole: true,
        fetchedAt: "2026-06-15T09:59:55Z",
        ledgerSequence: 842010,
      }),
    });

    expect(result.valid).toBe(true);
    expect(result.code).toBeNull();
    expect(result.ownershipTransferred).toBe(false);
    expect(result.ledgerSequence).toBe(842010);
    expect(result.maskedCaller).toBe(maskEmployerAddress(EMPLOYER_A));
  });

  it("detects when employer ownership was transferred to another wallet and masks addresses", async () => {
    const result = await refreshEmployerRoleOwnershipBeforeSubmission({
      companyId: "comp_stellar_01",
      callerAddress: EMPLOYER_A,
      cachedEmployerAdmin: EMPLOYER_A,
      now,
      fetchLiveEmployerRole: async (companyId) => ({
        companyId,
        employerAdmin: EMPLOYER_B,
        isActive: true,
        hasEmployerRole: true,
        fetchedAt: "2026-06-15T09:59:58Z",
      }),
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe(
      EmployerRoleOwnershipErrorCode.EMPLOYER_ROLE_TRANSFERRED
    );
    expect(result.ownershipTransferred).toBe(true);
    expect(result.message).toContain(maskEmployerAddress(EMPLOYER_B));
    expect(result.message).not.toContain(EMPLOYER_B);
    expect(result.message).not.toContain(EMPLOYER_A);
  });

  it("rejects revoked roles, inactive companies, stale snapshots, and invalid inputs", () => {
    const revoked = verifyEmployerRoleOwnershipSnapshot({
      companyId: "comp_stellar_01",
      callerAddress: EMPLOYER_A,
      now,
      liveRecord: {
        companyId: "comp_stellar_01",
        employerAdmin: EMPLOYER_A,
        isActive: true,
        hasEmployerRole: false,
        fetchedAt: "2026-06-15T09:59:55Z",
      },
    });
    expect(revoked.valid).toBe(false);
    expect(revoked.code).toBe(
      EmployerRoleOwnershipErrorCode.EMPLOYER_ROLE_REVOKED
    );

    const inactive = verifyEmployerRoleOwnershipSnapshot({
      companyId: "comp_stellar_01",
      callerAddress: EMPLOYER_A,
      now,
      liveRecord: {
        companyId: "comp_stellar_01",
        employerAdmin: EMPLOYER_A,
        isActive: false,
        fetchedAt: "2026-06-15T09:59:55Z",
      },
    });
    expect(inactive.valid).toBe(false);
    expect(inactive.code).toBe(EmployerRoleOwnershipErrorCode.COMPANY_INACTIVE);

    const stale = verifyEmployerRoleOwnershipSnapshot({
      companyId: "comp_stellar_01",
      callerAddress: EMPLOYER_A,
      now,
      maxStalenessMs: 10_000,
      liveRecord: {
        companyId: "comp_stellar_01",
        employerAdmin: EMPLOYER_A,
        isActive: true,
        fetchedAt: "2026-06-15T09:59:00Z",
      },
    });
    expect(stale.valid).toBe(false);
    expect(stale.code).toBe(EmployerRoleOwnershipErrorCode.ROLE_SNAPSHOT_STALE);

    const badCaller = verifyEmployerRoleOwnershipSnapshot({
      companyId: "comp_stellar_01",
      callerAddress: "not-a-stellar-key",
      now,
      liveRecord: null,
    });
    expect(badCaller.valid).toBe(false);
    expect(badCaller.code).toBe(
      EmployerRoleOwnershipErrorCode.CALLER_ADDRESS_INVALID
    );
  });

  it("throws EmployerRoleOwnershipError when throwOnFailure is enabled or provider rejects", async () => {
    await expect(
      refreshEmployerRoleOwnershipBeforeSubmission({
        companyId: "comp_stellar_01",
        callerAddress: EMPLOYER_A,
        now,
        throwOnFailure: true,
        fetchLiveEmployerRole: async () => {
          throw new Error("RPC node offline");
        },
      })
    ).rejects.toThrow(EmployerRoleOwnershipError);
  });
});
