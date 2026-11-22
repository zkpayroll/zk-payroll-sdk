# Retention Policy Updates

Payroll retention policies govern how long payroll artifacts must be retained for compliance. Because premature reduction or unauthorized legal-hold release can destroy compliance evidence, retention updates are immutable, versioned, and hash-chained.

## Overview

The retention policy module (`packages/core/src/retention`) provides:

- **State transitions**: `applyRetentionPolicyUpdate()` and `RetentionPolicyStateManager` enforce optimistic concurrency, lifecycle transitions, statutory floors, legal holds, and tamper-evident hash chains.
- **Typed validation (#909)**: `validateRetentionPolicyUpdate()` and `validateRetentionPolicyState()` accumulate structural issues and return safe, machine-readable results. Throwing `assertValidRetentionPolicyUpdate()` / `assertValidRetentionPolicyState()` are available for fail-fast flows.
- **Safe errors (#910)**: `RetentionPolicyError` carries stable `retentionCode`, structured `issues`, and sanitized context. `formatRetentionPolicyError()` and `redactPolicyActorId()` produce actionable diagnostics without exposing salaries, employee identifiers, secrets, or full operator IDs.
- **Boundary coverage (#911)**: Focused tests cover statutory floor boundaries, min/max limits, clock-skew and timestamp regression, lifecycle transitions, legal-hold protection, and hash-integrity failures.

## Lifecycle States

| Status | Meaning | Allowed next states |
|---|---|---|
| `draft` | Policy being prepared | `active`, `suspended` |
| `active` | Enforced policy | `active`, `superseded`, `suspended` |
| `suspended` | Temporarily paused for review | `active`, `superseded` |
| `superseded` | Replaced by a newer revision | Terminal |

## Update Invariants

1. **Optimistic concurrency**: New policies require `expectedVersion: 0`; updates require `expectedVersion === current.version`.
2. **Immutable revisions**: Each accepted update increments `version` by 1, links `previousHash` to the prior hash, and computes a SHA-256 `hash`.
3. **Statutory floor**: `retentionDays` must be >= `DEFAULT_STATUTORY_RETENTION_FLOOR_DAYS` (2555 days) unless a stricter custom floor is configured.
4. **Bounds**: `retentionDays >= minimumRetentionDays`; when present, `maximumRetentionDays >= retentionDays`.
5. **Legal hold**: While `legalHoldActive` is true, retention cannot be reduced and legal hold cannot be released without `allowLegalHoldRelease: true`.
6. **Timestamps**: `timestampMs` must be positive, not beyond allowed clock skew, and not before `current.updatedAtMs`. `effectiveAtMs` defaults to `timestampMs`.
7. **No-op rejection**: Updates that change no effective policy fields are rejected as `RETENTION_POLICY_NO_OP_UPDATE`.
8. **Privacy**: `updateReason`, `updatedBy`, and metadata are scanned for sensitive payroll/credential terms and rejected with `RETENTION_POLICY_SENSITIVE_DATA_DETECTED`.

## Typed Validation API

```ts
import {
  validateRetentionPolicyUpdate,
  assertValidRetentionPolicyUpdate,
  validateRetentionPolicyState,
  assertValidRetentionPolicyState,
} from "@zk-payroll/core";

const result = validateRetentionPolicyUpdate(currentPolicy, input, { now: Date.now() });
if (!result.isValid) {
  // result.issues contains stable code/field/message/suggestedFix entries
}

const transition = assertValidRetentionPolicyUpdate(currentPolicy, input);
const snapshot = assertValidRetentionPolicyState(transition.updatedPolicy);
```

## Safe Error Model

`RetentionPolicyError` extends `ZkPayrollError` and includes:

- `retentionCode`: stable `RetentionPolicyErrorCode`
- `issues`: frozen structured validation issues
- sanitized `context`: no salary/employee/secret/metadata/reason leakage

Helpers:

- `isRetentionPolicyError(error)` - type guard for caught errors
- `getRetentionPolicyErrorMessage(error)` - stable safe message
- `formatRetentionPolicyError(error | issues)` - actionable formatted output
- `redactPolicyActorId(actorId)` - redacts operator IDs for diagnostics

## Error Codes

| Code | Meaning |
|---|---|
| `RETENTION_POLICY_ID_REQUIRED` | Missing/invalid/mismatched policy identifier |
| `RETENTION_POLICY_ACTOR_REQUIRED` | Missing/invalid actor identity |
| `RETENTION_POLICY_REASON_REQUIRED` | Missing/invalid update justification |
| `RETENTION_POLICY_VERSION_MISMATCH` | Expected version conflict or invalid version |
| `RETENTION_POLICY_VERSION_REGRESSION` | Timestamp regressed before current revision |
| `RETENTION_POLICY_INVALID_RETENTION_DAYS` | Invalid retention day value or bounds |
| `RETENTION_POLICY_STATUTORY_MINIMUM_VIOLATION` | Below statutory/configured floor |
| `RETENTION_POLICY_LEGAL_HOLD_CONFLICT` | Illegal reduction/release under legal hold |
| `RETENTION_POLICY_POLICY_NOT_FOUND` | Update requested for unknown policy |
| `RETENTION_POLICY_NO_OP_UPDATE` | No effective change detected |
| `RETENTION_POLICY_INVALID_TIMESTAMP` | Invalid/future/regressive timestamp |
| `RETENTION_POLICY_INVALID_STATE_TRANSITION` | Disallowed lifecycle transition |
| `RETENTION_POLICY_CONCURRENT_MODIFICATION` | Concurrent update detected |
| `RETENTION_POLICY_SENSITIVE_DATA_DETECTED` | Sensitive terms found in reason/actor/metadata |
| `RETENTION_POLICY_INVALID_HASH` | Snapshot hash/previousHash invalid or tampered |

## Privacy Guarantees

- Error messages and issue details never include salary amounts, employee identifiers, secrets, or raw sensitive metadata values.
- Actor IDs should be reported via `redactPolicyActorId()` in logs/UI.
- Hash-chain integrity can be verified with `RetentionPolicyStateManager.verifyHistoryIntegrity()`.
