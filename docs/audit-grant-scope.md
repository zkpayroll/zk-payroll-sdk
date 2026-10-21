# Audit Grant Scope Reader

> **File:** `packages/core/src/audit/grantScope.ts`
> **Tests:** `packages/core/tests/audit-grant-scope-reader.test.ts`

---

## Overview

`readEffectiveAuditGrantScope()` answers a single question for a compliance
dashboard, an API route, or a pre-share check:

> *What audit access does this auditor actually have right now?*

An auditor rarely holds a single grant. Over time they accumulate a short
`read-only` window, a later `full-audit` grant, an older grant that quietly
expired, and maybe one an admin revoked. Reading one stored record tells you
what *was* granted — not what is *usable now*. The reader folds every grant
into one typed answer: the **widest scope currently in force** plus the
**lifecycle state** that produced it.

## Why It Matters

A payroll integration that gates on the wrong record can fail in two ways, and
both are privacy-relevant:

- **Over-blocking** a legitimate auditor because it inspected a lapsed grant
  instead of the live one.
- **Over-disclosing** departmental breakdowns by honouring a `full-audit`
  grant that actually expired last month.

The reader is fail-closed: it only counts grants that are live at the reference
time, so a stale wide grant can never widen current access.

## Contract Alignment

| Reader concept                | Contract surface            | Notes                                     |
| ----------------------------- | --------------------------- | ----------------------------------------- |
| `AuditGrantRecord.scope`      | `ViewKeyScope` enum         | `"read-only"` or `"full-audit"`           |
| `grantedBy`                   | caller Stellar public key   | Must be an authorised admin address       |
| `expiresAt`                   | `expires_at` (u64 Unix)     | Grants store ISO-8601; convert before RPC |
| `revokedAt`                   | `revoke_view_key`           | Absent when the grant was never revoked   |

Scope ranking is fixed and exported as `AUDIT_GRANT_SCOPES`
(`["read-only", "full-audit"]`), narrowest first.

## Privacy Properties

- **Metadata only.** The report carries grant ids, scopes, states, and
  timestamps. It never carries view-key tokens, secret keys, salaries, or
  employee records — and it does not copy unknown fields off the source
  record, so a persisted `ViewKey` row's `keyId` never leaks into a report.
- **Masked messages.** Every `message` string is safe to log verbatim:
  grantee and granting-admin addresses are masked via `redactAuditorId`
  (`GBS***JHR`). Use `entry.redactedGrantee` for UI labels.
- **Safe errors.** `ValidationError`s name the offending field path
  (`grants[0].scope`) and the grant id. They never echo scope payloads, key
  material, or payroll values.

## API Reference

### `readEffectiveAuditGrantScope(grants, now?)`

Folds a set of grants into a per-grantee effective-access report.

```ts
import { readEffectiveAuditGrantScope } from "@zk-payroll/core";

const report = readEffectiveAuditGrantScope(grants);

for (const entry of report.grantees) {
  console.log(entry.redactedGrantee, entry.scope, entry.state);
  // "GBS***JHR" "read-only" "active"
  console.log(entry.message);
  // "Auditor GBS***JHR: read-only via 1 active grant (narrowest grant expires in 184d)"
}
```

**Parameters**

| Name     | Type                 | Description                                            |
| -------- | -------------------- | ------------------------------------------------------ |
| `grants` | `AuditGrantRecord[]` | Persisted grants; may cover several grantees           |
| `now`    | `Date`               | Reference time. Defaults to `new Date()`               |

**Returns** `AuditGrantScopeReport`

| Field              | Meaning                                                      |
| ------------------ | ------------------------------------------------------------ |
| `allGranteesActive`| `true` only when **every** grantee has at least one live grant |
| `grantees`         | Per-grantee entries, sorted by grantee (codepoint order)      |
| `activeGrantees`   | Entries whose `state` is `"active"`                          |
| `inactiveGrantees` | Entries with no live access                                   |
| `message`          | One-line summary naming only the inactive grantees, masked    |

**Throws** `ValidationError` with a stable `code`:

| Code                            | Cause                                             |
| ------------------------------- | ------------------------------------------------- |
| `AUDIT_GRANTS_INVALID`          | `grants` is not an array                          |
| `AUDIT_GRANT_INVALID`           | An entry is not an object                         |
| `AUDIT_GRANT_ID_REQUIRED`       | Missing/blank `grantId`                           |
| `AUDIT_GRANT_ID_DUPLICATE`      | Two records share a `grantId`                     |
| `AUDIT_GRANTEE_REQUIRED`        | Missing/blank `grantee`                           |
| `AUDIT_GRANT_SCOPE_INVALID`     | `scope` is not a known `ViewKeyScope`              |
| `AUDIT_GRANT_TIMESTAMP_INVALID` | Unparseable `grantedAt` / `revokedAt`, or bad `now`|
| `AUDIT_GRANT_EXPIRY_INVALID`    | Unparseable `expiresAt`                           |
| `AUDIT_GRANT_LIFECYCLE_INVALID` | `expiresAt` or `revokedAt` precedes `grantedAt`   |

### Effective grant rules

For each grantee:

- `grants` — every supplied grant, sorted `grantedAt` ascending, each with a
  resolved `state` of `"active" | "expired" | "revoked"`.
- `scope` — the widest scope among grants whose state is `"active"`, or `null`
  when nothing is live. Never wider than what was actually granted.
- `state` — the effective lifecycle:

  | Value     | When                                                             |
  | --------- | ---------------------------------------------------------------- |
  | `active`  | At least one grant is live (and `scope` is non-null)             |
  | `expired` | No live grant, but at least one lapsed by time                  |
  | `revoked` | No live grant, and every past grant was revoked                 |
  | `none`    | No grant was ever supplied for this grantee                     |

  Expiry outranks revocation: a lapsed grant is recoverable by re-granting,
  whereas `"revoked"` signals a deliberate administrative action that should
  stay visible on a dashboard.

- `latestChangeAt` — the most recent `grantedAt` / `expiresAt` / `revokedAt`
  across the grantee's grants, or `null` when never granted.

### `resolveAuditGrantState(grant, now?)`

Lifecycle state of a single grant. Precedence is `revoked → expired → active`,
so a deliberately revoked grant never looks merely "lapsed" to a caller
deciding whether to re-issue it.

```ts
resolveAuditGrantState(grant, new Date("2026-07-01T00:00:00Z")); // "active"
```

### `getAuditGrantRevocationStatusForClient(provider, grantee, now?)`

Loads grants from an async provider and reports whether the grantee has any
explicitly revoked grant, including when a separate grant is still active.
Grantee identifiers in the result are masked. Provider exceptions are replaced
with a stable SDK error so backend messages and payroll data are not exposed.

```ts
import { getAuditGrantRevocationStatusForClient } from "@zk-payroll/core";

const status = await getAuditGrantRevocationStatusForClient(
  () => grantStore.list(),
  auditorAddress
);
console.log(status.state, status.hasRevokedGrant, status.revokedGrantCount);
```

The result includes effective `state` (`active`, `expired`, `revoked`, or
`none`), `hasRevokedGrant`, `revokedGrantCount`, `grantCount`, and
`latestRevokedAt`. `AuditGrantStatusClientError` uses
`AUDIT_GRANT_STATUS_INVALID_GRANTEE`, `AUDIT_GRANT_STATUS_INVALID_TIME`,
`AUDIT_GRANT_STATUS_INVALID_DATA`, or `AUDIT_GRANT_STATUS_UNAVAILABLE` for
actionable failure handling.

### `selectWidestAuditScope(scopes)`

Widest scope in a collection, or `null` when empty. Unrecognised values are
ignored so a partially-decoded record cannot widen the result.

### `auditScopeSatisfies(effectiveScope, requiredScope)`

Guard for feature gating. A `null` scope (no live grant) **never** satisfies a
requirement.

```ts
if (!auditScopeSatisfies(entry.scope, "full-audit")) {
  // Either no live grant, or only read-only is in force.
}
```

## End-to-End Usage Pattern

```ts
import { readEffectiveAuditGrantScope, auditScopeSatisfies } from "@zk-payroll/core";

const report = readEffectiveAuditGrantScope(persistedGrants);

if (!report.allGranteesActive) {
  // Actionable and privacy-safe — addresses are masked.
  console.warn(report.message);
  // "1 of 2 grantee(s) have no live audit access: GBS***JHR"
}

for (const entry of report.grantees) {
  if (!auditScopeSatisfies(entry.scope, "full-audit")) {
    console.log(`${entry.redactedGrantee} limited to ${entry.scope ?? "no access"} (${entry.state})`);
    continue;
  }
  // Safe to include departmental breakdowns for this reviewer.
  await buildSelectiveDisclosurePackage(entry.grants);
}
```

## Manual QA

Beyond the automated suite, the following can be checked by hand against a
fixture store:

1. **Main path** — grant a `read-only` and a `full-audit` window to one auditor,
   both with future expiries. `report.grantees[0].scope` is `"full-audit"`,
   `state` is `"active"`, and `activeGrantIds` lists both grant ids.
2. **Edge case** — let the `full-audit` window lapse. The same call now reports
   `scope: "read-only"`, and the lapsed grant shows `state: "expired"`. No
   departmental data should be released for that auditor.

## Running the Tests

```bash
npm test -w packages/core -- audit-grant-scope-reader
# or run the full suite:
npm test
```

The test file covers the main path (widest live scope wins, deterministic
ordering, multi-grantee partitioning), the stale-grant edge cases (expired,
revoked, exact-expiry boundary, expired-over-revoked precedence), privacy
(masked messages, dropped credential material, payload-free errors), and every
validation code.

## Related

- [Audit View-Key Helpers](./audit-view-keys.md) — create and revoke view keys
- [Selective-Disclosure Audit Packages](./audit-packages.md) — build the
  packages a scoped auditor is allowed to receive
- [Safe Credential Handling](./SAFE_CREDENTIAL_HANDLING.md) — keeping keys and
  payroll data out of logs
