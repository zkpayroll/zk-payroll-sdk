import {
  createSelectiveDisclosureAuditPackage,
  deserializeAuditPackage,
  serializeAuditPackage,
  verifySelectiveDisclosureAuditPackage,
  CreateAuditPackageInput,
} from "../src/audit";

function makeAuditPackageInput(): CreateAuditPackageInput {
  return {
    packageId: "audit-package-1",
    payroll: {
      companyId: "company-1",
      payrollRunId: "run-1",
      payrollPeriodId: "period-2026-07",
      generatedAt: 1_800_000_000,
    },
    disclosureScope: {
      type: "employee_subset",
      employeeIds: ["employee-1"],
      reason: "quarterly audit",
      expiresAt: 1_900_000_000,
    },
    commitments: [
      {
        id: "commitment-1",
        employeeId: "employee-1",
        payrollPeriodId: "period-2026-07",
        departmentId: "engineering",
        commitmentHash: "commitment-hash-1",
      },
      {
        id: "commitment-2",
        employeeId: "employee-2",
        payrollPeriodId: "period-2026-07",
        departmentId: "finance",
        commitmentHash: "commitment-hash-2",
      },
    ],
    proofReferences: [
      {
        id: "proof-1",
        proofHash: "proof-hash",
        verificationKeyId: "vk-1",
        circuitId: "private-payroll",
        publicInputHash: "public-input-hash",
      },
    ],
    verificationKeys: [
      {
        id: "vk-1",
        version: "vk-v1",
        hash: "verification-key-hash",
        proofSystem: "groth16",
      },
    ],
    artifactManifestHash: "artifact-manifest-hash",
  };
}

describe("selective disclosure audit packages", () => {
  it("generates and verifies a versioned selective-disclosure package", async () => {
    const auditPackage = await createSelectiveDisclosureAuditPackage(makeAuditPackageInput());
    const verification = await verifySelectiveDisclosureAuditPackage(auditPackage, 1_800_000_001);

    expect(auditPackage.schemaVersion).toBe("1.0");
    expect(auditPackage.commitments).toHaveLength(1);
    expect(auditPackage.commitments[0].employeeId).toBe("employee-1");
    expect(verification.valid).toBe(true);
  });

  it("detects tampered metadata, commitments, and proof references through integrity hash", async () => {
    const auditPackage = await createSelectiveDisclosureAuditPackage(makeAuditPackageInput());
    const tampered = {
      ...auditPackage,
      proofReferences: [{ ...auditPackage.proofReferences[0], proofHash: "tampered" }],
    };

    const verification = await verifySelectiveDisclosureAuditPackage(tampered, 1_800_000_001);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain(
      "Audit package integrity hash does not match package content."
    );
  });

  it("rejects expired or malformed disclosure scopes", async () => {
    await expect(
      createSelectiveDisclosureAuditPackage({
        ...makeAuditPackageInput(),
        disclosureScope: {
          type: "payroll_period",
          payrollPeriodIds: ["period-2026-07"],
          expiresAt: 1_700_000_000,
        },
      })
    ).rejects.toThrow("disclosureScope is expired");

    await expect(
      createSelectiveDisclosureAuditPackage({
        ...makeAuditPackageInput(),
        disclosureScope: { type: "employee_subset", employeeIds: [] },
      })
    ).rejects.toThrow("disclosureScope is malformed");
  });

  it("serializes and deserializes schema version 1.0 packages", async () => {
    const auditPackage = await createSelectiveDisclosureAuditPackage(makeAuditPackageInput());
    const serialized = serializeAuditPackage(auditPackage);
    const deserialized = deserializeAuditPackage(serialized);

    expect(deserialized).toEqual(auditPackage);
  });

  it("rejects unsupported schema versions during deserialization", () => {
    expect(() =>
      deserializeAuditPackage(
        JSON.stringify({
          ...makeAuditPackageInput(),
          schemaVersion: "0.9",
          integrityHash: "hash",
        })
      )
    ).toThrow("Unsupported audit package schema version");
  });

  it("fails verification when proof references are missing verification keys", async () => {
    await expect(
      createSelectiveDisclosureAuditPackage({
        ...makeAuditPackageInput(),
        verificationKeys: [],
      })
    ).rejects.toThrow("references missing verification key");
  });
});
