# SGK Enhancements Documentation

## Issue #469 — Employee Lifecycle Client API
The EmployeeLifecycleClient has been implemented in `packages/core/src/employees/lifecycle.ts`.

Every method returns an explicit discriminated result (issue #483):
`{ ok: true, employeeAddress, operation, correlationId }` on success and
`{ ok: false, error }` on failure, where `error` carries a stable code, a
sanitized message, retryability, and remediation guidance. Failures never
throw and never echo rejected input or sensitive payroll values.

### Usage
```typescript
import { EmployeeLifecycleClient } from '@zk-payroll/core/employees';

const client = new EmployeeLifecycleClient(server, contractId);

// Create employee
const result = await client.create(adminKeypair, employeePublicKey);
if (result.ok) {
  console.log('Created', result.correlationId);
} else {
  console.error(result.error.code, result.error.message, result.error.remediation.action);
}

// Suspend employee
await client.suspend(adminKeypair, employeePublicKey);

// Reactivate employee
await client.reactivate(adminKeypair, employeePublicKey);

// Offboard employee
await client.offboard(adminKeypair, employeePublicKey);
```

## Issue #470 — Request Correlation IDs
The CorrelationContext class has been implemented in `packages/core/src/core/correlation.ts`.

### Usage
```typescript
import { CorrelationContext } from '@zk-payroll/core/correlation';

// Create context for a batch
const ctx = CorrelationContext.forBatch('payroll-2024-01');

// Create child context for sub-operations
const childCtx = ctx.child('payment', { recipient: 'G...' });
```

## Issue #471 — Configurable Transaction Timeout
TransactionTimeoutConfig has been added to BaseContractWrapper.

### Usage
```typescript
const wrapper = new MyContractWrapper(server, contractId, retryBudgets, {
  maxPolls: 30,        // default: 15
  pollIntervalMs: 1000, // default: 2000
  submissionTimeoutMs: 60000, // default: 30000
});
```

## Issue #468 — Structured Contract Error Mapping
The existing ContractErrorCode and error mapping provides structured error types.
All contract errors are mapped to typed ContractExecutionError instances.

## Issue #472 — safe Payroll Batch Submission Helper
Helper to submit sequential payroll batches with guarded retries and progress tracking, without leaking sensitive payroll details.

### Usage
```typescript
import { submitSequentialPayrollBatches, PayrollService } from '@zk-payroll/core/payroll';

// Direct helper
const result = await submitSequentialPayrollBatches(batches, {
  maxRetries: 3,
  initialBackoffMs: 500,
  onProgress: (progress) => {
    console.log(`Processing batch ${progress.batchIndex + 1}/${progress.totalBatches}`);
  },
  submitBatch: async (batch, index) => {
    return await executeBatch(batch);
  },
});

// Via PayrollService
const service = new PayrollService(config);
const result = await service.submitBatchPaymentsSafely(batches, {
  maxRetries: 2,
  onProgress: (p) => console.log(p.phase),
});
```

## Issue #475 — Event Decoding for Employee Status Updates
Decode contract status-change events into typed `EmployeeStatusUpdatedEvent` records.

### Usage
```typescript
import {
  decodeEmployeeStatusUpdatedEvent,
  decodeEmployeeStatusUpdatedEvents,
  isEmployeeStatusUpdatedEvent,
} from '@zk-payroll/core/events';

// Check if an event matches employee status update
if (isEmployeeStatusUpdatedEvent(rawEvent)) {
  const decoded = decodeEmployeeStatusUpdatedEvent(rawEvent);
  console.log(decoded.employee, decoded.previousStatus, decoded.newStatus);
}

// Decode an array of raw contract events
const updates = decodeEmployeeStatusUpdatedEvents(events);
```

## Issue #483 — Explicit SDK Operation Result Types
`runSdkOperation()` in `packages/core/src/core/operationResult.ts` wraps any
async SDK operation and returns a discriminated result instead of throwing:
`{ ok: true, value, correlationId, timestamp }` or
`{ ok: false, error, correlationId, timestamp, context }`.

Failure `error` detail includes:
- `code` — stable machine-readable error code,
- `message` — sanitized through the SDK redaction engine (no amounts, salaries, keys, or recipients),
- `attempted` — whether the operation actually ran (false for pre-flight validation rejections),
- `retryable` / `retryReason` — retryability classification,
- `remediation` — audience-specific actionable next steps.

### Usage
```typescript
import { runSdkOperation, unwrapSdkOperationResult } from '@zk-payroll/core';

const result = await runSdkOperation(() => client.pay(params), {
  operation: 'payroll_pay',
  validate: () => (params.amount > 0n ? { ok: true } : { ok: false, message: 'Amount must be positive.' }),
  onEvent: (event) => logger.info(event),
});

if (result.ok) {
  console.log(result.value, result.correlationId);
} else {
  console.error(result.error.code, result.error.message);
  console.error(result.error.remediation.action);
}

// Throw-on-failure variant (sanitized message, no raw cause attached by default):
const value = unwrapSdkOperationResult(result);
```

`EmployeeLifecycleClient` returns the same explicit result shape per operation,
with destination validation performed locally before any network call.

## Issue #532 — settlement Receipt Validation Helper
`validateSettlementReceipt()` in `packages/core/src/settlement/receipt.ts`
validates settlement receipts produced after payroll finalization before they
enter reconciliation, audit, or archival flows. It returns an explicit
result instead of throwing: `{ ok: true, receiptId, displayReceiptId, state: 'validated' }`
or `{ ok: false, code, message, state }` where `state` distinguishes
`"invalid"` (well-formed but failing policy) from `"malformed"` (not a receipt
object at all).

Checks performed:
- Receipt ID format (reuses the canonical settlement receipt ID rules),
- Payroll identifier presence (and optional match against `expectedPayrollId`),
- Settlement status against `allowedStatuses` (default `['settled', 'confirmed']`),
- Transaction reference (`txHash` in string or structured form),
- Metadata digest shape, plus content match when `metadata` is supplied.

Privacy: rejected values are never reflected in messages, and
`displayReceiptId` redacted (e.g. `rcp***def`) so results are safe to log
or render.

### Usage
```typescript
import { validateSettlementReceipt, isSettlementReceiptValid } from '@zk-payroll/core';

const result = validateSettlementReceipt(untrustedReceipt, {
  expectedPayrollId: 'pr_run_2026_09',
  metadata: payrollMetadata, // optional digest content check
});

if (result.ok) {
  console.log('Validated', result.displayReceiptId); // redacted, safe to log
} else {
  console.error(result.code, result.message); // sanitized, no rejected values
}

// Or a plain predicate:
if (isSettlementReceiptValid(receipt)) {
  // proceed with reconciliation
}
```

Also available on `PayrollService` (instance and static) as
`validateSettlementReceipt(receipt, options?)`, and
`extractSettlementReceiptTxHash(receipt)` returns the normalized on-chain
transaction hash for reconciliation pipelines.

## Issue #508 — Transaction Fee Estimate Wrapper

`packages/core/src/fee-estimation/transactionFeeEstimator.ts` provides a
documented wrapper for estimating transaction fees **before** payroll
submission. It never signs or broadcasts anything, and the returned estimate
contains only fee figures and operation counts — never recipients, amounts,
proofs, or other sensitive payroll values.

Exports:
- `TransactionFeeEstimator` — wraps an `rpc.Server`; `estimate(transaction)`
  simulates an unsigned Soroban transaction and returns a
  `TransactionFeeEstimate` (`baseFee`, `resourceFee`, `bufferFee`, `totalFee`,
  `operationCount`, `exact`, `breakdown`).
- `estimateTransactionFee(server, transaction, options?(` — one-off convenience
  wrapper.
- `estimatePreparedTransactionFee(transaction, options?(` — deterministic
  extraction from a transaction already assembled by simulation (no network
  call); splits the resource fee back out of `transaction.fee` so it is never
  double-counted.
- `FeeEstimationErrorCode` — stable codes
  (`FEE_ESTIMATION_INVALID_TRANSACTION`, `FEE_ESTIMATION_INVALID_BUFFER`).

Options: `bufferBps` adds a safety buffer (basis points, `0`–`10000`, so
`1000` = +10%); `requestId` correlates the operation through logs.

Failure handling is actionable and privacy-safe:
- Non-Soroban, empty, or multi-operation transactions throw a `ValidationError`
  with a stable `FEE_ESTIMATION_INVALID_TRANSACTION` code.
- A rejected simulation throws `ContractExecutionError` with
  `SIMULATION_FAILED`; the underlying detail is redacted (`recipient=…`,
  `amount=…`, secrets) and truncated before it is included.
- A response missing a resource fee throws `InvalidResponseError`.
- RPC transport failures are normalized through the shared `mapRpcError`.

Integration: `PayrollContractWrapper.estimatePrivatePayFee(recipient, amount,
asset, proof, sourcePublicKey, network?, options?)` builds and simulates a
private_pay invocation via `buildPrivatePayInvocation` (no signer required)
and returns the exact fee the assembled transaction would carry.

### Usage
```typescript
import {
  TransactionFeeEstimator,
  estimatePreparedTransactionFee,
} from '@zk-payroll/core';

// Preview the cost of a payroll run before asking the user to approve it.
const estimate = await contractWrapper.estimatePrivatePayFee(
  recipient,
  amount,
  asset,
  proof,
  sourcePublicKey,
  undefined,
  { bufferBps: 1_000 } // +10% safety buffer
);

console.log(estimate.totalFee, estimate.breakdown);
// "Base: 100, Resource: 1234, Buffer: 133, Total: 1467 stroops"

// Or estimate any unsigned Soroban transaction directly:
const estimator = new TransactionFeeEstimator(server);
const direct = await estimator.estimate(unsignedTx);
const reused = estimatePreparedTransactionFee(prepared.transaction);
```

## Issue #524 — Transaction Fee Ceiling Validator
The transaction fee ceiling validator is implemented in
`packages/core/src/fee-estimation/feeCeiling.ts` and runs inside the fee
estimation workflow, before a payroll transaction is signed or submitted.

`validateFeeCeiling(fee, ceiling, options?(` returns an explicit result — `{ ok: true, state, fee, ceiling, headroom, utilizationBps, warning }` or
`{ ok: false, state, code, message }` — and never throws. States are
`within_ceiling`, `approaching_ceiling`, `exceeds_ceiling`, and `invalid`
(malformed fee, non-positive ceiling, or an out-of-range `warnBps`).

Stable error codes are exported via `FeeCeilingErrorCode`: missing/invalid/
negative fee, missing/invalid ceiling, invalid warning band, and
`TRANSACTION_FEE_EXCEEDS_CEILING`.

Policy options: `warnBps` (default 8000 = warn at 80% of the ceiling, `0`
disables) and `label` (an operation name such as `private_pay` used in
messages).

Privacy: results and messages carry fee figures in stroops and the optional
operation label only — never recipients, payroll amounts, or proofs — so they
are safe to log and render in dashboards.

Integration: exported from the fee-estimation barrel; the estimation entry
points (`TransactionFeeEstimator.estimate`, `estimatePreparedTransactionFee`,
and therefore `PayrollContractWrapper.estimatePrivatePayFee`) accept an
opt-in `feeCeiling` option that gates the buffered total and throws
dTransactionFeeCeilingError` when it is exceeded. A malformed ceiling is
reported as `ValidationError` (`FEE_ESTIMATION_INVALID_CEILING`). Also
available: `assertFeeWithinCeiling()`, `validateTransactionFeeCeiling`()` for
estimate objects, and `isFeeWithinCeiling()`.

### Usage
```typescript
import { validateFeeCeiling } from '@zk-payroll/core/fee-estimation';

// Pre-flight: never throws, safe to log
const check = validateFeeCeiling(estimate.totalFee, 5_000n, {
  warnBps: 8_000,
  label: 'private_pay',
});

if (!check.ok) {
  console.error(check.code, check.message); // fee figures only
} else if (check.state === 'approaching_ceiling') {
  console.warn(check.warning);
}

if (check.ok) {
  console.log(check.headroom, check.utilizationBps);
}
```

## Issue #533 — Funding Source Readiness Check

The funding source readiness check is implemented in
`packages/core/src/funding/readiness.ts`. It lets callers verify that a
funding source is able to cover a payroll run **before** any transaction is
signed or submitted, so insufficient-funds failures surface as actionable,
privacy-safe states instead of mid-batch errors.

Exports:
- `CreateFundingSourceReadinessCheck` — the class that builds and evaluates
  readiness checks.
- `createFundingSourceReadinessCheck()` — one-off convenience wrapper.
- `CheckFundingSourceReadiness` — the canonical class name for the
  readiness checker.
- `validateFundingSourceReadinessCheckOptions()` — normalizes and
  validates caller options.
- `FundingSourceReadinessErrorCode` — stable machine-readable codes.
- `FundingSourceReadinessState` — the discriminated state union.

Every check returns an explicit discriminated result and never throws:
`- { ok: true, state: 'ready', fundingSource, available, required,
  headroom, utilizationBps }` when the source can cover the run,
- `{ ok: true, state: 'ready_with_warning', … warning }` when the
  source is within the configured warning band,
- `{ ok: false, state: 'insufficient_funds', code, message, remediation }`
  when the source cannot cover the run,
- `{ ok: false, state: 'invalid', code, message, remediation }` for
  malformed inputs.

Stable error codes exported via `FundingSourceReadinessErrorCode`:
- `FUNDING_SOURCE_INVALID_SOURCE`,
- `FUNDING_SOURCE_INVALID_REQUIRED@ (and `FUNDING_SOURCE_MISSING_REQUIRED`),
- `FUNDING_SOURCE_INVALID_BALANCE`,
- `FUNDING_SOURCE_INSUFFICIENT_FUNDS`,
- `FUNDING_SOURCE_INVALID_WARN_BAND`,
- `FUNDING_SOURCE_INVALID_OPTIONS`.

Policy options:
- `warnBps` (default `8000` = warn at 80% of the available balance,`0` disables),
- `label` (an operation name such as `payroll_run` used in messages),
- `fundingSource` (an optional human-readable identifier for the source),
- `allowZeroRequired` (default `false`).

Checks performed:
- Funding source shape and balance fields are well-formed,
- Required amount is a non-negative bigint,
- Available balance covers the required amount,
- Warning band is within `[1, 10000]` basis points.

Privacy: results and messages carry balance figures and the optional
operation label only — never recipients, payroll amounts, keys, or proofs —
so they are safe to log and render in dashboards.

### Usage
```typescript
import {
  CreateFundingSourceReadinessCheck,
  createFundingSourceReadinessCheck,
} from '@zk-payroll/core/funding';

// Pre-flight: never throws, safe to log
const check = createFundingSourceReadinessCheck({
  fundingSource: { id: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', balance: 10_000n },
  required: 5_000n,
  warnBps: 8_000,
  label: 'payroll_run',
});

if (check.ok) {
  console.log(check.state, check.headroom, check.utilizationBps);
} else {
  console.error(check.code, check.message);
  console.error(check.remediation.action);
}

// Or via the class for reusable checks:
new CreateFundingSourceReadinessCheck();
```
