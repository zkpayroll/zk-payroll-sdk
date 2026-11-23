# Payout Batch Retry Errors

> **File:** `packages/core/src/batches/retryState.ts`
> **Validation:** `packages/core/src/batches/retryValidation.ts`
> **Tests:** `packages/core/tests/batches/payout-batch-retry-errors.test.ts`

---

## Overview

Payout retry tooling is used by different operators, often hours apart, against
batches that contain salary data. Retry failures must therefore be actionable
without becoming a side channel for amounts, recipients, employee records, or
free-text processor notes; those values are never echoed.

Every retry-state failure has:

1. a stable machine code (`PayoutBatchRetryStateErrorCode`),
2. a canonical privacy-safe operator message
   (`PAYOUT_BATCH_RETRY_STATE_ERROR_MESSAGES`), and
3. optional structured context limited to field names, versions, counts, and
   statuses.

## Public helpers

```typescript
import {
  isPayoutBatchRetryStateError,
  getPayoutBatchRetryStateErrorMessage,
  formatPayoutBatchRetryStateError,
} from "@zk-payroll/core";

try {
  assertValidPayoutBatchRetryUpdate(current, proposed);
} catch (error) {
  if (isPayoutBatchRetryStateError(error)) {
    log(getPayoutBatchRetryStateErrorMessage(error));
    log(formatPayoutBatchRetryStateError(error));
  }
}
```

- `isPayoutBatchRetryStateError()` recognizes class instances and plain
  serialized errors carrying `retryCode` or `code`.
- `getPayoutBatchRetryStateErrorMessage()` returns the canonical message for the
  code. It never returns an arbitrary `error.message`.
- `formatPayoutBatchRetryStateError()` appends one `[field] message` entry per
  validation issue, in stable order. It also accepts an array of issues.

Unknown errors receive a generic fallback:
"A payout batch retry error occurred. Verify the retry state and try again."

## Privacy contract

Safe context keys include `field`, `code`, `issueCount`, `version`,
`expectedVersion`, `attempt`, `maxAttempts`, `itemId`, `outstandingCount`, and
`status`. Anything else — especially text fields — is dropped from the error
context before the error is constructed.

Canonical examples:

| Code | Operator-facing message |
| --- | --- |
| `VERSION_MISMATCH` | `Payout batch retry state changed since it was read. Refresh the batch and retry.` |
| `ITEM_ALREADY_SETTLED` | `A settled payout cannot be retried; remove it from the retry payload to avoid paying it twice.` |
| `INVALID_TIMESTAMP` | `The retry-state timestamp must be a valid, non-future epoch millisecond value.` |
| `INVALID_HASH` | `The payout batch retry state hash is invalid or does not match its contents.` |

Never log `error.cause` verbatim when the cause comes from a payment processor;
it may contain recipient or amount details not owned by this SDK.

## Integrity diagnostics

`PayoutBatchRetryStateManager.verifyHistoryIntegrity()` reports broken hash
links as:

```text
Integrity check failed: hash link broken at revision 4.
```

A mismatch in a revision's own hash uses the same `Integrity check failed:`
prefix. Treat either result as a stop condition: refresh the authoritative
retry ledger and escalate instead of rewriting history.

## Related documentation

- [Auditor Grant Expiry](./auditor-grant-expiry.md) — the analogous expiry
  validation and safe-error surface for auditor access.
