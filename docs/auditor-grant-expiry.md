# Auditor Grant Expiry

> **File:** `packages/core/src/audit/accessExpiry.ts`
> **Typed validation:** `packages/core/src/audit/grantExpiryValidation.ts`
> **Safe errors:** `packages/core/src/audit/grantExpiryErrors.ts`
> **State machine:** `packages/core/src/audit/grantExpiryState.ts`
> **Tests:** `packages/core/tests/audit/auditor-grant-expiry-*.test.ts`

---

## Overview

Auditor grants are time-boxed. A compliance dashboard that renders a stale
grant as active risks over-disclosure; one that treats a live grant as lapsed
blocks a legitimate review. This document defines the single set of rules used
by `@zk-payroll/core` when describing an auditor's access.

These rules apply to every consumer of `formatAuditorAccessExpiry()`,
`validateAuditorGrantExpiry()`, `assertAuditorGrantActive()`, and
`AuditorGrantExpiryStateManager`.

## Statuses

| Status          | Meaning                                                                 | Gate result |
| --------------- | ----------------------------------------------------------------------- | ----------- |
| `active`        | `expiresAt - referenceTime > warningThresholdMs`                         | allow       |
| `expiring_soon` | `0 < expiresAt - referenceTime <= warningThresholdMs`                    | allow, warn |
| `expired`       | `expiresAt <= referenceTime`                                             | deny        |
| `unknown`       | No parseable expiration timestamp is available                           | deny        |
| `revoked`       | An administrator revoked the grant (terminal state machine status only)  | deny        |

Defaults:

- `DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS` = **48 hours**.
- `DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS` = **30 days**.
- The warning threshold is bounded at 365 days (`MAX_GRANT_EXPIRY_WARNING_THRESHOLD_MS`).

`expiresAt` accepts epoch milliseconds, numeric strings, ISO-8601 strings, and
`Date` instances. All are normalized to epoch milliseconds.

## Purging

`isPurged` is derived from the retention window, not from the ACL status:

- A descriptor is purged only when `referenceTime - expiresAt > retentionWindowMs`.
- The comparison is **strict**: at exactly `expiresAt + retentionWindowMs` the
  record is still retained.
- With `retentionWindowMs: 0`, any elapsed expiration is purged, but a future or
  exactly-current expiration is not.

A purged descriptor omits the raw `auditorId` and carries a redacted identifier:

```typescript
formatAuditorAccessExpiry({
  auditorId: "GAUDITOR123456789WXYZ",
  expiresAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
})
// => { status: "expired", isPurged: true, auditorId: undefined,
//       redactedAuditorId: "[REDACTED_AUDITOR]" }
```

## Validation

`validateAuditorGrantExpiry()` is non-throwing and accumulates every issue:

```typescript
import {
  validateAuditorGrantExpiry,
  formatAuditorGrantExpiryError,
} from "@zk-payroll/core";

const result = validateAuditorGrantExpiry({
  auditorId,
  grantedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z",
  referenceTime: Date.now(),
});

if (!result.isValid) {
  render(formatAuditorGrantExpiryError({ issues: result.issues }));
} else {
  render(result.normalized.descriptor.label);
}
```

The normalized result exposes `expiresAtMs`, optional `grantedAtMs`,
`referenceTimeMs`, `warningThresholdMs`, `retentionWindowMs`, `status`,
`isPurged`, and the formatted descriptor. Issue messages name only the failing
field and the remediation.

Use `assertValidAuditorGrantExpiry()` or `assertAuditorGrantActive()` when a
throw is preferable. Both throw the typed, privacy-safe errors described below.

## Versioned state (#908)

Expiry is also available as an optimistic-concurrency state machine:

```typescript
import { AuditorGrantExpiryStateManager } from "@zk-payroll/core";

const manager = new AuditorGrantExpiryStateManager();
const { state } = manager.initializeGrant({
  grantId: "grant-42",
  auditorId,
  grantedAtMs: Date.now(),
  expiresAtMs: Date.now() + 72 * 60 * 60 * 1000,
});

const next = manager.update({
  grantId: "grant-42",
  expectedRevision: state.revision,
  targetStatus: "expiring_soon",
  referenceTimeMs: state.expiresAtMs - 60 * 60 * 1000,
});
```

Rules enforced by `applyAuditorGrantExpiryUpdate()`:

- The first revision must use `expectedRevision: 0`. Every later write must name
  the current revision; a stale write throws `STALE_REVISION`.
- Allowed transitions are `active ⇄ expiring_soon → expired → purged`, plus
  `revoked` from any non-terminal state. `purged` and `revoked` are immutable.
- `grantedAtMs`, `expiresAtMs`, `warningThresholdMs`, and `retentionWindowMs` are
  immutable after initialization; timestamps must be finite positive
  epoch-millisecond values.
- `referenceTimeMs` never moves backwards.
- `purged` requires an expired grant whose retention window has fully elapsed.
- Each revision is SHA-256 hash-chained through `previousHash`.
  `verifyIntegrity(grantId)` reports the first broken revision if a persisted
  history was modified.

Only a redacted auditor identifier is stored in a state revision. Raw auditor
ids never enter a revision, its hash, its history, or an error.

## Safe errors (#905, #908)

| Helper | Purpose |
| --- | --- |
| `isAuditorGrantExpiryError(error)` | Narrow typed expiry errors. |
| `isAuditorGrantExpiredError(error)` | Narrow the access-denied error. |
| `getAuditorGrantExpiryErrorMessage(error)` | Extract a canonical safe message. |
| `formatAuditorGrantExpiryError(error)` | Render every failing field for UI/CLI output. |

`AuditorGrantExpiredError` includes a redacted auditor identifier and the
bounded ISO-8601 expiry timestamp so an operator can identify the grant without
seeing private data:

```typescript
import { getAuditorGrantExpiryErrorMessage } from "@zk-payroll/core";

try {
  assertAuditorGrantActive({ auditorId, expiresAt: pastTimestamp });
} catch (error) {
  log(getAuditorGrantExpiryErrorMessage(error));
  // => "Auditor access has expired. Request a new grant before accessing payroll data."
}
```

Unknown errors never have their raw message forwarded. The fallback is a
generic "auditor grant expiry error" notice.

## Operator checklist

- Treat `unknown` and `expired` identically at access gates.
- Refresh grant state before every privileged audit export, not only at login.
- Escalate `STATE_INTEGRITY_COMPROMISED` immediately; do not repair hashes by
  rewriting history.
- Keep purged records for compliance reporting only; they cannot authorize
  access.

## Related documentation

- [Audit Grant Scope Reader](./audit-grant-scope.md) — widest currently usable
  scope across multiple grants.
- [Payout Batch Retry Errors](./payout-batch-retry-errors.md) — the analogous
  safe-error surface for retry toolchains.
