# Event Fixtures & Snapshot Testing

This directory contains deterministic event fixtures and snapshot tests that lock contract event parsing behavior. This ensures event parser drift is caught early and gives contributors quick feedback when event schemas change.

## Why Fixtures?

Contract event schemas are a critical interface. Silent drift in parsing can break dashboards and cause operational issues. By snapshotting parser output, we:

- **Detect Schema Changes** — When contract events change format, tests fail immediately
- **Prevent Parser Regression** — Changes to parsers are visible in snapshot diffs
- **Lock Deterministic Output** — Event parsing is reproducible and testable
- **Document Event Structure** — Fixtures serve as executable documentation

## Structure

```
src/testing/fixtures/events/
├── PayrollEventFixtures.ts       # Payroll contract events
├── TreasuryEventFixtures.ts      # Treasury/reservation events
└── DisputeEventFixtures.ts       # Dispute events

tests/
├── event-snapshots.test.ts       # Positive snapshot tests
├── event-snapshots-negative.test.ts  # Malformed event handling
└── __snapshots__/
    └── event-snapshots.test.ts.snap  # Jest snapshot file
```

## Fixture Versioning

All fixtures are pinned to **Schema Version 1.0**. When contract events change:

### Minor Changes (New Optional Fields)

1. Add new optional fields to fixture data
2. Snapshots update automatically
3. Parser should handle missing fields gracefully

### Major Changes (Breaking Schema)

1. Create new fixture file: `PayrollEventFixtures_v2.ts`
2. Keep v1 fixtures for backward compatibility testing
3. Update parser to support both versions
4. Add migration documentation

## Using Fixtures

### In Tests

```typescript
import { getAllPayrollEventFixtures } from "../src/testing/fixtures/events/PayrollEventFixtures";
import { parseContractEvents } from "../src/event-parser";

it("handles payroll events", () => {
  const fixtures = getAllPayrollEventFixtures();
  const results = parseContractEvents(fixtures);
  
  expect(results).toHaveLength(7); // All events parsed
});
```

### In Mocks

```typescript
import { createPaymentExecutedEventFixture } from "../src/testing/fixtures/events/PayrollEventFixtures";

// Use in test setup
const mockEvent = createPaymentExecutedEventFixture();
mockContract.emit(mockEvent);
```

## Event Categories

### Payroll Events (7 types)

- `registered` — Payroll batch registration
- `registryUpdated` — Registry metadata update
- `committed` — Salary commitments recorded
- `salaryRevealed` — Salaries revealed/proven
- `paymentExecuted` — Payment executed successfully
- `paymentScheduled` — Payment scheduled for future
- `paymentCancelled` — Scheduled payment cancelled

### Treasury Events (4 types)

- `reservationCreated` — Funds reserved
- `reservationReleased` — Funds released/returned
- `reservationFinalized` — Payroll completed, funds finalized
- `reservationExpired` — Reservation timed out

### Dispute Events (5 types)

- `opened` — Dispute opened
- `updated` — Dispute updated
- `resolved` — Dispute resolved
- `appealed` — Dispute appealed
- `closed` — Dispute closed

## Updating Fixtures

### When Contract Events Change

1. **Identify the change** — What new fields were added? What schema version?

2. **Update fixture file**:
   ```typescript
   export function createPaymentExecutedEventFixture(): RawContractEvent {
     return {
       // ... existing fields ...
       data: {
         // ... existing data ...
         newField: "new_value", // ← Add here
         schemaVersion: "1.1",  // ← Update version
       },
     };
   }
   ```

3. **Update parser** to handle the new field (if needed)

4. **Run snapshot update**:
   ```bash
   npm test -- event-snapshots.test.ts --updateSnapshot
   ```

5. **Verify snapshot diff** — Review what changed:
   ```bash
   git diff tests/__snapshots__/event-snapshots.test.ts.snap
   ```

6. **Document the change** — Add a note to this README explaining the schema evolution

### When Parser Behavior Changes

1. **Verify the change is intentional** — This should be code review discussion

2. **Update snapshots**:
   ```bash
   npm test -- event-snapshots.test.ts --updateSnapshot
   ```

3. **Review the diff carefully** — Ensure parser behavior is correct

4. **Commit the snapshot** with the parser change

## Snapshot Workflow

### First Time Setup

Snapshots are auto-generated:
```bash
npm test -- event-snapshots.test.ts
```

This creates `tests/__snapshots__/event-snapshots.test.ts.snap`.

### After Changes

Run tests again:
```bash
npm test -- event-snapshots.test.ts
```

If snapshots are outdated, update with:
```bash
npm test -- event-snapshots.test.ts --updateSnapshot
```

Then review the diff:
```bash
git diff tests/__snapshots__/
```

### CI Integration

In CI, snapshots should **never auto-update**. Tests fail if snapshots don't match, forcing code review of any schema changes.

## Testing Malformed Events

The negative tests (`event-snapshots-negative.test.ts`) verify that:

- Missing required fields are rejected or classified
- Unknown event types fail safely
- Invalid enum values default gracefully
- Null/empty data is handled
- Extreme values don't crash

These tests ensure parser robustness against contract bugs or drift.

## Determinism Guarantees

All fixtures use:
- **Fixed timestamps** — UNIX 1700000000 (base for all event times)
- **Fixed ledger sequences** — Deterministic increments
- **Fixed IDs** — Predictable UUIDs/IDs for repeatability
- **Fixed amounts** — Deterministic stroops values

This means:
- Running tests multiple times produces identical snapshots
- Snapshots are human-readable and diffable
- No flaky tests due to timestamp variation

## Schema Evolution Examples

### Example 1: Adding Optional Field

**Before:**
```typescript
data: { dispute_id: "test", category: "payment_mismatch" }
```

**After:**
```typescript
data: { 
  dispute_id: "test", 
  category: "payment_mismatch",
  new_metadata: "value" // ← Optional field added
}
```

**Action:** Update fixture, snapshot updates automatically.

### Example 2: Breaking Schema Change

**Before (v1.0):**
```typescript
{ dispute_id: "test", status: "opened" }
```

**After (v2.0):**
```typescript
{ id: "test", state: "created" } // ← Breaking change
```

**Action:**
1. Create `DisputeEventFixtures_v2.ts` with new schema
2. Update parser to support both versions
3. Add v1→v2 migration logic
4. Keep old fixtures for backward compat tests

## Maintenance Checklist

When updating fixtures:

- [ ] Fixtures compile without errors
- [ ] All snapshot tests pass
- [ ] Negative tests still reject malformed events
- [ ] Snapshots are reviewed in git diff
- [ ] Parser handles both old and new formats (if applicable)
- [ ] Documentation is updated (this README)
- [ ] Schema version metadata is correct

## Troubleshooting

### Snapshots won't update

Ensure you're using the correct Jest flag:
```bash
npm test -- event-snapshots.test.ts --updateSnapshot
# NOT: npm test -- --updateSnapshot
```

### Different snapshots locally vs CI

Check for:
- Environment-dependent data (timestamps, random IDs)
- Node version differences
- Missing fixture initialization

Verify fixtures are deterministic:
```typescript
const snap1 = createPaymentExecutedEventFixture();
const snap2 = createPaymentExecutedEventFixture();
expect(JSON.stringify(snap1)).toBe(JSON.stringify(snap2));
```

### Parser changes break many snapshots

Review the parser change carefully:
- Is this intentional behavior change or a bug?
- Do old event formats still work?
- Should we support both formats?

If breaking, create a new fixture file for the new schema version.

## References

- [Jest Snapshot Testing](https://jestjs.io/docs/snapshot-testing)
- [Event Parser Documentation](../../event-parser.ts)
- [Dispute Event Parser](../../disputes/DisputeEventParser.ts)
