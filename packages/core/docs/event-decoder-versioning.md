# Event Decoder Version Compatibility (#997)

Payroll lifecycle event decoders resolve the event's `schema_version` through
`decodePayrollLifecycleEventSchemaVersion()` (`src/events/versioning.ts`)
before reading any other field. The current version is
`PAYROLL_LIFECYCLE_EVENT_SCHEMA_VERSION = 1`.

## Versioned decoders

| Decoder | Event |
|---|---|
| `parsePayrollCancelledEvent` | `payroll_cancelled` |
| `parseDraftExpiryEvent` | draft expiry |
| `parseDraftUpdatedEvent` | draft updated |
| `parseSettlementExpiredEvent` | settlement expiry |
| `parseInterruptedSettlementRecoveryEvent` | interrupted settlement recovery |

Other decoders in `src/events/` do not read `schema_version` yet; they decode
the v1 layout only.

## Compatibility matrix

| `schema_version` in event data | Result |
|---|---|
| absent (legacy contract) | decoded as v1 |
| `u32` `1` | decoded as v1 |
| `u64` `1` | decoded as v1 |
| any other number (`0`, `2`, …) | `EventDecodingError` |
| non-numeric (`string`, `void`, …) | `EventDecodingError` |

Unknown versions **fail closed**: the SDK never guesses at a changed payload
layout, so an SDK older than the contract stops instead of misreading
salary or employee fields. Upgrade the SDK to decode newer events.

The error message is fixed —
`Unsupported or invalid schema_version in <event> event data` — and never
includes payload values. The raw event stays on `error.rawEvent` for
diagnostics; do not log it in production, since it can contain payroll data.

## Adding a new version

1. Widen `PayrollLifecycleEventSchemaVersion` to a union (e.g. `1 | 2`) and
   accept the new value in `decodePayrollLifecycleEventSchemaVersion`.
2. Branch on the returned version in each affected decoder; keep the v1 path
   unchanged so legacy events still decode.
3. Extend `tests/event-decoder-versioning.test.ts` and this matrix.
