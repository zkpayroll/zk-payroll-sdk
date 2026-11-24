# Payroll metadata serialization

`serializePayrollMetadata` turns a plain metadata object into one deterministic
JSON string. Equal metadata always produces the same bytes, so the result can be
hashed, compared, or stored and rebuilt later, whatever order the keys were added in.

```ts
import { serializePayrollMetadata } from "@zk-payroll/core";

const a = serializePayrollMetadata({ runId: "run-2026-03", memo: "march" });
const b = serializePayrollMetadata({ memo: "march", runId: "run-2026-03" });
// a === b === '{"memo":"march","runId":"run-2026-03"}'
```

## Encoding

| Input | Output |
| --- | --- |
| Object keys | Sorted by UTF-16 code unit order (locale-independent) |
| Key with `undefined` value | Omitted, as `JSON.stringify` does |
| Array | Order preserved; each element encoded in turn |
| `bigint` | Decimal string: `10n` becomes `"10"` |
| `Date` | ISO-8601 string: `"2026-01-01T00:00:00.000Z"` |
| Finite number | JSON number; `-0` becomes `0` |
| String, boolean, `null` | JSON encoding |

Output contains no insignificant whitespace. Symbol-keyed and non-enumerable
properties are ignored.

Because `bigint` becomes a string, the string `"10"` and the value `10n` encode the
same way. Keep field types consistent within a schema.

## Rejected values

Anything JSON cannot represent faithfully is rejected rather than dropped or
coerced. The function throws `PayrollMetadataSerializationError`:

| `code` | Cause |
| --- | --- |
| `INVALID_METADATA` | The top-level input is not a plain object. |
| `UNSUPPORTED_VALUE` | A function, symbol, `Map`, `Set`, class instance, invalid `Date`, or `undefined` array element. |
| `NON_FINITE_NUMBER` | `NaN`, `Infinity`, or `-Infinity`. |
| `CIRCULAR_REFERENCE` | An object contains itself. A shared reference used in two places is allowed. |

Each error has a `path` array of keys and indices that leads to the rejected value,
for example `["rows", 0, "amount"]`. The error never includes the value itself, so
salary, recipient, or proof data stays out of error messages and logs.

## Relation to other helpers

`canonicalizeMetadata` (in `receipts/digest`) is a more lenient canonicalizer. It drops
functions and coerces unsupported values. Use `serializePayrollMetadata` when you need
strict, fail-closed output.
