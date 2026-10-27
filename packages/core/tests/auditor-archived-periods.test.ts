import {
  AuditorArchivedReadErrorCode,
  readAuditorArchivedPayrollPeriod,
} from "../src/api/auditorArchivedPeriods";
import type { AuditGrantRecord } from "../src/audit/grantScope";
import type { ArchivedRecord } from "../src/archived/types";

const AUDITOR_KEY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const ADMIN_KEY =
  "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR";
const EMPLOYEE_SECRET_RECIPIENT =
  "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const SAMPLE_RECORDS: ArchivedRecord[] = [
  {
    id: "arc_101",
    recipient: EMPLOYEE_SECRET_RECIPIENT,
    amount: 75000000000n,
    timestamp: 1710000000,
    archivedAt: 1710086400,
    status: "completed",
    asset: "USDC",
  },
  {
    id: "arc_102",
    recipient: EMPLOYEE_SECRET_RECIPIENT,
    amount: 92000000000n,
    timestamp: 1712000000,
    archivedAt: 1712086400,
    status: "failed",
    asset: "XLM",
  },
];

const ACTIVE_GRANT: AuditGrantRecord = {
  grantId: "grant-active-01",
  grantee: AUDITOR_KEY,
  scope: "read-only",
  grantedBy: ADMIN_KEY,
  grantedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-12-31T23:59:59Z",
};

describe("readAuditorArchivedPayrollPeriod (#853)", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("returns redacted archived period records and aggregate summary for an authorized auditor", () => {
    const result = readAuditorArchivedPayrollPeriod({
      grantee: AUDITOR_KEY,
      grants: [ACTIVE_GRANT],
      records: SAMPLE_RECORDS,
      now,
    });

    expect(result.allowed).toBe(true);
    expect(result.reasonCode).toBeNull();
    expect(result.effectiveScope).toBe("read-only");
    expect(result.records).toHaveLength(2);
    expect(result.records[0].id).toBe("arc_102");
    expect(result.records[0].compensationRedacted).toBe(true);
    expect("recipient" in result.records[0]).toBe(false);
    expect("amount" in result.records[0]).toBe(false);
    expect(JSON.stringify(result)).not.toContain(EMPLOYEE_SECRET_RECIPIENT);
    expect(JSON.stringify(result)).not.toContain("75000000000");
    expect(result.summary?.totalCount).toBe(2);
  });

  it("supports period timestamp bounds and status filtering", () => {
    const result = readAuditorArchivedPayrollPeriod({
      grantee: AUDITOR_KEY,
      grants: [ACTIVE_GRANT],
      records: SAMPLE_RECORDS,
      periodStartUnix: 1709000000,
      periodEndUnix: 1711000000,
      status: "completed",
      now,
    });

    expect(result.allowed).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe("arc_101");
    expect(result.summary?.completedCount).toBe(1);
    expect(result.summary?.failedCount).toBe(0);
  });

  it("denies access when grant is missing, expired, revoked, or insufficient in scope", () => {
    const missing = readAuditorArchivedPayrollPeriod({
      grantee: ADMIN_KEY,
      grants: [ACTIVE_GRANT],
      records: SAMPLE_RECORDS,
      now,
    });
    expect(missing.allowed).toBe(false);
    expect(missing.reasonCode).toBe(AuditorArchivedReadErrorCode.AUDITOR_GRANT_MISSING);

    const revoked = readAuditorArchivedPayrollPeriod({
      grantee: AUDITOR_KEY,
      grants: [{ ...ACTIVE_GRANT, revokedAt: "2026-02-01T00:00:00Z" }],
      records: SAMPLE_RECORDS,
      now,
    });
    expect(revoked.allowed).toBe(false);
    expect(revoked.reasonCode).toBe(AuditorArchivedReadErrorCode.AUDITOR_GRANT_REVOKED);

    const expired = readAuditorArchivedPayrollPeriod({
      grantee: AUDITOR_KEY,
      grants: [{ ...ACTIVE_GRANT, expiresAt: "2026-03-01T00:00:00Z" }],
      records: SAMPLE_RECORDS,
      now,
    });
    expect(expired.allowed).toBe(false);
    expect(expired.reasonCode).toBe(AuditorArchivedReadErrorCode.AUDITOR_GRANT_EXPIRED);

    const insufficientScope = readAuditorArchivedPayrollPeriod({
      grantee: AUDITOR_KEY,
      grants: [ACTIVE_GRANT],
      records: SAMPLE_RECORDS,
      requiredScope: "full-audit",
      now,
    });
    expect(insufficientScope.allowed).toBe(false);
    expect(insufficientScope.reasonCode).toBe(
      AuditorArchivedReadErrorCode.AUDITOR_SCOPE_INSUFFICIENT
    );
  });

  it("throws typed ValidationError on invalid period bounds, missing grantee, or unarchived records", () => {
    expect(() =>
      readAuditorArchivedPayrollPeriod({
        grantee: "   ",
        grants: [ACTIVE_GRANT],
        records: SAMPLE_RECORDS,
        now,
      })
    ).toThrow(/Auditor grantee identifier is required/);

    expect(() =>
      readAuditorArchivedPayrollPeriod({
        grantee: AUDITOR_KEY,
        grants: [ACTIVE_GRANT],
        records: SAMPLE_RECORDS,
        periodStartUnix: 2000,
        periodEndUnix: 1000,
        now,
      })
    ).toThrow(/periodStartUnix must not exceed periodEndUnix/);

    expect(() =>
      readAuditorArchivedPayrollPeriod({
        grantee: AUDITOR_KEY,
        grants: [ACTIVE_GRANT],
        records: [
          {
            ...SAMPLE_RECORDS[0],
            archivedAt: 0,
          },
        ],
        now,
      })
    ).toThrow(/not a settled archived payroll record/);
  });
});
