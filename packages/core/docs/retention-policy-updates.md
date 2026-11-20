# Retention policy updates

Payroll retention policies govern how long encrypted payroll records, audit packages, and compliance artifacts must be retained to satisfy statutory obligations while protecting employee privacy. Because a premature reduction or unauthorized legal-hold release can destroy compliance evidence, the SDK manages retention policies through an immutable, versioned, hash-chained workflow.

## Overview

The retention policy module (`@zk-payroll/core`) provides:

1. **Hardened state transitions** via `applyRetentionPolicyUpdate()` and `RetentionPolicyStateManager`.
2. **Non-throwing typed validation** via `validateRetentionPolicyUpdate()` and `validateRetentionPolicyState()` (plus throwing `assert*` counterparts).
3. **Privacy-safe typed errors** via `RetentionPolicyError`, `RetentionPolicyErrorCode`, `formatRetentionPolicyError()`, and `redactPolicyActorId()`.

## Quick start

```typescript
import {
  RetentionPolicyStateManager,
  validateRetentionPolicyUpdate,
  validateRetentionPolicyState,
  formatRetentionPolicyError,
} from "@zk-payroll/core";

const manager = new RetentionPolicyStateManager();

const check = validateRetentionPolicyUpdate(null, {
  policyId: "org-payroll-retention",
  expectedVersion: 0,
  retentionDays: 2555,
  minimumRetentionDays: 2555,
  legalHoldActive: false,
  status: "active",
  updatedBy: "compliance-officer-01",
  updateReason: "Initialize 7-year statutory payroll retention policy",
});

if (!check.isValid) {
  console.error(check.issues);
} else {
  const { updatedPolicy } = await manager.updatePolicy({
    policyId: "org-payroll-retention",
    expectedVersion: 0,
    retentionDays: 2555,
    minimumRetentionDays: 2555,
    updatedBy: "compliance-officer-01",
    updateReason: "Initialize 7-year statutory payroll retention policy",
  });

  const snapshotCheck = validateRetentionPolicyState(updatedPolicy);
  console.log("Snapshot valid:", snapshotCheck.isValid);
}
```

## Lifecycle states

```text
draft ──► active ──► superseded
  │         │ ▲          ▲
  ▼         ▼ │          │
suspended ──┴────────────┘
```

| Status | Meaning | Allowed transitions |
| --- | --- | --- |
| `draft` | Policy is being prepared | `active`, `suspended` |
| `active` | Enforced retention window | `active`, `suspended`, `superseded` |
| `suspended` | Temporarily paused for administrative review | `active`, `superseded` |
| `superseded` | Replaced by a newer policy revision | Terminal (immutable) |

## Statutory floor and legal hold invariants

- **Statutory minimum floor.** By default, `retentionDays` cannot be set below `DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS` (`2555` days / 7 years) unless a custom `statutoryFloorDays` is supplied in `RetentionPolicyValidationOptions`.
- **Configured minimum/maximum bounds.** `retentionDays` must be at least `minimumRetentionDays` and, when `maximumRetentionDays` is configured, at most `maximumRetentionDays`.
- **Active legal hold protection.** While `legalHoldActive` is `true`:
  - `retentionDays` cannot be reduced below the current policy's `retentionDays`.
  - Releasing the legal hold (`legalHoldActive: false`) is rejected with `RETENTION_POLICY_LEGAL_HOLD_CONFLICT` unless `{ allowLegalHoldRelease: true }` is passed in the validation options.
- **Optimistic concurrency.** Initial policy creation requires `expectedVersion: 0`. Every subsequent update must pass `expectedVersion === current.version`, incrementing `version` by `1` and chaining `previousHash` to `current.hash`.

## Typed validation (#909)

Operators, forms, and recovery tools often need to inspect all validation problems at once rather than catching the first thrown exception:

- `validateRetentionPolicyUpdate(current, input, options)` returns `{ isValid, issues, transition, policy }`. It accumulates identifier, actor, reason, metadata privacy, version, status transition, timestamp/clock-skew, statutory floor, and legal-hold issues before executing the transition.
- `assertValidRetentionPolicyUpdate(current, input, options)` returns the `RetentionPolicyTransitionResult` or throws a `RetentionPolicyError` populated with `issues`.
- `validateRetentionPolicyState(policy, options)` validates a persisted `RetentionPolicy` snapshot and recomputes its SHA-256 hash (`computeRetentionPolicyHash`) to detect tampering.
- `assertValidRetentionPolicyState(policy, options)` returns the validated snapshot or throws a `RetentionPolicyError`.

## Safe errors and privacy guarantees (#910)

All error messages and structured issues are designed to be logged or displayed without leaking sensitive payroll information:

- **Sensitive terminology rejection.** `updateReason`, `updatedBy`, and `metadata` are scanned for prohibited payroll keywords (`salary`, `wage`, `balance`, `ssn`, `secret`, `private_key`, `password`) and rejected with `RETENTION_POLICY_SENSITIVE_DATA_DETECTED`.
- **Actor redaction.** `redactPolicyActorId(actorId)` masks operator identifiers (for example `"compliance_admin_1"` → `"co***_1"`).
- **Actionable formatting.** `formatRetentionPolicyError(error)` combines the canonical message with any field-level `issues` (`[field] message`).

| Error code | Description |
| --- | --- |
| `RETENTION_POLICY_ID_REQUIRED` | Missing, oversized, or mismatched `policyId` |
| `RETENTION_POLICY_ACTOR_REQUIRED` | Missing or oversized `updatedBy` actor identity |
| `RETENTION_POLICY_REASON_REQUIRED` | Missing or oversized `updateReason` justification |
| `RETENTION_POLICY_VERSION_MISMATCH` | Optimistic concurrency conflict or invalid version |
| `RETENTION_POLICY_VERSION_REGRESSION` | Update timestamp regressed before `current.updatedAtMs` |
| `RETENTION_POLICY_INVALID_RETENTION_DAYS` | Non-integer, non-positive, or out-of-range retention days |
| `RETENTION_POLICY_STATUTORY_MINIMUM_VIOLATION` | `retentionDays` is below the statutory compliance floor |
| `RETENTION_POLICY_LEGAL_HOLD_CONFLICT` | Attempted reduction or unauthorized release during an active legal hold |
| `RETENTION_POLICY_NO_OP_UPDATE` | Proposed update makes no configuration changes |
| `RETENTION_POLICY_INVALID_TIMESTAMP` | Non-finite, non-positive, or future timestamp beyond clock skew |
| `RETENTION_POLICY_INVALID_STATE_TRANSITION` | Unrecognized status or disallowed lifecycle transition |
| `RETENTION_POLICY_SENSITIVE_DATA_DETECTED` | Prohibited sensitive terminology in reason, actor, or metadata |
| `RETENTION_POLICY_INVALID_HASH` | Snapshot `hash` or `previousHash` failed SHA-256 verification |
