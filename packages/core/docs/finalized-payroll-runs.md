# Finalized payroll runs

`assertPayrollRunMutable` rejects a run whose status is `EXECUTED`, `COMPLETED`, `CANCELLED`, `FAILED`, or `FINALIZED`. `assertPayrollRunFinalized` is the inverse check for operations that may run only after finalization.

Both throw `FinalizedPayrollRunError` with a stable `code`. The message does not include the caller-supplied status, so a salary, employee identifier, or proof cannot be reflected in logs.
