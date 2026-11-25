# Audit Grant Period Boundaries (#832)

Auditor grants scope access to a payroll period. When several grants cover
consecutive periods, their boundaries must line up exactly. An overlap lets one
grant read records from another period; a gap leaves part of the payroll
history outside every grant.

## Behavior

Periods are half-open ISO-8601 intervals `[periodStart, periodEnd)`.

`validateAuditGrantPeriodBoundaries(grants, options?)`:

1. Requires parseable `periodStart` / `periodEnd` timestamps.
2. Requires `periodEnd` to be strictly after `periodStart`.
3. Orders grants chronologically (input order is irrelevant).
4. Rejects overlaps (`AUDIT_GRANT_OVERLAPPING_PERIODS`) and identical periods
   (`AUDIT_GRANT_DUPLICATE_PERIOD`).
5. Requires consecutive periods to be exactly adjacent:
   `previous.periodEnd === next.periodStart`. Gaps are reported as
   `AUDIT_GRANT_NON_ADJACENT_PERIODS` unless `{ allowGaps: true }` is passed.

The returned `orderedPositions` refers to the original input array. Issues
carry positions and a redacted grantee only — never the full identity or the
period dates in error text.

```ts
import {
  validateAuditGrantPeriodBoundaries,
  assertValidAuditGrantPeriodBoundaries,
} from "@zk-payroll/core";

const result = validateAuditGrantPeriodBoundaries(grants);
if (!result.isValid) {
  console.error(result.issues);
}

// Throwing variant; returns grants in chronological order.
const ordered = assertValidAuditGrantPeriodBoundaries(grants);
```

## Boundary case

`periodEnd` of the earlier grant equalling `periodStart` of the later grant is
valid. One millisecond later is a gap; one millisecond earlier is an overlap.
