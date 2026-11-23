# Retention Purge Guard

Protects privacy and audit compliance by blocking retention purge helpers while any settlement batch is in a pending or in-flight state.

## Why This Matters

Executing a retention purge while a payroll settlement transaction is in-flight could destroy pending receipts, audit hashes, or transaction metadata necessary for:
- Detecting duplicate or replay transactions.
- Finalizing on-chain payouts and confirming balances.
- Generating cryptographic proofs or addressing settlement failures.

## Usage

```typescript
import {
  purgeRetentionRecords,
  assertRetentionPurgeAllowed,
  RetentionPurgeBlockedError
} from "@zk-payroll/core";

// Check before purging
assertRetentionPurgeAllowed({ settlementStatus: "settled" });

// Safe purge
const { remainingRecords, purgedCount } = purgeRetentionRecords(records, {
  settlementStatus: "settled",
  referenceTimeMs: Date.now(),
});
```

## Error Handling

If an attempt is made to purge records while settlement is pending:

```typescript
try {
  purgeRetentionRecords(records, { settlementStatus: "pending" });
} catch (err) {
  if (err instanceof RetentionPurgeBlockedError) {
    console.error(err.code); // ERR_RETENTION_PURGE_BLOCKED_PENDING_SETTLEMENT
    console.error(err.remediation);
  }
}
```

Error messages are sanitized and never expose private employee, salary, or company treasury data.
