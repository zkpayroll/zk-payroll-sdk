# Payroll API migration guidance

## Payroll request validation

Submitters should provide the ledger sequence observed before settlement
creation through `SubmissionContext.settlementStartLedger`. The SDK rejects
missing and malformed ledger values before a payroll request is built.

```ts
const ledger = await payroll.getSettlementStartLedger();
const request = builder
  .withContext({ settlementStartLedger: ledger })
  .build();
```

Use the reported `settlementStartLedger` validation code when presenting an
actionable operator error. Do not include employee IDs, recipients, salaries,
proof values, or private keys in the error.

## Payroll run lookup

Use `lookupPayrollRun()` or `findPayrollRunById()` instead of treating a
missing run as an exception:

```ts
const result = findPayrollRunById(runs, runId);
if (!result.ok) {
  // result.code === "PAYROLL_RUN_NOT_FOUND"
  return;
}
process(result.run);
```

## Privacy-safe errors

Use `redactPayrollError()` for thrown values and logs:

```ts
const safe = redactPayrollError(error);
logger.warn(safe.code, safe.message);
```

The utility is suitable for employee, recipient, salary, proof, commitment,
secret, and view-key data. It intentionally returns a stable code and a
bounded message rather than forwarding untrusted error text.
