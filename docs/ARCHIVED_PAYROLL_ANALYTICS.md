# Archived Payroll Data for Reporting & Analytics

> **Audience:** Teams that consume historical payroll data for dashboards,
> reporting pipelines, and analytics systems.
>
> **Goal:** Pull stable historical records using the SDK's existing helpers
> without guessing at the surface area or accidentally exposing private data.

---

## Contents

1. [How archived data flows through the SDK](#how-archived-data-flows-through-the-sdk)
2. [Core helpers for history consumers](#core-helpers-for-history-consumers)
3. [Expected data shapes](#expected-data-shapes)
4. [Privacy boundaries for analytics](#privacy-boundaries-for-analytics)
5. [Practical query patterns](#practical-query-patterns)
6. [Pipeline integration examples](#pipeline-integration-examples)

---

## How archived data flows through the SDK

The SDK does **not** maintain a separate "archive" store. Instead, historical
data is derived from two sources:

| Source | What it contains | When it becomes "archived" |
|---|---|---|
| **Payroll execution summaries** | Per-run results via `PayrollExecutionSummary` — includes per-payment outcomes, status counts, and wall-clock timing | As soon as `createExecutionSummary` is called (post-run) |
| **Paginated record sets** | Any `PayrollRecord[]` or `AuditRecord[]` you persist from your application layer | Whenever you snapshot and store the records locally |

A typical pipeline looks like:

```
PayrollService.processPayment / processBatchPayments
  → createExecutionSummary(outcomes, durationMs)
    → persist summary to your data warehouse
      → query with getPayrollHistoryPage / filterPayrollRecords for analytics
```

The SDK provides the building blocks for the last step — filtering, paginating,
and iterating — but **you** own the persistence layer (database, data lake,
warehouse, etc.).

---

## Core helpers for history consumers

All exports are available from `@zk-payroll/core`:

### `getPayrollHistoryPage(records, filter, options)`

Filter + paginate an in-memory array of payroll records. Returns a
`PaginatedResult<T>` with `data` and `meta` (total, page, cursors).

```ts
import { getPayrollHistoryPage } from "@zk-payroll/core";

const page = getPayrollHistoryPage(
  myRecords,
  { fromTimestamp: 1700000000, toTimestamp: 1730000000 },
  { pageSize: 50 }
);

console.log(`Showing ${page.meta.count} of ${page.meta.total} records`);
```

### `getAuditRecordsPage(records, filter, options)`

Same pattern but for audit-specific records (action, actor, time range).

### `paginateIterator(records, options)`

Async generator that yields one `PaginatedResult` per iteration. Use this
for server-side streaming — never loads the full filtered set into memory.

```ts
import { paginateIterator } from "@zk-payroll/core";

for await (const page of paginateIterator(allRecords, { pageSize: 100 })) {
  await warehouse.bulkInsert(page.data);
}
```

### `filterPayrollRecords(records, filter)` / `filterAuditRecords(records, filter)`

Low-level filters that apply time/amount/recipient/action predicates to an
array. Use when you need the matched set without pagination wrapping.

### `HistoryFilterBuilder`

Fluent builder for composing richer history queries with employee IDs,
period ranges, assets, statuses, and pagination params.

```ts
import { HistoryFilterBuilder } from "@zk-payroll/core";

const query = new HistoryFilterBuilder()
  .forPeriod("2024-01-01", "2024-06-30")
  .withStatuses(["completed"])
  .withAsset("USDC")
  .paginate({ page: 1, limit: 25 })
  .build();

// query.toParams() → ready for your API layer
```

**Note:** `HistoryFilterBuilder` produces a `HistoryQuery` object with
`toParams()`. It is designed for server-side API route composition, not
for direct in-memory filtering. Use `getPayrollHistoryPage` when you
already have records in memory.

### `createExecutionSummary(outcomes, durationMs, error?)`

Builds a `PayrollExecutionSummary` from an array of `PaymentExecutionOutcome`
objects. The summary includes aggregate status, success/failure counts, and
per-payment detail — a single object you can archive after every payroll run.

---

## Expected data shapes

### `PayrollRecord` (input to history paginators)

```ts
interface PayrollRecord {
  id: string;
  recipient: string;
  amount: bigint;      // stroops
  timestamp: number;   // Unix seconds
}
```

Records must have at least `amount`, `recipient`, and `timestamp` for the
history filters to work. Extend with additional fields as needed — the
generics on `getPayrollHistoryPage` carry through the full type.

### `PayrollExecutionSummary` (the archival unit)

```ts
interface PayrollExecutionSummary {
  status: "success" | "partial" | "failure" | "pending";
  totalCount: number;
  successCount: number;
  failureCount: number;
  pendingCount: number;
  results: PaymentExecutionOutcome[];   // per-payment detail
  durationMs: number;
  timestamp: number;                    // epoch ms — natural sort key
  error?: string;
}
```

The `results` array mirrors `PaymentParams` so outcomes map back to inputs
without external state. Each entry contains `recipient`, `amount`, `asset`,
`status`, optional `txHash`, and optional `error`.

### `AuditRecord`

```ts
interface AuditRecord {
  id: string;
  action: string;
  actor: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

Audit records capture who did what and when — governance actions, key
rotations, scope changes. Filter by `action` and `actor` and sort by
`timestamp` for compliance reporting.

---

## Privacy boundaries for analytics

The ZK Payroll SDK is built around privacy-by-default. Analytics consumers
must respect the same boundaries that the proof system enforces.

### What you can safely report

| Data point | Safe to export | Notes |
|---|---|---|
| Aggregate status (success/partial/failure) | Yes | No identity or amount info |
| Success / failure / pending counts | Yes | Rolling counts only |
| Execution duration (`durationMs`) | Yes | Performance metrics |
| `txHash` | Yes | Public on ledger |
| `timestamp` | Yes | Non-sensitive timing |
| Error messages | Yes | Generic error classes |
| `auditorOrg`, `auditorName` | Yes | Audit metadata only |

### What requires a view key

Payment-level detail (recipient, amount, asset) is **not** accessible
without an active audit view key. The SDK exposes two view-key scopes:

| Scope | What it unlocks | Typical consumer |
|---|---|---|
| `"read-only"` | Transaction summaries — counts, timestamps, statuses | Reporting dashboards pulling aggregate metrics |
| `"full-audit"` | All of the above plus departmental breakdowns, per-payment amount and recipient | External auditors, compliance teams |

```ts
import { createViewKeyRequest } from "@/lib/audit/viewKeyHelpers";

const key = createViewKeyRequest(
  { auditorName: "Analytics Bot", auditorOrg: "Internal BI", scope: "read-only" },
  adminPublicKey
);
```

### What you must never record

| Field | Why |
|---|---|
| `recipient` | Identifies payees; links payments to identities |
| `amount` / `salary` | Exact financial data |
| `asset` | Reveals payment rails (token contract address) |
| `witness` | All ZK circuit inputs — contains everything above |
| `privateKey` / `adminKey` / `secret` | Key material |
| `nullifier` / `commitment` / `commitmentHash` | Correlatable — can infer payment frequency and pattern |
| `publicSignals` (raw array) | May encode commitments depending on circuit config |

The SDK's built-in `redactSensitive()` function covers `recipient`, `amount`,
`witness`, `privateKey`, and `adminKey`. Use it as a safety net when
building context objects for logging or forwarding:

```ts
import { redactSensitive } from "@zk-payroll/core/logging";

const safe = redactSensitive({ recipient, amount, txHash, status });
// safe.recipient → "[redacted]"
// safe.txHash     → preserved
```

### Telemetry guardrails

When connecting SDK events to an external analytics backend:

1. **Never forward `PayrollExecutionSummary.results` raw** — the array
   contains `recipient` and `amount` per entry. Derive aggregations
   (counts, totals) server-side and only send the aggregated numbers.
2. **Keyed allowlist pattern** — only forward context fields you've
   explicitly verified as safe:

```ts
const SAFE_KEYS = new Set(["event", "level", "timestamp", "txHash", "status"]);

analyticsHook.onEntry((entry) => {
  const safe: Record<string, unknown> = { event: entry.event, level: entry.level };
  for (const [k, v] of Object.entries(entry.context ?? {})) {
    if (SAFE_KEYS.has(k)) safe[k] = v;
  }
  myAnalyticsSink.send(safe);
});
```

3. **Aggregated metrics only** for high-throughput pipelines — compute
   counters and histograms locally, send only the aggregates:

```ts
const metrics = { runs: 0, successPct: 0, avgDurationMs: 0 };
// update locally, flush on schedule
```

See [TELEMETRY.md](./TELEMETRY.md) for the full treatment.

---

## Practical query patterns

### 1. Total amount paid in a period (from archived summaries)

```ts
const summaries: PayrollExecutionSummary[] = await db.summaries.findAll({
  timestamp: { gte: periodStart, lte: periodEnd },
});

const totalPaid = summaries.reduce((sum, s) => {
  return sum + s.results
    .filter((r) => r.status === "success")
    .reduce((acc, r) => acc + r.amount, 0n);
}, 0n);
```

### 2. Success rate per run (aggregated, no raw detail)

```ts
const rate = summaries.map((s) => ({
  runId: s.timestamp,
  total: s.totalCount,
  successPct: s.totalCount > 0 ? (s.successCount / s.totalCount) * 100 : 0,
  avgDurationMs: s.durationMs,
}));
```

### 3. Paginated payroll history for a specific recipient

```ts
const page = getPayrollHistoryPage(
  storedRecords,
  { recipient: "GABCD...", fromTimestamp: startOfQuarter, toTimestamp: endOfQuarter },
  { pageSize: 25, cursor: lastCursor }
);
```

### 4. Streaming audit records for compliance export

```ts
for await (const page of paginateIterator(auditLogs, { pageSize: 200 })) {
  await complianceExport.write(page.data);
}
```

### 5. Per-employee summary using HistoryFilterBuilder

```ts
const query = new HistoryFilterBuilder()
  .forEmployee("emp_42")
  .forPeriod("2024-Q1", "2024-Q4")
  .withStatus("completed")
  .build();

// query.toParams() → { employeeIds: ["emp_42"], periodStart: "2024-Q1", ... }
```

---

## Pipeline integration examples

### Batch ETL to a data warehouse

```ts
import { paginateIterator, filterPayrollRecords } from "@zk-payroll/core";

async function etlPayrollHistory(records: PayrollRecord[]) {
  for await (const page of paginateIterator(records, { pageSize: 500 })) {
    // Transform: bigint amounts → string for JSON-safe transport
    const rows = page.data.map((r) => ({
      ...r,
      amount: r.amount.toString(),
    }));

    await warehouse.insert("payroll_history", rows);
  }
}
```

### Scheduled analytics aggregation

```ts
// Runs daily: derive safe metrics from archived summaries
async function dailyReport() {
  const today = Date.now();
  const yesterday = today - 86_400_000;

  const summaries = await db.summaries.query({
    timestamp: { gte: yesterday, lt: today },
  });

  const report = {
    date: new Date(yesterday).toISOString().slice(0, 10),
    totalRuns: summaries.length,
    totalPayments: summaries.reduce((s, r) => s + r.totalCount, 0),
    successRate: computeRate(summaries),
    p95DurationMs: computeP95(summaries.map((s) => s.durationMs)),
  };

  // report contains zero sensitive fields — safe to forward
  await analyticsSdk.ingest(report);
}
```

### API route for internal BI dashboard

```ts
// pages/api/payroll/history.ts
import { getPayrollHistoryPage, HistoryFilterBuilder } from "@zk-payroll/core";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");

  const records = await db.payrollRecords.findAll(); // your store

  const result = getPayrollHistoryPage(
    records,
    { fromTimestamp: +searchParams.get("from")!, toTimestamp: +searchParams.get("to")! },
    { page, pageSize: limit }
  );

  // Strip amounts/recipients for read-only consumers
  if (req.headers.get("x-access-scope") === "read-only") {
    result.data = result.data.map((r) => ({
      ...r,
      amount: undefined,
      recipient: undefined,
    }));
  }

  return Response.json(result);
}
```

---

## Read-only archived records

Archived payroll records are historical and must not be edited. Use the
read-only helpers when handing records to dashboards or analytics code:

```ts
import { toReadonlyArchivedRecord, toReadonlyArchivedRecords } from "@zk-payroll/core";

const record = toReadonlyArchivedRecord(archivedRecord);
const page = toReadonlyArchivedRecords(records);

// Throws TypeError: the copy is frozen.
// record.status = "failed";
```

`ReadonlyArchivedRecord` rejects field assignment at compile time, and the
returned object (and array) is frozen at runtime. The source records are not
modified.

---

## Related documentation

- [Pagination Helpers](./pagination.md) — full pagination API reference
- [Audit View-Key Helpers](./audit-view-keys.md) — granting scoped access to audit data
- [Telemetry & Privacy-Safe Analytics](./TELEMETRY.md) — SDK logging and aggregated metrics
- [API Reference](./API.md) — full export listing from `@zk-payroll/core`
- [Execution Summary Types](./packages/core/src/summary/types.ts) — `PayrollExecutionSummary` shape
