# Selective-Disclosure Audit Packages

Audit packages let dashboards and authorized reviewers verify payroll integrity
without receiving every raw private payroll input.

## What is disclosed

An audit package can disclose:

- payroll metadata such as company id, run id, and payroll period
- commitment references for the allowed scope
- proof references and public-input hashes
- verification key references
- optional proof artifact manifest hash
- package integrity hash

It should not disclose raw salaries, private keys, view keys, or unrelated
employees/payroll periods.

## Creating a package

```ts
import { createSelectiveDisclosureAuditPackage } from "@zk-payroll/core";

const auditPackage = await createSelectiveDisclosureAuditPackage({
  packageId: "audit-package-2026-07",
  payroll: {
    companyId: "company-1",
    payrollRunId: "run-1",
    payrollPeriodId: "2026-07",
    generatedAt: Math.floor(Date.now() / 1000),
  },
  disclosureScope: {
    type: "employee_subset",
    employeeIds: ["employee-1", "employee-2"],
    reason: "external audit",
    expiresAt: 1_900_000_000,
  },
  commitments,
  proofReferences,
  verificationKeys,
  artifactManifestHash,
});
```

Supported scope types are:

- `employee_subset`
- `payroll_period`
- `department`
- `reason`

## Verifying a package

```ts
import { verifySelectiveDisclosureAuditPackage } from "@zk-payroll/core";

const result = await verifySelectiveDisclosureAuditPackage(auditPackage);

if (!result.valid) {
  console.error(result.errors);
}
```

Verification checks:

- schema version
- required payroll metadata
- disclosure scope shape and expiry
- proof references
- verification-key references
- commitment shape
- package integrity hash

Tampering with commitments, metadata, or proof references changes the integrity
hash and causes verification to fail.

## Storage guidance

Store the serialized package, the artifact manifest hash used for verification,
and the reviewer/audit reason together. Keep raw private payroll inputs outside
the package unless a future explicit disclosure policy requires them.
