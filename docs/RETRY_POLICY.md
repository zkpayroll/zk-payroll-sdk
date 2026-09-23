# Retry Policy

The SDK's network/RPC layer retries failed requests through
[`withRetry`](../packages/core/src/core/retry.ts), gated by
[`classifyError`](../packages/core/src/core/retry.ts) so retries are only
attempted when they can plausibly succeed.

## Configuring a retry policy

```ts
import { withRetry } from "@zk-payroll/core";

const account = await withRetry(() => server.getAccount(pubKey), {
  attempts: 3, // total attempts, including the first (default: 3)
  delayMs: 100, // delay before the first retry (default: 100)
  backoffFactor: 2, // delay multiplier applied after every retry (default: 2)
  timeoutMs: 5_000, // overall deadline across all attempts (default: unset)
  onRetry: (attempt, error, decision) => {
    console.warn(`retry #${attempt}`, decision.reason);
  },
});
```

Recommended starting point for RPC reads (`getAccount`, `simulateTransaction`,
`getTransaction`, polling for a transaction's final status): the defaults
above (`attempts: 3, delayMs: 100, backoffFactor: 2`) are what
`BaseContractWrapper` already uses for these calls. Add a `timeoutMs`
matched to your caller's own timeout budget (e.g. an HTTP request handler
with a 10s deadline should not let retries alone consume more than a few
seconds of that).

## How retry continuation is decided

Every failure is passed through `classifyError`, which maps it to one of:

| Category | Meaning | Retried? |
| --- | --- | --- |
| `RETRYABLE` | Transient failure (network error, HTTP 5xx/429, simulation failure, submission failure, transaction timeout) | Yes, until `attempts` or `timeoutMs` is reached |
| `UNKNOWN` | Unrecognized error shape | Yes (with caution) — same as `RETRYABLE` |
| `NON_RETRYABLE` | Failure that will never succeed on retry (validation error, contract revert, insufficient fee, batch validation failure) | No — `withRetry` stops immediately and rethrows, even with attempts remaining |

This means the *effective* number of attempts for a given call is
`min(attempts, "attempts until classifyError first returns NON_RETRYABLE")` —
`attempts` is an upper bound, not a guarantee that every attempt will run.

Passing `attempts: 1` disables retrying outright: the call runs once and any
failure is thrown immediately.

## Unsafe operations are not retried by default

**Transaction submission (`sendTransaction`) is never wrapped in `withRetry`
by `BaseContractWrapper`.** If the network call to submit a signed
transaction fails, the server may have already accepted and begun
processing it — blindly retrying risks broadcasting the same transaction
twice. Reads and idempotent operations (`getAccount`, `simulateTransaction`
— a dry run with no on-chain effect, `getTransaction` — a status poll) are
safe to retry and do use `withRetry`.

If your application needs its own resubmission logic after a submission
failure, inspect the error with `classifyError` yourself and make an
explicit, deliberate decision to resubmit — don't reach for `withRetry`
around a submission call.

## Testing

`packages/core/tests/retry.test.ts` covers:

- Success after N retryable failures
- Throwing the last error once `attempts` is exhausted
- Stopping immediately (not consuming remaining attempts) on a
  `NON_RETRYABLE` classification
- `attempts: 1` disabling retries
- Exponential backoff timing between attempts
- The `timeoutMs` deadline cutting a retry loop short, including before any
  attempt has run

## Per-operation retry budgets

Retry behavior is configured per operation type through
`ClientConfig.retryBudgets`. Each operation type (`read`, `write`, `poll`)
has its own budget so idempotent reads can be retried aggressively while
non-idempotent writes stay protected:

```ts
import { ConfigBuilder } from "@zk-payroll/core";

const config = new ConfigBuilder()
  .withRetryBudgets({
    read: { maxAttempts: 3, initialDelayMs: 100, backoffFactor: 2, maxDelayMs: 1_600 },
    write: { maxAttempts: 1, idempotencyRequired: true },
    poll: { maxAttempts: 5, initialDelayMs: 200, backoffFactor: 2, maxDelayMs: 2_000 },
  })
  .build();
```

The defaults (`DEFAULT_RETRY_BUDGETS`) are:

| Operation | `maxAttempts` | `initialDelayMs` | `backoffFactor` | `maxDelayMs` | `jitterMs` | `idempotencyRequired` |
| --- | --- | --- | --- | --- | --- | --- |
| `read` | 3 | 100 | 2 | 1 600 | 0 | false |
| `poll` | 3 | 100 | 2 | 1 600 | 0 | false |
| `write` | 1 | 100 | 2 | 1 600 | 0 | true |

The legacy top-level `retryPolicy` still works and is validated the same way;
`retryBudgets` gives finer-grained control per operation type.

## Backoff and cancellation

Backoff is deterministic and configurable. The delay before retry `N` is
`min(initialDelayMs * backoffFactor^(N-1), maxDelayMs)` plus optional jitter
(`jitterMs`, default `0`). Jitter is bounded and injectable, so tests can pin
the exact schedule without relying on wall-clock timing.

`withRetryBudget` accepts:

- `signal` - an `AbortSignal`. Cancelling it interrupts an in-flight retry
  sequence cleanly (before an attempt, between attempts, or during the
  backoff sleep) and throws `RetryCancelledError`.
- `timeoutMs` - an overall deadline for the whole retry sequence.
- `attemptTimeoutMs` - a per-attempt timeout; a timed-out attempt is treated
  as retryable and the loop moves on.
- `now`, `sleep`, `random` - injectable clock, scheduler, and randomness for
  deterministic tests.

## Non-idempotent operations are protected

A `write` operation is never retried automatically unless the caller supplies
an idempotency key/nonce. Without one the effective budget is capped at a
single attempt and any failure surfaces as `RetryBudgetExhaustedError` with
`retryRefused: true`. This is safety-critical: retrying a payroll-affecting
transaction blindly can duplicate a payment.

`BaseContractWrapper.invoke` accepts `idempotencyKey` in `InvokeOptions` and
forwards it to `submitInvocation`, so callers that already derive a
transaction hash or a stable per-payment nonce can opt in to safe retries.

## Duplicate-operation protection

Even when a retry is allowed, the same operation cannot be submitted twice.
When an idempotency key is present, each attempt runs through an
`IdempotencyRegistry` keyed by that nonce, so concurrent retries of the same
operation share a single in-flight promise. Combined with
`attemptTimeoutMs`, a retry of a submission that is still being processed
reuses the original attempt instead of broadcasting a second copy.

## Distinguishable exhaustion

When a retry budget is exhausted (or refuses to retry), the SDK throws
`RetryBudgetExhaustedError` (code `RETRY_BUDGET_EXHAUSTED`) - a distinct
error class with `operationType`, `attempts`, `maxAttempts`,
`retryRefused`, and `deadlineExceeded`. Callers can therefore handle "gave
up after N retries" differently from "genuinely failed", e.g. by alerting
operators that a submission needs manual intervention.

## Testing

`packages/core/tests/retry-budget.test.ts` covers:

- Deterministic backoff (fixed `initialDelayMs`, `backoffFactor`,
  `maxDelayMs`, `jitterMs` with an injected `random`)
- Transient failure, retry, eventual success
- Permanent failure: fails fast with no unnecessary retries
- Cancellation before an attempt and during a backoff sleep
- Budget exhaustion reporting the attempt count and maximum
- Non-idempotent write without an idempotency key: retry refused
- Retry of a keyed write and duplicate-operation protection
  (`IdempotencyRegistry` dedup)
- Per-attempt timeout and overall deadline behavior
- Config validation for `retryBudgets`

All timing is injected (`sleep`, `now`, `random`) or driven with fake timers,
so the tests are deterministic and do not depend on real wall-clock time.

