# Beneficiary change verification

Changing an employee's payout destination is a security-sensitive payroll
operation. A mistaken or malicious change can redirect every later payout, so
the SDK treats a beneficiary change as a two-step confirmation rather than a
single field update:

1. **Request** the change with a caller-minted, time-boxed verification token.
2. **Verify** the request by presenting that token back before it expires.
3. Optionally **apply** the verified change once, through the caller's normal
   employee-update path.

The raw current and proposed destinations never appear in the review payload
or in state snapshots. Only masked previews, the destination kind, a risk
level, and warnings are carried forward.

## Stateless helpers

`requestBeneficiaryChange()` validates and reviews the destination change with
`reviewPayoutDestinationChange()` before any token is accepted. Invalid,
unchanged, or malformed destinations are rejected before a request exists.

```typescript
import {
  requestBeneficiaryChange,
  verifyBeneficiaryChange,
} from "@zk-payroll/core";

const requested = requestBeneficiaryChange({
  requestId: "beneficiary-change-42",
  employeeId: "EMP-001",
  currentDestination: currentPayoutAddress,
  proposedDestination: newPayoutAddress,
  verificationToken: serverMintedToken,
  expiresAt: Date.now() + 15 * 60 * 1000,
});

if (!requested.ok) {
  // Stable code, safe message. Never contains a raw destination.
  console.error(requested.code, requested.message);
} else {
  const verified = verifyBeneficiaryChange(
    requested.request,
    presentedToken,
    Date.now()
  );
  if (verified.ok) {
    await applyEmployeePayoutDestination(verified.employeeId, verified.review);
  }
}
```

### Request rules

| Condition | Result code |
| --- | --- |
| Missing or blank `requestId` | `REQUEST_ID_REQUIRED` |
| Missing or blank `employeeId` | `EMPLOYEE_ID_REQUIRED` |
| Missing or blank verification token | `TOKEN_REQUIRED` |
| Non-finite `expiresAt` | `INVALID_EXPIRY` |
| Current destination invalid | `CURRENT_DESTINATION_INVALID` |
| Proposed destination invalid | `PROPOSED_DESTINATION_INVALID` |
| Proposed destination equals the current one | `DESTINATION_UNCHANGED` |

`expiresAt` may be in the past. The request is created but is immediately
expired, which keeps the helper deterministic and lets callers report expiry
the same way whether it was detected at request time or verification time.

The returned request and its review are frozen. Mutating either after creation
has no effect.

### Verification rules

Expiry is checked **before** the token comparison. An expired request reports
`REQUEST_EXPIRED` even when the correct token is presented, so a caller cannot
learn whether a guessed token would have matched by watching the error code
change.

| Condition | Result code |
| --- | --- |
| Malformed request object | `INVALID_REQUEST` |
| Non-finite verification time | `INVALID_TIMESTAMP` |
| `now >= expiresAt` | `REQUEST_EXPIRED` |
| Missing or empty presented token | `TOKEN_REQUIRED` |
| Presented token does not match | `TOKEN_MISMATCH` |
| Correct token before expiry | `ok: true` |

Verification at `now === expiresAt` is rejected. Any moment strictly before
`expiresAt` is accepted.

## Hardened state handling

Use `BeneficiaryChangeStateManager` when requests are persisted, retried, or
handled by different operators. The manager records immutable, hash-chained
revisions and enforces the lifecycle that the stateless helpers cannot enforce
on their own.

```typescript
import { BeneficiaryChangeStateManager } from "@zk-payroll/core";

const changes = new BeneficiaryChangeStateManager({
  maxVerificationAttempts: 5,
});

changes.requestChange(
  {
    requestId: "beneficiary-change-42",
    employeeId: "EMP-001",
    currentDestination: currentPayoutAddress,
    proposedDestination: newPayoutAddress,
    verificationToken: serverMintedToken,
    expiresAt: Date.now() + 15 * 60 * 1000,
  },
  { now: Date.now() }
);

const result = changes.verifyChange("beneficiary-change-42", presentedToken, Date.now());
if (result.ok) {
  changes.markApplied("beneficiary-change-42");
}
```

### Lifecycle

```text
pending ──► verified ──► applied
   │            │
   ├──► expired └──► expired
   │
   └──► locked
```

| Status | Meaning | Can transition to |
| --- | --- | --- |
| `pending` | Awaiting verification | `verified`, `expired`, `locked` |
| `verified` | Token accepted; not yet applied | `applied`, `expired` |
| `applied` | Change completed | Terminal |
| `expired` | Expiry reached before verification | Terminal |
| `locked` | Too many failed token presentations | Terminal |

### State hardening guarantees

- **Unique request ids.** `requestChange()` rejects a duplicate `requestId`
  with `DUPLICATE_REQUEST_ID` instead of overwriting pending or completed
  state.
- **Single use.** Once a request is verified, another `verifyChange()` call
  returns `REQUEST_ALREADY_VERIFIED`. After `markApplied()` it returns
  `REQUEST_ALREADY_APPLIED`. The same token cannot be replayed.
- **Bounded guessing.** Each wrong token increments `attemptCount`. Reaching
  `maxVerificationAttempts` (default `5`) moves the request to `locked`; later
  attempts return `VERIFICATION_ATTEMPTS_EXHAUSTED`.
- **Expiry is recorded.** Verifying at or after `expiresAt` moves a pending
  request to `expired`, so a later attempt cannot revive it.
- **Apply only after verify.** `markApplied()` on a pending request returns
  `REQUEST_NOT_VERIFIED`; an applied request is terminal.
- **Immutable snapshots.** Each revision is frozen and carries `version`,
  `previousHash`, and `hash`.
- **Tamper-evident history.** `verifyHistoryIntegrity(requestId)` recomputes
  the SHA-256 chain and reports the first broken revision.

### State snapshot

`getState(requestId)` returns the latest `BeneficiaryChangeState`. It contains
the request id, employee id, status, version, attempt counts, timestamps,
machine-readable failure code, and the masked review. It deliberately omits
the verification token.

`getHistory(requestId)` returns every revision oldest-first, which is useful
for audit tooling and incident review.

Persist snapshots durably alongside employee records in production. The
in-memory manager demonstrates the validation and history semantics a durable
store should mirror; it is not a substitute for transactional storage.

## Privacy guarantees

- Raw payout destinations are never included in requests, reviews, snapshots,
  or error messages; only `preview`, `kind`, `risk`, and `warnings` are kept.
- Verification tokens are never written to snapshots or history.
- Failure codes are machine-readable. Free-text notes, salary values, and
  employee records are not accepted by the workflow.
- Error messages describe the failed field and remediation without echoing
  the rejected destination or token.

## Clock and persistence guidance

The SDK does not read the clock inside the pure request/verify helpers. Pass
`now` explicitly so expiry is deterministic and testable. The state manager
accepts `{ now }` when recording a request and explicit `now` values on
`verifyChange()` and `markApplied()`.

When restoring state after a restart, re-register persisted revisions with
`registerState()` and verify the chain with `verifyHistoryIntegrity()` before
accepting new operations. If the chain is broken, stop and escalate rather
than overwriting the affected request.
