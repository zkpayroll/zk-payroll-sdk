# Treasury Reservation Retry Reconciliation

Implements reconciliation of treasury fund reservation totals across batch execution and retry cycles in the ZK Payroll SDK.

## Overview

When individual payouts within a payroll run fail on-chain, retry procedures are triggered. During this process, treasury reservations must be updated to prevent overallocation or orphaned reserved funds:
- **Settled payouts**: Decrement active reservations and record confirmed transfers.
- **Permanently failed payouts**: Release allocated reservations back into unreserved company treasury.
- **Pending retries**: Maintain accurate reservations until subsequent attempt resolution.

## API

```typescript
import {
  reconcileTreasuryReservationsAfterRetries,
  assertTreasuryReservationReconciliation,
  RetrySettlementOutcome
} from "@zk-payroll/core";

const outcomes: RetrySettlementOutcome[] = [
  { payoutId: "p-1", originalReservedAmount: 5000n, status: "SETTLED" },
  { payoutId: "p-2", originalReservedAmount: 3000n, status: "RETRY_PENDING", retryAttempt: 1 },
  { payoutId: "p-3", originalReservedAmount: 2000n, status: "FAILED_PERMANENT" },
];

const result = reconcileTreasuryReservationsAfterRetries({
  initialReservedAmount: 10000n,
  outcomes,
});

console.log(result.reconciledReservedAmount); // 3000n
console.log(result.releasedAmount);           // 2000n
console.log(result.settledAmount);            // 5000n
```

## Privacy Guarantees

All reconciliation errors derive from `SafePayrollError`. Error messages strictly omit employee identities and salary details to maintain confidentiality during troubleshooting.
