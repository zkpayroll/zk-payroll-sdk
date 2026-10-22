# Payroll Guardrails and Recovery Guide

This document describes the guardrails and recovery helpers in the ZK Payroll SDT.

## Cross-Currency Payout Rounding Safeguards (#694)

Cross-currency payouts convert base compensation amounts into target payout tokens. Rounding discrepancies can lead to precision loss or underfunding.

The `validateCrossCurrencyPayoutRounding` function checks payout line items against drift limits.

### Usage

```typescript
import { validateCrossCurrencyPayoutRounding } from '@zk-payroll/core';

const report = validateCrossCurrencyPayoutRounding(
  [
    {
      id: 'payout-1',
      recipientId: 'GAAA',
      sourceAmount: '1000000000', // 100 USDC (7 decimals)
      sourceDecimals: 7,
      targetDecimals: 7,
      exchangeRate: 1.25,
      expectedTargetAmount: '1250000000',
    },
  ],
  {
    maxItemDriftBps: 5,
    maxBatchDriftBps: 10,
    roundingMode: 'round',
  }
);

if (!report.valid) {
  console.error('Rounding safeguards triggered:', report.errors);
}
```

## Audit Event Sequence Verification (#695)

Audit logs must preserve strict monotonicity, gap detection, timestamp ordering, and hash-chain continuity.

The `verifyAuditEventSequence` function verifies audit event streams before archiving or reporting.

### Usage

```typescript
import { verifyAuditEventSequence } from '@zk-payroll/core';

const verification = verifyAuditEventSequence(auditEvents, {
  expectedStartSequence: 1,
  allowGaps: false,
  verifyHashChain: true,
});

if (!verification.valid) {
  console.error('Audit sequence violations detected:', verification.violations);
}
```

## Stalled Payroll Run Recovery Guidance (#696)

When payroll execution gets interrupted by process restarts, dropped heartbeats, or batch timeouts, the SDK diagnoses the stall and provides safe recovery steps.

### Usage

```typescript
import { evaluateStalledPayrollRun } from '@zk-payroll/core';

const recoveryReport = evaluateStalledPayrollRun({
  runId: 'run-123',
  status: 'IN_PROGRESS',
  startedAt: Date.now() - 600000,
  lastHeartbeatAb: Date.now() - 300000,
  totalBatches: 10,
  completedBatches: 4,
  failedBatches: 0,
});

console.log(recoveryReport.recommendedStrategy); // 'RESUME_FROM_CHECKPOINT'
console.log(recoveryReport.resumeFromBatchIndex); // 4
console.log(recoveryReport.remediationSteps);
```

## Payroll Policy Effective-Date Guardrails (#697)

Policy updates for compensation rules and tax withholdings must maintain valid date windows. The SDK checks retroactive bounds and detects overlapping conflicts.

### Usage

```typescript
import { validatePolicyEffectiveDate } from '@zk-payroll/core';

const report = validatePolicyEffectiveDate(
  {
    policyId: 'policy-q4',
    policyType: 'SALARY_SCALE',
    scopeId: 'dept-sales',
    effectiveFrom: '2026-11-01T00:00:00Z',
    effectiveTo: '2026-12-31T23:59:59Z',
  },
  existingPolicies,
  {
    maxRetroactiveDays: 30,
    allowRetroactive: true,
  }
);

if (!report.valid) {
  console.error('Policy effective date violations:', report.violations);
}
```

## Removed Employee Payout Batch Guard (#812)

Removed employees must not receive a regular payroll payout. Both payout batch builders — `EmployeeBatchSchemaValidator` and `BatchPayloadBuilder` — reject entries that carry a removal signal (`status`/`employeeStatus` of `removed`, `offboarded`, or `terminated`, `isRemoved: true`, or a `removedAt` timestamp) and entries listed in a `removedEmployeeIds` roster snapshot.

Each rejection is privacy-safe: the employee identifier is masked (`EMP***042`), salaries and payout destinations are never included, and the thrown `RemovedEmployeeInPayoutBatchError` reports only an aggregate count plus structured rejections.

Use `partitionPayoutBatchByRemoval` to pay everyone else and surface skipped employees for review, or `rejectRemovedEmployees: false` on the builder for a reviewed offboarding settlement. See [removed-employee-batch-guard.md](../packages/core/docs/removed-employee-batch-guard.md) for the full reference.

## Treasury Liquidity Forecast Safeguards (#698)

Payroll runs must not drain the treasury below operational minima. The SDK projects per-asset unreserved balances forward across a ledger horizon, applying scheduled cash flows and payroll obligations, and reports the earliest ledger at which any asset would breach its minimum.

The `forecastTreasuryLiquidity` function returns a per-asset forecast report. Assets are evaluated independently, so a surplus in one asset never masks a deficit in another. Use `assertTreasuryLiquiditySafe` to fail fast before submitting a payroll batch.

### Usage

```typescript
import {
  forecastTreasuryLiquidity,
  assertTreasuryLiquiditySafe,
} from '@zk-payroll/core';

const forecast = forecastTreasuryLiquidity(
  {
    startingLedger: 1234567,
    horizonLedgers: 720,
    assets: [
      { asset: 'native', available: 10_000_000n, reserved: 1_000_000n },
      { asset: 'CUSDC.', available: 5_000_000n },
    ],
  },
  [
    { asset: 'native', amount: -2_000_000n, ledgerOffset: 100, label: 'payroll-batch-1' },
    { asset: 'native', amount: 5_000_000, ledgerOffset: 300, label: 'invoice-settlement' },
  ],
  [{ asset: 'CUSDC', amount: 4_000_000 }],
  {
    minimumBalances: { native: 2_000_000, CUSDC: 1_000_000 },
  }
);

if (!forecast.safe) {
  console.error(forecast.message);
  console.error('Earliest breach ledger:', forecast.earliestBreachLedger);
  for (const breach of forecast.breaches) {
    console.error(breach.asset, breach.breachShortfall);
  }
}

// Throws TreasuryForecastError with the first breaching asset when unsafe.
assertTreasuryLiquiditySafe(forecast);
```

## Payout Totals After a Partial Retry (#813)

Retrying only the failed items in a partially successful batch must not double-count items that already settled. `recalculatePayoutTotalsAfterRetry` replays the original attempt and every retry in order and returns the settled total, the amount recovered by retries, and the amount still outstanding, both in aggregate and per asset.

Each item is counted at most once. Items that settled on attempt `1` are final; retries that report them again are rejected with `DUPLICATE_SUCCESS` or `SETTLED_OUTCOME_REVERSED` instead of inflating the total. Validation issues are privacy-safe: item identifiers are masked and amounts, salaries, recipients, and raw employee IDs never appear in errors.

```typescript
import { recalculatePayoutTotalsAfterRetry } from '@zk-payroll/core';

const totals = recalculatePayoutTotalsAfterRetry({
  entries: [
    { itemId: 'line-1', amount: 1_000n, asset: 'USDC' },
    { itemId: 'line-2', amount: 2_500n, asset: 'USDC' },
  ],
  attempts: [
    {
      attempt: 1,
      outcomes: [
        { itemId: 'line-1', outcome: 'succeeded' },
        { itemId: 'line-2', outcome: 'failed' },
      ],
    },
    { attempt: 2, outcomes: [{ itemId: 'line-2', outcome: 'succeeded' }] },
  ],
});

console.log(totals.totalAmount); // 3_500n
console.log(totals.recoveredAmount); // 2_500n
```

See [partial-retry-payout-totals.md](../packages/core/docs/partial-retry-payout-totals.md) for the full reference.

## Paused Contract Reserve Release Guard (#814)

Treasury reserve releases must not be submitted while the payroll contract is paused. `validateTreasuryReserveRelease` accepts an optional decoded pause state and rejects the release with `TREASURY_RESERVE_CONTRACT_PAUSED` when the contract is paused globally or when the `reservations` or `withdrawals` category is paused. `assertTreasuryReserveReleaseNotPaused` lets callers fail fast before building a request.

The rejection is actionable and privacy-safe: it names the public pause state and remediation only, never amounts, salaries, or employee data. Unrelated categories (for example `payroll` or `proofs`) do not block reserve releases.

```typescript
import {
  assertTreasuryReserveReleaseNotPaused,
  validateTreasuryReserveRelease,
} from '@zk-payroll/core';

assertTreasuryReserveReleaseNotPaused({ isPaused: true });
// throws TreasuryReserveReleaseValidationError: TREASURY_RESERVE_CONTRACT_PAUSED

const result = validateTreasuryReserveRelease(request, reserve, Date.now(), {}, {
  pausedCategories: ['reservations'],
});
// throws until the reservations pause is lifted
```

## Reserve Reduction Authorization Context (#772)

`TreasuryReservationClient.release` and `.finalize` require an authorization context. The operator address must match the transaction signer, and its resolved roles must include `PAYROLL_ADMIN`, `TREASURY`, or `EMPLOYER`; integrations may narrow that role set with `requiredRoles`. Resolve roles from a trusted authorization source before calling the client. The context is an SDK preflight guard; the contract remains authoritative. Rejections use `ReserveReductionAuthorizationError` with a stable code and do not include operator or payroll data.

## Settlement Window Overlap Preflight (#770)

`planPayrollExecution` can compare a proposed settlement window with scheduled windows by passing `settlementWindow.existingWindows`. Intervals are half-open: a window ending at the exact time another opens is allowed, while any positive intersection blocks the plan with `settlement-window-overlap`. Invalid or non-increasing interval timestamps fail closed with a privacy-safe message.

```typescript
const plan = planPayrollExecution({
  ...payrollInputs,
  settlementWindow: {
    opensAt,
    closesAt,
    existingWindows: scheduledWindows,
  },
});
```

## Concurrent Approval State Changes (#773)

Persist approval changes with `updateApprovalStateIfCurrent(store, expectedVersion, nextState)`. The store must provide an atomic `compareAndSet(expectedVersion, nextVersion, nextState)` operation; do not implement it as a separate read and write. A concurrent update fails with `APPROVAL_CONCURRENT_MODIFICATION`, so stale state is never written over a newer approval. Invalid versions and storage failures use `APPROVAL_VERSION_INVALID` and `APPROVAL_STATE_WRITE_FAILED`. These errors do not include approval payloads.

```typescript
const committedVersion = await updateApprovalStateIfCurrent(
  approvalStore,
  current.version,
  nextState
);
```

## Replay-Safe Payroll Submission (#769)

`PayrollService.processPaymentReplaySafe` requires an explicit non-empty idempotency key and binds it to a SHA-256 fingerprint of the normalized recipient, amount, and asset. Repeating the same request replays the in-flight or cached result; reusing its key for changed payment data fails with `IDEMPOTENCY_KEY_REUSED` before proof generation or contract submission. Missing keys fail with `IDEMPOTENCY_KEY_REQUIRED`. The fingerprint is not returned or logged.
