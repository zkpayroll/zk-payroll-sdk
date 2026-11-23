# Payout Totals and Reserved Funds Comparison

Verifies that executed or proposed payout amounts do not exceed previously allocated treasury reservations.

## Overview

Treasury reservations lock liquidity commitments prior to payout execution. The comparison helper validates final settlement figures against reservations:
- **Exact match**: All reserved funds are utilized.
- **Surplus reserve**: Reserved funds exceed executed payouts; remaining funds are eligible for release.
- **Deficit overallocation**: Executed payouts exceed reserved liquidity; blocked with actionable error.

## API

```typescript
import {
  comparePayoutTotalWithReservedFunds,
  assertPayoutWithinReservedFunds,
  PayoutItem
} from "@zk-payroll/core";

const payouts: PayoutItem[] = [
  { payoutId: "p-1", amount: 6000n },
  { payoutId: "p-2", amount: 4000n },
];

const result = comparePayoutTotalWithReservedFunds({
  reservedAmount: 10000n,
  payouts,
});

console.log(result.isSatisfied); // true
console.log(result.status);      // "EXACT_MATCH"
```

## Privacy Guarantees

When verification fails, `SafePayoutReservationMismatchError` is raised. The error message reports shortfall amounts without detailing individual employee identifiers or salary amounts.
