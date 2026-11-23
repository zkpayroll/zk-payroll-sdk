# Deterministic Same-Ledger Settlement Event Sorting

Ensures repeatable, deterministic sorting for settlement events that occur within the same Stellar ledger block.

## Motivation

When multiple settlement operations confirm in the same block, RPC queries and indexers may return events in varying orders depending on pagination or node configurations.
Deterministic sorting establishes a canonical order:
1. Ledger sequence number
2. Transaction block index (`txIndex`)
3. Event transaction index (`eventIndex`)
4. Event ID or paging token
5. Transaction hash
6. Event type name
7. Contract ID

## Usage

```typescript
import {
  sortSettlementEventsDeterministically,
  isEventsSortedDeterministically
} from "@zk-payroll/core";

const sortedEvents = sortSettlementEventsDeterministically(rawEvents);
```
