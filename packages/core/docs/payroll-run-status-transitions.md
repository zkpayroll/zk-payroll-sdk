# Payroll run status transitions

Payroll runs move through a small set of statuses. The SDK checks each
requested status change against one table before any caller acts on it, so an
integration cannot accidentally reopen a finished run or execute a run that was
never scheduled.

## Transition table

| From | Allowed next statuses |
| --- | --- |
| `draft` | `scheduled`, `cancelled` |
| `scheduled` | `executed`, `failed`, `cancelled` |
| `executed` | none (terminal) |
| `cancelled` | none (terminal) |
| `failed` | none (terminal) |

Terminal statuses are the same set reported by `isTerminalPayrollRunStatus`.

## API

```ts
import {
  assertPayrollRunStatusTransition,
  canTransitionPayrollRunStatus,
  PayrollRunStatusTransitionError,
} from "@zk-payroll/core";

canTransitionPayrollRunStatus("draft", "scheduled"); // true
canTransitionPayrollRunStatus("executed", "scheduled"); // false

try {
  assertPayrollRunStatusTransition("draft", "executed");
} catch (error) {
  if (error instanceof PayrollRunStatusTransitionError) {
    error.code; // "INVALID_TRANSITION"
    error.from; // "draft"
    error.to; // "executed"
  }
}
```

- `canTransitionPayrollRunStatus(from, to)` returns a boolean and never throws.
  Inputs are normalized the same way as `parsePayrollRunStatus` (trimmed,
  lowercased). Unknown or missing values return `false`.
- `assertPayrollRunStatusTransition(from, to)` throws
  `PayrollRunStatusTransitionError` with one of these codes:
  - `MISSING_STATUS`: a status was empty or not a string.
  - `UNKNOWN_STATUS`: a status is not a run status this SDK version knows.
  - `INVALID_TRANSITION`: both statuses are valid but the move is not allowed.
- `getAllowedPayrollRunStatusTransitions(status)` returns the table row for a status.
- `PAYROLL_RUN_STATUS_TRANSITIONS` is the table itself, typed as a read-only
  record. Treat it as read-only; it is not frozen at runtime.

## Privacy

Errors carry only normalized status names. An unrecognized input value is never
copied into the error message or its fields, so a mistyped value cannot leak
payroll data into logs.
