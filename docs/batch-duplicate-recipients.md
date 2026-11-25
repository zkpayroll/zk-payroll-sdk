# Duplicate Recipient Positions (#831)

Payout builders reject a recipient that appears at more than one position in
the same batch. Paying an address twice can double a salary, inflate treasury
reservations, and make reconciliation disagree with the intended payroll.

## Behavior

- `BatchPayloadBuilder.validate()` and `EmployeeBatchSchemaValidator.validate()`
  report `DUPLICATE_RECIPIENT` for every position after the first occurrence.
- Comparison uses the **canonical** recipient: surrounding whitespace is
  stripped, so `" GABC... "` and `"GABC..."` are the same payment position.
- Blank recipients continue to be reported as `INVALID_RECIPIENT`; they are
  never treated as duplicates.
- Errors name positions only (`Duplicate recipient at indices 0 and 2`).
  Recipient addresses are never echoed.

## Helpers

```ts
import {
  findDuplicateRecipientPositions,
  normalizeRecipientPosition,
  formatDuplicateRecipientPositionMessage,
} from "@zk-payroll/core";

const duplicates = findDuplicateRecipientPositions(entries);
// [{ normalizedRecipient, firstPosition, duplicatePositions, positions }]
```

`build()` throws `BatchValidationFailedError` when duplicates are present, so
an invalid batch cannot reach the contract.
