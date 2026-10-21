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

## Retention safeguards

Audit records are subject to conflicting retention requirements: compliance laws
require a minimum retention period, privacy laws require a maximum retention
period, and legal holds freeze deletion regardless of expiry. The sdk exposes a
pure evaluator to enforce those rules before a record is deleted,
exported, or shared.

```ts
import {
  evaluateAuditRetention,
  assertAuditRecordDeletable,
} from "@zk-payroll/core";

const evaluation = evaluateAuditRetention({
  recordId: "audit-package-2026-07",
  recordKind: "audit_package",
  createdAt: Date.now(),
  minimumRetentionMs: 7 * 365 * 24 * 60 * 60 * 1000,
  maximumRetentionMs: 10 * 365 * 24 * 60 * 60 * 1000,
  legalHolds: [{ holdId: "hold-1", reason: "litigation", expiresAt: null }],
});

if (!evaluation.canDelete) {
  console.log(evaluation.label);
}

// Throws AuditRetentionValidationError if deletion is blocked.
assertAuditRecordDeletable({
  recordId: "audit-package-2026-07",
  recordKind: "audit_package",
  createdAt: Date.now(),
  minimumRetentionMs: 7 * 365 * 24 * 60 * 60 * 1000,
});
```

Retention statuses:

- `retained` — minimum retention window has not been met; deletion is blocked.
- `legal_hold` — an active legal hold blocks deletion even if the window has met.
- `eligible_for_deletion` — the minimum window is met and no legal hold applies.
- `expired` — the maximum retention window has been exceeded; deletion is required.

Deadlines are evaluated in epoch milliseconds. The minimum window is met at its
exact deadline, and the maximum window is considered exceeded only after its
exact deadline. A non-finite `referenceTime` is rejected. If adding a retention
window to `createdAt` produces a non-finite deadline, validation throws
`AuditRetentionValidationError` with code `INVALID_RETENTION_DEADLINE`; invalid
reference times use `INVALID_REFERENCE_TIME`. These failures do not expose
record identifiers or payroll data.

## Storage guidance

Store the serialized package, the artifact manifest hash used for verification,
and the reviewer/audit reason together. Keep raw private payroll inputs outside
the package unless a future explicit disclosure policy requires them.

Before deleting or exporting a stored package, run it through
`evaluateAuditRetention` (or `assertAuditRecordDeletable`) to ensure the
minimum retention window and legal holds are respected.
