# Edge Payroll Scenario Fixtures

Deterministic, privacy-safe test fixtures for **difficult payroll states** that
contributors routinely need when building features. Instead of inventing their
own inconsistent data, import one of the pre-seeded scenarios.

Covers the scenarios tracked in
[issue #330](https://github.com/zkpayroll/zk-payroll-sdk/issues/330).

## Scenario list

| `id`                  | What it represents                                        | Expected state (summary)                                                              |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `expired-reservation` | Funding reservation that lapsed without finalization      | `status: "expired"`, `isExpired: true`, `isTerminal: true`, `blocksPayroll: true`     |
| `compliance-hold`     | Batch where one employee failed KYC/AML verification      | Exactly one ineligible employee, `primaryReasonCode: "COMPLIANCE_BLOCKED"`             |
| `active-dispute`      | Critical, unresolved payment-mismatch dispute             | `status: "opened"`, `severity: "critical"`, `blocksOperations: true`                  |
| `stale-draft`         | Structurally valid draft untouched for many pay cycles    | `isStale: true`, `ageDays >= 90`, `requiresAction: true`                              |
| `network-mismatch`    | Reservation created on one network, runtime targets another | `mismatch: true`, every RPC attempt failed, `blocksPayroll: true`                     |
| `duplicate-release`   | Release event emitted twice for the same reservation      | Classified `duplicate_release_attempt`, detected by reservation issue helpers         |

Every fixture pairs raw `data` with an `expectedState` object that documents
exactly what any consumer should observe. The stability tests in
`packages/core/tests/edge-fixtures.test.ts` assert those expectations —
including by running the fixtures through the real SDK logic (reservation
helpers, eligibility evaluator, dispute parser, and offline draft validator) —
so fixtures can never silently drift from the SDK's behaviour.

## Importing

Fixtures are exported from the package root, exactly like the rest of the
testing utilities:

```ts
import {
  createExpiredReservationFixture,
  createComplianceHoldFixture,
  createActiveDisputeFixture,
  createStaleDraftFixture,
  createNetworkMismatchFixture,
  createDuplicateReleaseFixture,
  createEdgePayrollScenario,
  getAllEdgePayrollScenarios,
  EDGE_FIXTURE_DEFAULT_SEED,
} from "@zk-payroll/core";

// One scenario, default seed
const expired = createExpiredReservationFixture();

// One scenario, explicit seed
const dispute = createEdgePayrollScenario("active-dispute", 2024);

// All six scenarios
const scenarios = getAllEdgePayrollScenarios(1337);
```

In this repository's source tree the same helpers are available from:

```ts
import { createComplianceHoldFixture } from "../src/testing/scenarios";
// or the module root
import { createComplianceHoldFixture } from "../src";
```

### In unit tests

```ts
import { createExpiredReservationFixture } from "@zk-payroll/core";
import { isReservationExpired, isReservationTerminal } from "@zk-payroll/core";

test("expired reservation blocks payroll", () => {
  const { reservation, referenceTimestamp } = createExpiredReservationFixture().data;
  expect(isReservationExpired(reservation, referenceTimestamp)).toBe(true);
  expect(isReservationTerminal(reservation)).toBe(true);
});
```

### In integration tests

Each scenario's `expectedState` doubles as an assertion contract:

```ts
import { createComplianceHoldFixture, evaluateBatchEligibility } from "@zk-payroll/core";

test("compliance hold blocks exactly one employee", () => {
  const scenario = createComplianceHoldFixture();
  const { employees, referenceTimestamp } = scenario.data;
  const batch = evaluateBatchEligibility(employees, { referenceTimestamp });

  expect(batch.ineligibleCount).toBe(scenario.expectedState.ineligibleCount);
  expect(batch.ineligibleCount).toBe(1);
});
```

## Determinism

- `Fixture generation is deterministic by seed.` The same seed always produces
  an identical fixture, across runs, machines, and test environments. There is
  **no** `Date.now()` or `Math.random()` anywhere in the generators.
- Pass an explicit seed when you want repeatable data, or rely on
  `EDGE_FIXTURE_DEFAULT_SEED` for the named helpers.
- Different seeds produce different (but equally valid) fixtures, useful for
  parametrised test matrices.

## Privacy

- **No fixture includes real personal or payroll data.** Employee IDs are
  synthetic (`emp_1234`), names are placeholders (`Employee 1234`), and every
  address, amount, and hash is derived from the seed.
- Stellar addresses are generated as checksum-valid Ed25519 public keys so they
  pass `StrKey.isValidEd25519PublicKey`, but they are freshly derived per seed
  and never point at real accounts.
- The `tests/edge-fixtures.test.ts` suite scans every fixture string and asserts
  there are no email addresses, no realistic personal names, and no repeated
  addresses across roles.

## Stability

`packages/core/tests/edge-fixtures.test.ts` verifies:

1. **Determinism** — regenerating with the same seed is deeply equal.
2. **Expected state** — each scenario's `expectedState` matches both the data
   and the output of the real SDK functions.
3. **Privacy** — no personal or payroll data, no email addresses, no repeated
   addresses.
4. **Coverage** — every id in `EDGE_SCENARIO_IDS` is produced by the factory.

If you change SDK behaviour that these fixtures describe, update the fixtures
and their tests in the same change.
