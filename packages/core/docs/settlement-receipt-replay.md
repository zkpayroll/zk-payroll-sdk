# Settlement receipt replay protection

A settlement receipt proves that a payroll payout already happened. Feeding
the same receipt (or the same on-chain transaction with a new receipt ID) back
into an ingestion or verification pipeline can cause duplicate payouts or
duplicate audit records.

`ReceiptReplayGuard` provides a bounded, in-memory replay window that is
dependency-free and synchronous. It can be used on its own or passed into
`verifyPayrollReceipt()` via the `replayGuard` option.

```typescript
import {
  ReceiptReplayGuard,
  RECEIPT_REPLAY_CODES,
  verifyPayrollReceipt,
} from "@zk-payroll/core";

const replayGuard = new ReceiptReplayGuard({ maxEntries: 5_000 });
const result = verifyPayrollReceipt(receipt, { replayGuard });

if (!result.isValid && result.issues.some((i) => i.code === "RECEIPT_REPLAY")) {
  // Do not reprocess this payout.
}
```

## Decisions

| Code | Meaning |
| --- | --- |
| `RECEIPT_REPLAY_ACCEPTED` | First sighting; safe to process once. |
| `RECEIPT_REPLAY_DUPLICATE_ID` | Same receipt ID and same settlement details seen before. |
| `RECEIPT_REPLAY_CONFLICTING_RECEIPT` | Receipt ID reused with different details; investigate the collision. |
| `RECEIPT_REPLAY_DUPLICATE_TRANSACTION` | On-chain transaction already recorded under another receipt ID. |
| `RECEIPT_REPLAY_INVALID_RECEIPT` | Required receipt fields are missing; no state was changed. |

Normalization rules:

- receipt IDs and string fields are outer-whitespace-trimmed;
- transaction hashes are trimmed and lowercased, so hex casing cannot bypass
  duplicate detection;
- the fingerprint compared for a repeated receipt ID is
  `(payrollId, settlementStatus, metadataDigest, txHash)`.

`inspect()` is read-only. `record()` commits only when the receipt is
accepted; rejected receipts never consume window capacity. `reset()` clears
the window and `size` reports the number of stored receipts.

## Verification integration

When `replayGuard` is supplied to `verifyPayrollReceipt()` (or the async /
batch variants), each receipt that passes the other checks is recorded exactly
once. Replays produce a critical `RECEIPT_REPLAY` issue and an `isValid: false`
result. Malformed or otherwise invalid receipts fail before the guard runs, so
they do not occupy a slot in the replay window.
Guard messages never contain receipt IDs, payroll IDs, hashes or amounts, so
they are safe for UI, logs and telemetry.

## Boundaries and limitations

- `maxEntries` must be a positive integer `<= 100_000` (default: `1_000`);
  invalid values throw a `RangeError` at construction time.
- The window is FIFO: once full, the oldest receipt is evicted to make room.
  A replay of an evicted receipt can no longer be detected from memory alone.
- State is per guard instance. Use one guard per process/pipeline (and durable
  storage for definitive replay protection across restarts).
- Boundary tests covering all of the above live in
  `packages/core/tests/receipt-replay-boundaries.test.ts`.
