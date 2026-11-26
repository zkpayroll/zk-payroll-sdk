# Employee Activation Prerequisite Checks — Usage Guide (Issue #636)

Employee activation prerequisite checks live in `@zk-payroll/core` and validate
that every precondition for activating an employee is satisfied **before** an
activation/registry transaction is built and signed.

The check is **pure** — it performs no I/O and never touches the network — so
it is safe to call from dashboards, batch builders, or the lifecycle client.

---

## Quick start

```ts
import {
  validateEmployeeActivationPrerequisites,
  validateEmployeeActivationPrerequisitesOrThrow,
  EmployeeActivationPrerequisiteError,
} from "@zk-payroll/core";
```

---

## Checking prerequisites before activation

```ts
const result = validateEmployeeActivationPrerequisites({
  profile: employeeRecord,
  employerAddress: employerPublicKey, // optional
  // expectedAsset: "native",        // optional
});

if (result.ok) {
  await lifecycleClient.create(adminKeypair, employeeRecord.address);
} else {
  // Every failed check, with stable codes and actionable messages.
  for (const issue of result.issues) {
    console.error(`${issue.code}: ${issue.message}`);
  }
}
```

### Throwing variant

```ts
import { validateEmployeeActivationPrerequisitesOrThrow } from "@zk-payroll/core";

try {
  validateEmployeeActivationPrerequisitesOrThrow({ profile: employeeRecord });
  // … proceed with activation
} catch (err) {
  if (err instanceof EmployeeActivationPrerequisiteError) {
    err.issues.forEach((issue) => console.error(issue.code, issue.message));
  }
}
```

---

## What is checked

| Code | Field | Meaning |
| --- | --- | --- |
| `ACTIVATION_IDENTITY_INVALID` | `profile` | Employee address is missing or not a valid Stellar `G...`/`M...` address. |
| `ACTIVATION_RECORD_BLOCKED` | `profile` | Record is administratively blocked (compliance hold). |
| `ACTIVATION_RECORD_TERMINATED` | `profile` | Record is `terminated`/`offboarded`; onboard a new record instead. Suspended records **can** be re-activated. |
| `ACTIVATION_EMPLOYER_MISSING` | `employerAddress` | Employer context was supplied but empty. |
| `ACTIVATION_EMPLOYER_INVALID` | `employerAddress` | Employer address is not a valid Stellar address. |
| `ACTIVATION_EMPLOYER_SAME_AS_EMPLOYEE` | `employerAddress` | Employer and employee addresses are identical. |
| `ACTIVATION_SALARY_INVALID` | `salary` | Salary is not a positive `bigint`. |
| `ACTIVATION_ASSET_MISSING` | `asset` | No payout asset was supplied. |
| `ACTIVATION_ASSET_INVALID` | `asset` | Asset is not `"native"` and not a valid asset code/contract ID. |
| `ACTIVATION_REFERENCE_ID_INVALID` | `referenceId` | A supplied reference ID is malformed (3–64 chars, `[A-Za-z0-9_-]`). |

The employee `profile` is a structural subset of the SDK's employee shapes
(`address`, `status`, `isBlocked`, `salary`, `asset`, `referenceId`), so it
works with registry entries, eligibility records, and draft recipients alike.
The asset may be given as a string (`"native"`, `"USDC"`, a contract ID) or as
an object with a `code` field.

---

## Error handling guarantees

- Failures return a discriminated result (`ok: true | false`) — or throw the
  typed `EmployeeActivationPrerequisiteError` when using the `...OrThrow`
  variant.
- Every issue carries a **stable machine-readable code** plus a sanitized,
  human-readable message with actionable guidance.
- Rejected values are **never echoed back** into messages or issues — invalid
  addresses and other rejected input cannot leak through error text.
- Statuses that are unknown/absent do not block activation; only definitively
  blocked or terminated/offboarded records are rejected.

---

## Integration example: guard a batch onboarding flow

```ts
const candidates = draft.employees.map((e) => ({
  profile: e,
  employerAddress: employerPublicKey,
}));

const failures = candidates
  .map((c) => ({ c, r: validateEmployeeActivationPrerequisites(c) }))
  .filter(({ r }) => !r.ok);

if (failures.length > 0) {
  // Surface per-employee issues in the dashboard before submitting anything.
  return;
}

// All clear — build and submit the activation transactions.
```
