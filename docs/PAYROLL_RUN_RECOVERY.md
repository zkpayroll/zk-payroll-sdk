# Payroll run recovery

`PayrollRunRecoveryTracker` records what happened around each contract submission so an interrupted payroll run (crash, deploy, lost connection) can be resumed without paying anyone twice. It is in-memory and self-contained: it never submits transactions or reads chain state, and callers decide where to persist snapshots.

```ts
import { PayrollRunRecoveryTracker } from "@zk-payroll/core";

const tracker = new PayrollRunRecoveryTracker();
tracker.startRun({ runId: "run-2026-10", paymentIds: ["p1", "p2"], maxAttempts: 3 });

tracker.markSubmitted("run-2026-10", "p1", txHash); // right as the submission is sent
try {
  await waitForConfirmation(txHash);
  tracker.markConfirmed("run-2026-10", "p1");
} catch (err) {
  tracker.markFailed("run-2026-10", "p1", err);
}

// Persist the redacted snapshot, e.g. after every state change.
const saved = tracker.getSnapshot("run-2026-10");

// After a restart:
const resumed = new PayrollRunRecoveryTracker();
resumed.restore(saved);
const plan = resumed.planRecovery("run-2026-10");
```

## Payment states

| Status | Meaning | Recovery action |
| --- | --- | --- |
| `pending` | Never submitted | Submit (`plan.submit`) |
| `submitted` | Sent, outcome unknown | Look up the tx hash on-chain, then `markConfirmed` or `markFailed`. **Do not resubmit** (`plan.reconcile`) |
| `failed` | Failed, attempts remain | Resubmit (`plan.retry`) |
| `retry_exhausted` | All `maxAttempts` used (default 3) | Manual intervention (`plan.blocked`) |
| `confirmed` | Done | None |

`markSubmitted` consumes an attempt, so call it as the submission is sent; a crash afterwards leaves the payment in `submitted` rather than looking unsent. `plan.actions` holds plain-language next steps, and `assertRecoverable` throws when any payment is blocked or needs reconciliation.

## Errors

Failures throw `PayrollRunRecoveryError` with a `code` (`RUN_NOT_FOUND`, `RUN_ALREADY_EXISTS`, `PAYMENT_NOT_FOUND`, `INVALID_RUN`, `INVALID_TRANSITION`, `RETRY_LIMIT_EXCEEDED`) and a message that says what to do next.

## Privacy

Only payment IDs, statuses, attempt counts and public transaction hashes are stored. Recipients and amounts are never recorded. Run `metadata` passes through the SDK redaction engine (recipient, amount, keys, tokens and similar fields are replaced), and error text is scrubbed of Stellar secret seeds, account addresses and `password=`/`token:`-style values and truncated to 200 characters before it is kept. Snapshots are safe to log or persist.
