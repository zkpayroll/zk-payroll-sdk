# Privacy-safe SDK logging

The SDK emits structured log entries for diagnostics. Those entries can reach
your logging pipeline, so they must never carry payroll data such as salaries,
recipients, employee identities, or proof material. This page explains how the
SDK keeps that data out of logs and what integrators and contributors must still
do themselves.

## Routing SDK logs

By default the SDK logs nothing. Configure a logger once at startup:

```ts
import { setSdkLogger } from "@zk-payroll/core";

setSdkLogger((entry) => {
  // entry: { event, level: "info" | "warn" | "error", context?, timestamp }
  myLogger[entry.level](entry.event, entry.context);
});
```

`setSdkLogger` also accepts a plain `{ info, warn, error }` object. The SDK wraps
it so context is redacted before your methods receive it.

Loggers built by the SDK redact as well:

- `createHookLogger(hook)` builds a logger that redacts before calling `hook`.
- `createConsoleLogger()` writes redacted entries to the console.
- `createNullLogger()` discards everything (the default).

**Caution:** a full `EventEmitter`-based logger is used as-is and is not wrapped,
so SDK context reaches its methods unredacted. For a custom logger, use the hook
form shown above, which always redacts first.

## What gets redacted

Context keys are matched exactly (case-sensitive) and their values replaced with
`"[redacted]"`.

| Source | Keys |
| --- | --- |
| Engine defaults | `recipient`, `amount`, `witness`, `privateKey`, `adminKey`, `secret`, `password`, `token`, `mnemonic`, `seed`, `authorization`, `apiKey`, `api_key`, `accessToken`, `access_token`, `refreshToken`, `refresh_token`, `signingKey` |
| Payroll fields | `salary`, `salaryAmount`, `employee`, `employer`, `commitmentHash`, `nullifier` |

`redactSensitive(context)` applies the same rule, so you can use it to build a
safe context before calling your own logger.

## What is not redacted

Some values are not covered by the logger. Do not rely on it for these:

- **Nested objects.** Only top-level keys are inspected. A `recipient` inside
  `{ payout: { recipient } }` is passed through unchanged. Flatten the context,
  or redact the nested structure first with `redactDeep`.
- **Other key names.** `asset`, `proof`, `commitment`, and any custom field are
  not redacted by the logger. Pass them to `redactObject` with `additionalFields`,
  or leave them out of log context.
- **Event names and messages.** The `event` string is logged as given, and error
  message text is not scanned. Use stable event names such as `payment_failed`.
  Never build an event name from a payroll value.
- **Key-name variants.** `Salary` or `employee_id` are different keys and are not
  redacted. Use the exact names above, or add your own with `additionalFields`.

## Rules for contributors

1. Log identifiers, status, error codes, step names, and transaction hashes.
   Do not log amounts, salaries, recipients, employee identities, keys, witnesses,
   or proof inputs and outputs.
2. Keep context flat and use the documented key names, so the redaction applies.
3. Put errors on a stable code and a fixed message. Typed SDK errors such as
   `PayrollRunStatusTransitionError` report normalized values, not the raw input.
4. Don't log whole request or response objects. Pick the safe fields explicitly.

## Verifying

`tests/privacy-safe-logging.test.ts` pins the redaction contract for the process-wide
logger and for `redactSensitive`. When you add a payroll field that must stay out of
logs, add its key to that test and to the table above.
