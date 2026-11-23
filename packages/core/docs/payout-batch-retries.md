# Payout batch retries

Payout batches can partially settle: some payouts succeed, others fail, and a
recovery job may retry only the remaining items. Retry state must therefore be
treated as a ledger, not as a mutable flag. A stale write or a retry payload that
still contains a settled payout can pay the same employee twice.

`packages/core/src/batches/retryState.ts` and
`packages/core/src/batches/retryValidation.ts` provide the documented retry
behavior:

- **State machine** — explicit, versioned transitions with terminal states.
- **Attempt accounting** — a bounded number of retry starts, with the limit
  fixed when the batch is initialized.
- **Item-set monotonicity** — outstanding items may only leave the set; settled
  items can never return to it.
- **Optimistic concurrency** — an update must name the exact version it read.
- **Tamper-evident history** — each revision is frozen and SHA-256 hash-chained.
- **Typed validation** — non-throwing validators for proposed updates and
  persisted snapshots.
- **Privacy-safe errors** — machine-readable failure codes and actionable
  messages, never employee or salary values.

This guide covers **batch-level retry state**. It is distinct from
`evaluateFailedPayoutRetryEligibility()`, which decides whether one failed
payout is eligible for retry, `PartialBatchFailureManager`, which partitions
settled and failed items, and the transport-level `withRetry()` policy
described in [RETRY_POLICY.md](../../docs/RETRY_POLICY.md).

## Public API

```typescript
import {
  DEFAULT_PAYOUT_BATCH_MAX_RETRY_ATTEMPTS,
  DEFAULT_RETRY_STATE_MAX_CLOCK_SKEW_MS,
  PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES,
  PayoutBatchRetryStateError,
  PayoutBatchRetryStateManager,
  PayoutBatchRetryStateErrorCode,
  applyPayoutBatchRetryUpdate,
  assertValidPayoutBatchRetryState,
  assertValidPayoutBatchRetryUpdate,
  computePayoutBatchRetryStateHash,
  isPayoutBatchRetryStateError,
  validatePayoutBatchRetryState,
  validatePayoutBatchRetryUpdate,
} from "@zk-payroll/core";
```

## Typical flow

```typescript
import { PayoutBatchRetryStateManager } from "@zk-payroll/core";

const retries = new PayoutBatchRetryStateManager();

retries.initializeBatch("batch-42", ["payout-1", "payout-2", "payout-3"], {
  updatedBy: "operator-1",
  maxAttempts: 3,
  timestampMs: Date.now(),
});

const result = retries.update({
  batchId: "batch-42",
  expectedVersion: 1,
  targetStatus: "retrying",
  updatedBy: "operator-2",
  settledItemIds: ["payout-2"],
  lastErrorCode: "RPC_TIMEOUT",
  timestampMs: Date.now(),
});

// result.state.version === 2, result.state.attempt === 1
// result.state.outstandingItemIds === ["payout-1", "payout-3"]
```

`initializeBatch()` requires `expectedVersion: 0` and creates a `pending`
revision at version `1`. Later updates must use the exact current version. A
successful update increments the version by one and returns a frozen snapshot;
the manager records that snapshot in its history.

## Lifecycle

```text
pending ──► failed ──► retrying ──► completed
   │           │          │
   │           │          ├──► failed
   │           │          └──► exhausted
   │           └──► exhausted
   ├──► retrying
   ├──► completed
   └──► exhausted
```

| Status | Meaning | Allowed next states |
| --- | --- | --- |
| `pending` | Batch initialized; no retry started yet | `failed`, `retrying`, `completed`, `exhausted` |
| `failed` | A retryable failure was recorded | `retrying`, `exhausted` |
| `retrying` | A retry attempt is in progress | `retrying`, `failed`, `completed`, `exhausted` |
| `completed` | Every payout settled | Terminal |
| `exhausted` | Attempt limit reached with items still outstanding | Terminal |

`completed` and `exhausted` are terminal: every later update is rejected with
`PAYOUT_BATCH_RETRY_TERMINAL_STATE`. `pending -> completed` and
`pending -> exhausted` are allowed so an empty or non-retryable batch can be
closed without a failed retry cycle. Marking a batch `failed` requires at least
one outstanding item.

## Update invariants

Validation happens in a fixed order so callers receive a deterministic code
when several fields are wrong.

1. **Identity and actor.** `batchId` and `updatedBy` must be non-empty strings;
   identifiers are trimmed and bounded to 200 characters.
2. **Optimistic concurrency.** Creating a state requires
   `expectedVersion === 0`; updating requires equality with the current
   `version`. A mismatch is a conflict, not an overwrite.
3. **Lifecycle.** The target status must be recognized, the current status must
   not be terminal, and the transition must appear in
   `ALLOWED_PAYOUT_BATCH_RETRY_TRANSITIONS`.
4. **Attempt accounting.** `maxAttempts` is a positive safe integer (default
   `3`) and cannot change after initialization. An attempt is consumed only when
   transitioning from `pending` or `failed` to `retrying`; repeated `retrying`
   snapshots do not consume another attempt. The attempt that reaches
   `maxAttempts` is allowed; the next `retrying` start is rejected.
5. **Item sets.** Item ids must be unique, non-empty strings of at most 200
   characters. Newly settled ids must be in the current outstanding set and
   can never be settled twice. The resulting outstanding set must be a subset
   of the previous one; omitting `outstandingItemIds` means "previous
   outstanding minus newly settled". A `completed` batch must have no
   outstanding items.
6. **Failure code.** `lastErrorCode` must match
   `^[A-Z0-9][A-Z0-9_:-]{0,63}$`. Free-text failure reasons are rejected so
   salary data cannot enter the retry ledger.
7. **Timestamp.** `timestampMs` must be a positive, finite epoch-millisecond
   value no more than `maxClockSkewMs` (default `5000`) ahead of `now`, and it
   must not be earlier than the previous revision's `updatedAtMs`.
8. **No-op rejection.** An update that changes no status, attempt, item set, or
   failure code is rejected instead of creating a meaningless revision.
9. **Immutable revision.** The accepted state is frozen, its `version`
   increments, and its `hash` is recomputed over the canonical field order using
   `zkpayroll:payout-batch-retry:v1`; `previousHash` links to the prior hash or
   the 64-zero genesis hash.

### Boundaries at a glance

| Boundary | Accepted | Rejected |
| --- | --- | --- |
| `maxAttempts` | `1`, `3`, other positive safe integers | `0`, negatives, fractions, unsafe integers |
| Attempts with `maxAttempts: 1` | First `pending/failed -> retrying` | The next `retrying` start |
| Clock skew with default options | `timestampMs === now + 5000` | `now + 5001` |
| Timestamp regression | `timestampMs === previous.updatedAtMs` | One millisecond earlier |
| Version | Current version, or `0` at creation | Any stale or future version |
| Item id length | 200 characters | 201 characters |
| Failure code | `RPC_TIMEOUT`, `LEDGER:INSUFFICIENT-FUNDS` | `operator said no`, lowercase free text |
| Outstanding set | Same or smaller subset | Previously unknown id or previously settled id |
| Completion | No outstanding items | Any outstanding item |

## Failure codes and safe remediation

Errors throw `PayoutBatchRetryStateError`, which extends `ZkPayrollError` and
carries a stable `retryCode`. Safe messages are keyed by code in
`PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES`; version conflicts and future
timestamps use fixed, equally safe diagnostic messages. Dynamic diagnostics only
include versions, counts, statuses, or field names.

| `retryCode` | Meaning and caller action |
| --- | --- |
| `PAYOUT_BATCH_RETRY_BATCH_ID_REQUIRED` | Supply a non-empty batch identifier. |
| `PAYOUT_BATCH_RETRY_ACTOR_REQUIRED` | Record the operator identity authorizing the change. |
| `PAYOUT_BATCH_RETRY_NOT_FOUND` | Initialize the batch before updating it. |
| `PAYOUT_BATCH_RETRY_VERSION_MISMATCH` | Refresh the batch and reapply the update to the latest version. |
| `PAYOUT_BATCH_RETRY_INVALID_STATUS` | Use one of the five documented statuses. |
| `PAYOUT_BATCH_RETRY_INVALID_STATE_TRANSITION` | Check the lifecycle table before retrying. |
| `PAYOUT_BATCH_RETRY_TERMINAL_STATE` | Open a new batch; closed batches are immutable. |
| `PAYOUT_BATCH_RETRY_ATTEMPTS_EXHAUSTED` | Close the batch and escalate remaining failures. |
| `PAYOUT_BATCH_RETRY_INVALID_MAX_ATTEMPTS` | Use a positive safe integer at initialization only. |
| `PAYOUT_BATCH_RETRY_INVALID_ITEM_SET` | Use unique, non-empty item ids within the length limit. |
| `PAYOUT_BATCH_RETRY_ITEM_ALREADY_SETTLED` | Remove the settled item from the retry payload. |
| `PAYOUT_BATCH_RETRY_UNKNOWN_OUTSTANDING_ITEM` | Reload the batch; the item is not currently outstanding. |
| `PAYOUT_BATCH_RETRY_OUTSTANDING_ITEMS_REMAIN` | Settle or explicitly remove remaining items before completion. |
| `PAYOUT_BATCH_RETRY_INVALID_ERROR_CODE` | Use a short machine-readable failure code, not free text. |
| `PAYOUT_BATCH_RETRY_INVALID_TIMESTAMP` | Use a valid, non-future epoch-millisecond timestamp. |
| `PAYOUT_BATCH_RETRY_TIMESTAMP_REGRESSION` | Use a timestamp at or after the last revision. |
| `PAYOUT_BATCH_RETRY_NO_OP_UPDATE` | Include an actual state change or skip the update. |
| `PAYOUT_BATCH_RETRY_INVALID_HASH` | Stop and investigate the persisted snapshot before trusting it. |

Use `isPayoutBatchRetryStateError(error)` when catching these failures. Error
messages never echo amounts, recipients, employee records, or rejected free
text.

## Typed validation

Forms, recovery tools, and import jobs can collect all structural problems
instead of catching exceptions:

```typescript
import {
  validatePayoutBatchRetryState,
  validatePayoutBatchRetryUpdate,
} from "@zk-payroll/core";

const proposed = validatePayoutBatchRetryUpdate(current, input, { now: Date.now() });
if (!proposed.isValid) {
  for (const problem of proposed.issues) {
    console.error(problem.code, problem.field, problem.message);
  }
} else {
  persist(proposed.state!);
}

const snapshot = validatePayoutBatchRetryState(loadedState);
if (!snapshot.isValid) {
  stopAndEscalate(snapshot.issues);
}
```

`validatePayoutBatchRetryUpdate()` shares the state machine rules with
`applyPayoutBatchRetryUpdate()` and returns the resulting state on success.
`validatePayoutBatchRetryState()` checks a persisted snapshot and recomputes its
hash. `assertValidPayoutBatchRetryUpdate()` and
`assertValidPayoutBatchRetryState()` provide throwing variants for
fail-fast callers.

Validation issues contain a stable code, field path, safe message, and optional
structured context. Context may contain item ids, versions, counts, or field
names; it never contains payout amounts, recipient addresses, employee records,
salary values, or free-text notes.

## History integrity and persistence

`PayoutBatchRetryStateManager` is an in-memory coordinator. It demonstrates the
semantics a durable store must mirror; production deployments should persist
each frozen revision transactionally with the payroll records it represents.

```typescript
const history = retries.getHistory("batch-42");
const integrity = retries.verifyHistoryIntegrity("batch-42");

if (!integrity.valid) {
  throw new Error(`Retry history is broken at revision ${integrity.brokenAt}`);
}
```

`verifyHistoryIntegrity()` checks that every `previousHash` matches the prior
revision and that every `hash` matches its contents. An unknown batch reports
`{ valid: true }`, so call `getState()` separately when existence matters.
On restart, re-register persisted revisions with `registerState()` and verify
the chain before accepting new updates. If a chain is broken, stop and escalate
rather than overwriting the affected revision.

Pass explicit `timestampMs` and `now` values in recovery tooling so transitions
are deterministic. The default clock-skew tolerance is `5000` ms and can be
overridden with `maxClockSkewMs`.

## Privacy guarantees

- The retry ledger stores payout item ids, operator identity, statuses,
  versions, timestamps, machine failure codes, and hashes only.
- Amounts, recipient addresses, employee records, salary values, and free-text
  failure reasons are not accepted by `applyPayoutBatchRetryUpdate()`.
- Failure codes are constrained to uppercase machine-readable identifiers.
- Error messages and validation issues describe the failed field and the
  remediation without echoing private payroll data.
- Snapshots are frozen, so a caller cannot mutate ledger history in place.

## Related behavior

- [Per-payout retry eligibility](../../docs/API.md#evaluatefailedpayoutretryeligibilityinput-failedpayoutretryeligibility)
  decides whether an individual failure may be retried.
- `PartialBatchFailureManager` partitions settled and failed items before a
  retry payload is built.
- [Partial retry payout totals](partial-retry-payout-totals.md) explains how
  totals are calculated when only some items settle.
- [Error handling](../../docs/ERRORS.md) and
  [retry policy](../../docs/RETRY_POLICY.md) describe transport-level retries,
  which are independent of batch retry state.
