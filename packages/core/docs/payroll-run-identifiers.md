# Payroll run identifiers

`RunIdentifier` produces the opaque correlation tokens used to group one
payroll session across submission, polling, events, error messages, network
timing records and outbound HTTP requests.

Import it from the package root:

```typescript
import { RunIdentifier, normalizeRunId } from "@zk-payroll/core";

const runId = RunIdentifier.generate(); // run_<64 lowercase hex chars>
const requestId = RunIdentifier.generateCorrelationId(runId, "private_pay");
const retryId = RunIdentifier.generateRequestId("private_pay", {
  payrollId: "pr_123",
  amount: "5000000000",
});
```

## Formats and invariants

| ID | Format | Stability |
| --- | --- | --- |
| Run ID | `run_` + 64 hexadecimal characters | Random per session; safe to reuse across operations in that session |
| Request ID | `req_` + 64 lowercase hex characters | Deterministic: same operation + parameters produce the same ID |
| Correlation ID | `corr_` + run hex + `_` + 8 lowercase hex characters | Deterministic for a (run, operation) pair |

- All IDs are opaque tokens. They carry no employee names, addresses,
  salaries or amounts.
- A run ID is a **session** identifier, not an idempotency key. Use a request
  ID for retry correlation and a domain-specific nonce/idempotency key for
  "process once" guarantees.
- `isValid`, `isValidRequestId` and `isValidCorrelationId` only accept exact
  formats; they never coerce non-string inputs.
- Operation names are trimmed and limited to 1–128 printable characters, so
  free-form or control-character payloads cannot become tokens or log
  injection vectors.

## Canonical state handling

State and cache keys should use the canonical form returned by
`normalizeRunId()` (or `RunIdentifier.normalizeRunId()`):

- both `run_<hex>` and bare `<hex>` are accepted;
- whitespace is trimmed;
- hex letters are lowercased;
- malformed values are rejected rather than silently stored.

```typescript
const key = `payroll:run:${normalizeRunId(storedRunId)}`;
```

This prevents the same run from occupying multiple state entries because one
caller saved the prefixed form and another saved bare hex, or because hex
casing differed. `RunIdentifier.generateCorrelationId()` normalizes its run
ID argument before hashing, so equivalent inputs always yield the same
correlation ID.

## Failure behavior

Validation failures throw a `ValidationError` with a stable code and never
echo the rejected value:

| Code | Cause |
| --- | --- |
| `INVALID_RUN_ID` | Run ID is not a string, or is not 64 hex characters (optionally prefixed with `run_`) |
| `INVALID_OPERATION` | Operation name is empty, non-string, longer than 128 characters, or contains control characters |
| `INVALID_REQUEST_PARAMS` | Request parameters are not a plain object, contain a circular reference, contain an unsupported numeric value, or exceed the depth (32) / size (1000 values) limits |

Examples of actionable, value-free messages:

> Invalid runId: expected 'run_' followed by 64 hexadecimal characters (or
> the bare hex form).

> Request parameters must not contain circular references.

Because messages never include the input, a malformed payload that happened
to contain payroll data cannot leak into logs or telemetry. Callers that only
need a boolean check should use `isValid`/`isValidRequestId`/
`isValidCorrelationId` instead of catching errors.

## Compatibility notes

- Valid inputs keep their previous string format and deterministic request
  IDs; no format migration is required.
- Empty/whitespace operation names and unsupported parameter graphs now throw
  instead of producing an ID or a raw `RangeError`/`TypeError`.
- A correlation ID derived from mixed-case or bare-hex run IDs is now
  canonicalized to lowercase. Consumers that compared correlation IDs as raw
  strings should normalize stored values with `normalizeRunId()` first.

See also [Request identifier propagation](../../README.md#request-identifier-propagation).
