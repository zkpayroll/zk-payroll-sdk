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
