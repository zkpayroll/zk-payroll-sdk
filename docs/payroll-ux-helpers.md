# Payroll UX Helpers

Consolidated guide for four SDK reliability/usability helpers for private
payroll operations. All of them keep sensitive payroll values (recipients,
amounts, keys, witnesses) redacted or truncated at the boundary — nothing
sensitive ever reaches host loggers, notification text, or error messages.

## 1. Configurable SDK logging (Issue #476)

Route SDK diagnostics into your own logger with `setSdkLogger()`. It accepts
a hook function, a full `SdkLogger`, or a bare `{ info, warn, error }`
object. Every log context is redacted **before** it reaches your code.

```typescript
import {
  setSdkLogger,
  getSdkLogger,
  resetSdkLogger,
  createConsoleLogger,
  createNullLogger,
} from "@zk-payroll/core";

// Option A: forward into your own pipeline (e.g. pino, winston, console).
setSdkLogger((entry) => myLogger[entry.level](entry.event, entry.context));

// Option B: bridge to the console (entries arrive already redacted).
setSdkLogger(createConsoleLogger());

// The default is silent; reset to it (also useful between tests).
resetSdkLogger();
const logger = getSdkLogger();
logger.info("payment_start", { txHash: "0xabc" }); // recipient/amount would be redacted
```

Per-instance injection still works (`new PayrollService(wrapper, generator,
signer, network, logger)`); `setSdkLogger()` configures the process-wide
default on top of that.

## 2. Payroll completion polling (Issue #477)

`pollPayrollCompletion()` polls any caller-supplied status getter until your
terminal-state predicate passes, with a bounded timeout and `AbortSignal`
cancellation. `waitForPayrollRunCompletion()` is the convenience wrapper for
runs tracked with `PayrollRunStatus` (`executed` / `cancelled` / `failed`
are terminal).

```typescript
import { waitForPayrollRunCompletion } from "@zk-payroll/core";

const controller = new AbortController();
try {
  const { value, attempts, elapsedMs } = await waitForPayrollRunCompletion(
    () => api.getPayrollRun(runId), // "scheduled" | "executed" | … or { status }
    { timeoutMs: 90_000, intervalMs: 2_000, signal: controller.signal }
  );
} catch (err) {
  // ContractExecutionError (TRANSACTION_TIMEOUT) on timeout — the message
  // carries only durations/attempts, never status values. A cancelled
  // signal throws a "cancelled" Error. Getter rejections propagate as-is.
}
```

Validation failures (`timeoutMs`/`intervalMs` not positive, non-function
arguments) throw `RangeError`/`TypeError` immediately.

## 3. Payroll run summary formatter (Issue #474)

`createExecutionSummary()` builds the normalized summary; render it with
`formatPayrollRunSummary()` (multi-line text for notifications and audit
logs) or `toPayrollRunDashboardView()` (JSON-safe view with counts, success
rate, and timing for dashboards and audit storage).

```typescript
import {
  createExecutionSummary,
  formatPayrollRunSummary,
  toPayrollRunDashboardView,
} from "@zk-payroll/core";

const summary = createExecutionSummary(outcomes, durationMs);
console.log(formatPayrollRunSummary(summary));
const view = toPayrollRunDashboardView(summary); // JSON.stringify-safe
```

Recipient privacy: addresses render truncated (`GALICE...3456`) by default,
`hideRecipients: true` omits them (notifications), and `fullRecipients: true`
reveals them only for authorized audit views. `maxResultsShown` caps
per-payment lines with an "…and N more" overflow line.

## 4. Payroll command serialization (Issue #478)

Versioned binary encode/decode for payroll command payloads — single entries
(tag `0x05`) and full `PayrollRequest` payloads with idempotency keys and
submission context (tag `0x06`). Entries are validated against contract
expectations (non-empty recipient, positive amount, non-empty asset) at
encode time, so incompatible requests fail fast with a clear
`SerializationError` instead of an opaque on-chain revert. Decoders fail fast
on truncated buffers, version/tag mismatches, and trailing bytes.

```typescript
import { encodePayrollRequest, decodePayrollRequest } from "@zk-payroll/core";

const bytes = encodePayrollRequest(request); // throws on invalid entries
const roundTripped = decodePayrollRequest(bytes); // deep-equals `request`
```

See `tests/payroll-command-serialization.test.ts` for round-trip, validation,
and malformed-input coverage.
