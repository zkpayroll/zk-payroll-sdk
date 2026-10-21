import {
  AuditGrantStatusClientError,
  AuditGrantStatusClientErrorCode,
  getAuditGrantRevocationStatusForClient,
} from "../src/client";
import type { AuditGrantRecord } from "../src/audit/grantScope";

const NOW = new Date("2026-07-01T00:00:00.000Z");
const GRANTEE = "GBS5ZG3ORKZB4LT6JMPMFGSHZBFV3N2R6UJWDNGJTCKX3PZZ3ZJQ4Z3JHR";
const ADMIN = "GDNSDTGIEYJZP3DHYOEZ5WUJM5ZJDVEW7FTCFXCP3MDGXQKNGJ4XBZGWY";

function grant(overrides: Partial<AuditGrantRecord> = {}): AuditGrantRecord {
  return {
    grantId: "grant_12345678",
    grantee: GRANTEE,
    scope: "read-only",
    grantedBy: ADMIN,
    grantedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getAuditGrantRevocationStatusForClient", () => {
  it("reports a revoked grant alongside a still-active grant", async () => {
    const result = await getAuditGrantRevocationStatusForClient(
      async () => [
        grant({ grantId: "grant_revoked123", revokedAt: "2026-05-01T00:00:00.000Z" }),
        grant({ grantId: "grant_active123", scope: "full-audit" }),
      ],
      GRANTEE,
      NOW
    );

    expect(result).toEqual({
      redactedGrantee: "GBS***JHR",
      state: "active",
      hasRevokedGrant: true,
      revokedGrantCount: 1,
      grantCount: 2,
      latestRevokedAt: "2026-05-01T00:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("grant_revoked123");
  });

  it("normalizes provider failures without exposing backend details", async () => {
    await expect(
      getAuditGrantRevocationStatusForClient(
        async () => {
          throw new Error("private salary data and API response");
        },
        GRANTEE,
        NOW
      )
    ).rejects.toMatchObject({
      code: AuditGrantStatusClientErrorCode.UNAVAILABLE,
      message: expect.not.stringContaining("private salary data"),
    });
  });

  it("returns none when there are no matching grants and rejects invalid boundaries", async () => {
    await expect(
      getAuditGrantRevocationStatusForClient(async () => [], GRANTEE, NOW)
    ).resolves.toMatchObject({ state: "none", hasRevokedGrant: false, grantCount: 0 });

    await expect(
      getAuditGrantRevocationStatusForClient(async () => [], "  ", NOW)
    ).rejects.toBeInstanceOf(AuditGrantStatusClientError);
    await expect(
      getAuditGrantRevocationStatusForClient(async () => [], GRANTEE, new Date(Number.NaN))
    ).rejects.toMatchObject({ code: AuditGrantStatusClientErrorCode.INVALID_TIME });
  });
});