# Pagination Helpers — Usage Guide (Issue #47)

Pagination helpers live in `@zk-payroll/core` and support both
**cursor-based** (recommended) and **offset-based** access patterns.

---

## Quick start

```ts
import { getPayrollHistoryPage, getAuditRecordsPage, paginateIterator } from "@zk-payroll/core";
```

---

## Cursor-based pagination (recommended for UI consumers)

Cursor-based pagination is stable across inserts and deletions.
Pass the `nextCursor` from one page into the next request.

```ts
// First page
const page1 = getPayrollHistoryPage(allRecords, { recipient: "GABC..." }, { pageSize: 25 });

// Next page
const page2 = getPayrollHistoryPage(
  allRecords,
  { recipient: "GABC..." },
  { pageSize: 25, cursor: page1.meta.nextCursor }
);

if (!page2.meta.hasNextPage) {
  console.log("Last page reached");
}
```

---

## Offset-based pagination (simpler, for small datasets)

```ts
const page = getPayrollHistoryPage(allRecords, {}, { page2, pageSize: 20 });

console.log(`Page ${page.meta.page} of ${Math.ceil(page.meta.total / page.meta.pageSize)}`);
```

---

## Filtering

Filters are applied before pagination, so `meta.total` always reflects
the filtered count.

### Payroll history filters

| Field           | Type     | Description                              |
| --------------- | -------- | ---------------------------------------- |
| `recipient`     | `string` | Exact match on recipient address         |
| `minAmount`     | `bigint` | Minimum payment amount (stroops)         |
| `maxAmount`     | `bigint` | Maximum payment amount (stroops)         |
| `fromTimestamp` | `number` | Start of range (Unix seconds, inclusive) |
| `toTimestamp`   | `number` | End of range (Unix seconds, inclusive)   |

### Audit record filters

| Field           | Type     | Description                              |
| --------------- | -------- | ---------------------------------------- |
| `action`        | `string` | Exact match on action type               |
| `actor`         | `string` | Exact match on actor address             |
| `fromTimestamp` | `number` | Start of range (Unix seconds, inclusive) |
| `toTimestamp`   | `number` | End of range (Unix seconds, inclusive)   |

---

## Async iterator (server-side streaming)

Use `paginateIterator` to process large datasets page by page without
loading everything into memory.

```ts
for await (const page of paginateIterator(allRecords, { pageSize: 50 })) {
  await processPage(page.data);

  if (!page.meta.hasNextPage) break;
}
```

---

## PaginationMeta reference

```ts
interface PaginationMeta {
  total: number; // Total filtered records
  count: number; // Records in this page
  pageSize: number; // Requested page size
  page: number; // Current page (1-indexed)
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextCursor?: string; // Pass to next request
  prevCursor?: string; // Pass to go back
}
```

---

## Page size limits

| Constant            | Value |
| ------------------- | ----- |
| `DEFAULT_PAGE_SIZE` | 20    |
| `MIN_PAGE_SIZE`     | 1     |
| `MAX_PAGE_SIZE`     | 100   |

Requests outside this range are automatically clamped.

---

# Batch pagination helpers (Issue #102)

The helpers above paginate _views_ of payroll history and audit records.
For **processing** large employee or payroll-recipient collections in
manageable batches, use the batch pagination helpers instead:

```ts
import { getBatchPage, iterateBatches } from "@zk-payroll/core";
```

These are pure, stateless utilities: they only decide which records belong
to the current batch. Ordering is always preserved, records are never
duplicated or skipped across batches, and no payroll data is logged.

## Fetching a single batch

```ts
const batch = getBatchPage(employees, 100, 0); // pageSize, zero-based batch index

batch.items; // Records in this batch (original order)
batch.index; // Zero-based batch index
batch.offset; // Start offset within the collection
batch.count; // Records in this batch
batch.totalItems; // Total records in the collection
batch.totalPages; // Total number of batches
batch.hasNext; // Whether another batch follows
```

An empty collection yields one empty batch with `hasNext = false`.
A batch index beyond the last page returns an empty batch rather than throwing.

## Iterating all batches

```ts
for (const batch of iterateBatches(recipients, 50)) {
  await processRecipientBatch(batch.items);
}
```

Concatenating `items` across all batches reconstructs the original
collection exactly once and in the original order.

Omitting `pageSize` treats the whole collection as a single batch, so
callers that do not opt into pagination keep their existing behavior:

```ts
processBatchPayments(entries); // One pass over all entries
processBatchPayments(entries, 100); // Processed in batches of 100
processBatchPayments(entries, 100, (progress) => {
  console.log(`${progress.percentage}%`, progress.message);
});
```

The optional third argument receives privacy-safe batch lifecycle events with
the current batch, total batch and item counts, and overall percentage. A
failed payment emits a `failed` event and still rejects the operation.

## Validation

Unlike view pagination (which clamps), invalid batch parameters fail fast
with a `ValidationError` so a payroll run never processes records in an
unintended batch size:

| Input                                                       | Behavior                                         |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `pageSize` of `0`, negative, `NaN`, `Infinity`, non-integer | Throws `ValidationError` (`field: "pageSize"`)   |
| Negative or non-integer batch index                         | Throws `ValidationError` (`field: "batchIndex"`) |
| `pageSize` omitted                                          | Whole collection treated as a single batch       |

---

# Pagination guardrails (Issue #500)

Guardrails protect consumers from accidental unbounded pagination requests
and loops when traversing remote or misbehaving paginated sources. They are
available two ways:

- `iteratePayrollPeriods()` / `collectPayrollPeriods()` already apply them to
  payroll period history (page size validation, page budget, repeated-cursor
  detection, abort support).
- For **arbitrary paginated sources** (indexers, RPC endpoints, export
  pipelines), use the generic guarded traversal:

```ts
import { collectGuardedPages, iterateGuardedPages } from "@zk-payroll/core";

const records = await collectGuardedPages(fetchPage, {
  maxPageSize: 100, // clamp every request (default: 100)
  maxPages: 50, // page budget (default: 100, ceiling 10,000)
  maxRecords: 5000, // record budget (default: 10,000)
  signal: controller.signal, // abort support
});

// Or stream record-by-record:
for await (const record of iterateGuardedPages(fetchPage, { maxPages: 50 })) {
  await ingest(record);
}
```

## What is guarded

| Risk                                | Protection                                                   |
| ----------------------------------- | ------------------------------------------------------------ |
| Oversized page requests             | `maxPageSize` clamp on every request                         |
| Endless page chains                 | `maxPages` budget, then a `PAGINATION_BUDGET_EXCEEDED` error |
| Many small pages exhausting memory  | `maxRecords` budget on yielded records                       |
| Source repeating or cycling cursors | Repeated-cursor detection (`PAGINATION_REPEATED_CURSOR`)     |
| Abandoned traversals                | `AbortSignal` checked before fetch and before yield          |

All budgets are validated upfront: invalid configurations (non-integer,
negative, or above-ceiling values) throw a `RangeError` before any page is
fetched.

## Privacy

Guardrail failures are actionable without leaking payroll data: error
messages carry stable codes and fixed text, and never echo raw cursor
payloads, amounts, salaries, or record contents. Aborted traversals surface
only an `AbortError` — fetched records are never included.

## Building your own loop

If you hand-roll a `do { page = await fetch(cursor) } while (cursor)` loop,
resolve the same guardrails and enforce at least a page budget and
repeated-cursor detection — or better, delegate to
`iterateGuardedPages()`, which enforces all of them.
