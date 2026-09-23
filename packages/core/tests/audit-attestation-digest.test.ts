import {
  AUDIT_ATTESTATION_DIGEST_DOMAIN,
  computeAuditAttestationDigest,
  serializeAuditAttestationDigestInput,
  validateAuditAttestationDigestInput,
  verifyAuditAttestationDigest,
} from "../src/audit/auditAttestationDigest";

const input = {
  organizationId: "org-1",
  payrollRunId: "run-1",
  scope: "department:engineering",
  periodStart: "2026-07-01",
  periodEnd: "2026-08-01",
  evidenceRoot: "root-1",
};

describe("audit attestation digests", () => {
  it("serializes with the contract domain tag and is deterministic", async () => {
    expect(serializeAuditAttestationDigestInput(input)).toBe(
      JSON.stringify({ domain: AUDIT_ATTESTATION_DIGEST_DOMAIN, ...input })
    );
    expect(await computeAuditAttestationDigest(input)).toBe(
      await computeAuditAttestationDigest({ ...input })
    );
  });

  it.each(["scope", "periodStart", "periodEnd"])("changes when %s changes", async (field) => {
    const changed = {
      ...input,
      [field]:
        field === "scope"
          ? "department:finance"
          : field === "periodStart"
            ? "2026-06-01"
            : "2026-09-01",
    };
    expect(await computeAuditAttestationDigest(changed)).not.toBe(
      await computeAuditAttestationDigest(input)
    );
  });

  it("rejects missing and ambiguous fields clearly", () => {
    expect(() => validateAuditAttestationDigestInput({ ...input, scope: "" })).toThrow(
      "scope"
    );
    expect(() => validateAuditAttestationDigestInput({ ...input, periodStart: "2026-08-01" })).toThrow(
      "periodStart must be before periodEnd"
    );
    expect(() => validateAuditAttestationDigestInput(null)).toThrow("must be an object");
  });

  it("verifies valid digests and rejects malformed or mismatched values", async () => {
    const digest = await computeAuditAttestationDigest(input);
    await expect(verifyAuditAttestationDigest(input, digest)).resolves.toBe(true);
    await expect(verifyAuditAttestationDigest({ ...input, scope: "all" }, digest)).resolves.toBe(false);
    await expect(verifyAuditAttestationDigest(input, "not-a-digest")).resolves.toBe(false);
  });
});
