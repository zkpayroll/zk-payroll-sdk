# Contract Event Schema Reference

> **Contracts repo:** [`zkpayroll/zk-payroll-contracts`](https://github.com/zkpayroll/zk-payroll-contracts)  
> **SDK parser:** [`packages/core/src/event-parser.ts`](../packages/core/src/event-parser.ts)  
> **Audit normalizer:** [`packages/core/src/audit/eventNormalizer.ts`](../packages/core/src/audit/eventNormalizer.ts)  
> **Webhook types:** [`packages/core/src/webhooks/types.ts`](../packages/core/src/webhooks/types.ts)  
> **Tests:** [`packages/core/tests/event-parser.test.ts`](../packages/core/tests/event-parser.test.ts)  
> **Status:** Living document — updated alongside any contract ABI change.

This document is the single source of truth for **every event** the ZK
Payroll system emits: on-chain Soroban contract events, backend webhook
events, and where each event surfaces downstream. SDK contributors,
dashboard authors, and third-party indexer operators should all be able
to read this page and immediately know the topic layout, data schema,
and intended consumers of any event in the system.

---

## Table of Contents

1. [Event Taxonomy](#event-taxonomy)
2. [Master Event Registry](#master-event-registry)
3. [On-Chain Contract Events](#on-chain-contract-events)
   - [Employee / Registry](#employee--registry-events)
   - [Payroll (Private Salary Lifecycle)](#payroll-events)
   - [Treasury / Payments](#treasury--payments-events)
4. [Proof Events](#proof-events)
5. [Backend Webhook Events](#backend-webhook-events)
   - [Payroll Run Outcomes](#payroll-run-outcomes)
   - [Transaction Lifecycle](#transaction-lifecycle)
   - [Audit / Compliance](#audit--compliance)
6. [Consumer Matrix](#consumer-matrix)
7. [Indexer Guide](#indexer-guide)
8. [Decoding Reference](#decoding-reference)
9. [Versioning & Compatibility](#versioning--compatibility)
10. [Cross-References](#cross-references)

---

## Event Taxonomy

The ZK Payroll system emits events from **two distinct sources**, each
with its own encoding, delivery mechanism, and consumer patterns:

| Source | Encoding | Delivery | Primary Consumers |
|---|---|---|---|
| **On-chain contract events** | Soroban `ScVal` (XDR) | RPC `getEvents`, public indexers | SDK parser, dashboards, public indexers, compliance pipelines |
| **Backend webhook events** | JSON, HMAC-SHA256 signed | HTTPS POST to subscribed endpoints | Backend services, compliance exports, audit storage |

Both streams converge inside the SDK via
[`normalizeAuditEvent`](../packages/core/src/audit/eventNormalizer.ts),
which produces a unified `AuditEvent` shape regardless of origin. See
[`Audit View-Key Helpers`](./audit-view-keys.md) for the unified
shape reference.

### Categories

Every event falls into one of five **business categories** that the doc
uses throughout:

| Category | Scope |
|---|---|
| **Payroll** | Private salary lifecycle (commit, reveal) |
| **Employee / Registry** | HR records (register, update, deactivate) |
| **Treasury / Payments** | Fund movement (execute, schedule, cancel) |
| **Audit / Compliance** | View-key lifecycle, payroll run outcomes |
| **Proof Verification** | ZK proof attestation (see [Proof Events](#proof-events) — note the gap) |

---

## Master Event Registry

Quick-reference matrix for every event. The "First emitted" column maps
to the contract ABI version; see [Versioning](#versioning--compatibility)
for the current target version. Values marked **(assumed)** reflect
the current SDK target ABI — verify against the contracts repo for
the exact emission history.

### On-Chain Contract Events

| Event | Category | Source Contract Function | Topics Layout | Data Fields | First Emitted |
|---|---|---|---|---|---|
| [`registered`](#registered) | Employee | `register_payroll` | `[name, employer, employee]` | `salary (i128)`, `token (address)` | ABI `0.1.0` (assumed) |
| [`registry_updated`](#registry_updated) | Employee | `update_payroll` | `[name, employer, employee]` | `salary (i128)` | ABI `0.1.0` (assumed) |
| [`registry_deactivated`](#registry_deactivated) | Employee | `deactivate_payroll` | `[name, employer, employee]` | _(none)_ | ABI `0.1.0` (assumed) |
| [`committed`](#committed) | Payroll | `commit_salary` | `[name, employer, employee]` | `commitment_hash (bytes)`, `cycle_id (u64)` | ABI `0.1.0` (assumed) |
| [`salary_revealed`](#salary_revealed) | Payroll | `reveal_salary` | `[name, employer, employee]` | `cycle_id (u64)`, `actual_amount (i128)` | ABI `0.1.0` (assumed) |
| [`payment_executed`](#payment_executed) | Treasury | `execute_payment` | `[name, recipient]` | `amount (i128)`, `asset (address)`, `tx_hash (bytes)` | ABI `0.1.0` (assumed) |
| [`payment_scheduled`](#payment_scheduled) | Treasury | `schedule_payment` | `[name, recipient]` | `amount (i128)`, `asset (address)`, `execute_at (u64)`, `payment_id (u64)` | ABI `0.1.0` (assumed) |
| [`payment_cancelled`](#payment_cancelled) | Treasury | `cancel_payment` | `[name]`¹ | `payment_id (u64)` | ABI `0.1.0` (assumed) |

¹ Older contract revisions may also surface `payment_id` directly in `topics[1]`; see the [`payment_cancelled`](#payment_cancelled) section below.

### Backend Webhook Events

| Event | Category | Trigger | Key Fields | Envelope Version |
|---|---|---|---|---|
| [`payroll.completed`](#payrollcompleted) | Audit | Backend payroll worker finishes | `employer`, `cycleId`, `totalDisbursed`, `employeeCount`, `txHash` | `1` |
| [`payroll.failed`](#payrollfailed) | Audit | Backend payroll worker fails | `employer`, `cycleId`, `failureCode`, `reason`, `txHash?` | `1` |
| [`transaction.pending`](#transactionpending) | Audit | Watcher sees pending tx | `txHash`, `confirmations` | `1` |
| [`transaction.confirmed`](#transactionconfirmed) | Audit | Watcher sees confirmed tx | `txHash`, `ledger`, `status: "SUCCESS"` | `1` |
| [`transaction.failed`](#transactionfailed) | Audit | Watcher sees failed tx | `txHash`, `error?`, `status: "FAILED"` | `1` |
| [`audit.view_key_granted`](#auditview_key_granted) | Audit | Admin grants audit view key | `keyId`, `grantedBy`, `scope`, `expiresAt` | `1` |
| [`audit.view_key_revoked`](#auditview_key_revoked) | Audit | Admin revokes view key | `keyId`, `revokedBy`, `revokedAt` | `1` |
| [`audit.view_key_expired`](#auditview_key_expired) | Audit | View key reaches expiry | `keyId`, `expiredAt` | `1` |

---

## On-Chain Contract Events

On-chain events follow the standard Soroban event contract:

- **`topics`** is an `ScVal[]`. Position `0` is always a `ScValSymbol`
  carrying the event name; positions `1..N` are **indexed** parameters
  (typically `Address` ScVals) used for efficient server-side filtering.
- **`data`** is a single `ScVal` — in practice, a `ScValMap` whose keys
  are `ScValSymbol` and whose values carry non-indexed event payload.
- Every event carries ledger metadata on the outer envelope: `contractId`,
  `ledger`, `ledgerClosedAt`, `id`, and `pagingToken`.

The SDK's [`parseContractEvent`](../packages/core/src/event-parser.ts#L161)
function reads `topics[0]` as the event name and dispatches to a
per-event decoder. Indexers should mirror that dispatch when they can't
re-use the SDK directly.

---

### Employee / Registry Events

These events track the **payroll registry** contract instance — the
mapping of `(employer, employee)` → `(salary, token, active)`. They are
emitted by `PayrollRegistryClient`.

#### `registered`

> Source: `PayrollRegistryClient.register({...})`  
> Severity: `info` — `category = "registry"`

A new `(employer, employee)` payroll entry has been created.

**Topics** (3 positions):

| Pos | ScVal Type | Field | Description |
|---|---|---|---|
| 0 | `ScValSymbol` | event name | `"registered"` |
| 1 | `ScValAddress` | `employer` | Stellar public key of the employer |
| 2 | `ScValAddress` | `employee` | Stellar public key of the employee |

**Data** (`ScValMap`):

| Key | ScVal Type | Decoded JS Type | Description |
|---|---|---|---|
| `salary` | `ScValI128` | `bigint` | Salary amount in stroops (signed for future negative-balance support) |
| `token` | `ScValAddress` | `string` | Soroban contract address of the asset (`"native"` for XLM) |

**Example (decoded):**

```json
{
  "type": "registered",
  "employer": "GAEMPLOYER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "employee": "GAEMPLOYEE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "salary": 5000000000n,
  "token": "native",
  "contractId": "C…",
  "ledger": 12345,
  "timestamp": "2025-01-15T10:00:00Z"
}
```

**Consumers:** SDK parser → `RegisteredEvent`; dashboard employee
onboarding flow; indexer registry-table updates.

---

#### `registry_updated`

> Source: `PayrollRegistryClient.updateRegistry({...})`  
> Severity: `info` — `category = "registry"`

An existing `(employer, employee)` entry's salary has been changed.

**Topics** (3 positions):

| Pos | ScVal Type | Field | Description |
|---|---|---|---|
| 0 | `ScValSymbol` | event name | `"registry_updated"` |
| 1 | `ScValAddress` | `employer` | Stellar public key of the employer |
| 2 | `ScValAddress` | `employee` | Stellar public key of the employee |

**Data** (`ScValMap`):

| Key | ScVal Type | Decoded JS Type | Description |
|---|---|---|---|
| `salary` | `ScValI128` | `bigint` | New salary amount in stroops |

**Example (decoded):**

```json
{
  "type": "registry_updated",
  "employer": "GAEMPLOYER…",
  "employee": "GAEMPLOYEE…",
  "salary": 7500000000n,
  "ledger": 13002,
  "timestamp": "2025-02-01T09:00:00Z"
}
```

**Consumers:** SDK parser → `RegistryUpdatedEvent`; dashboard salary
review widget; indexer history tracking.

> ⚠ **Future drift risk:** the data field is currently a single-element
> map. If the contract later adds `currency` or `effective_at`, the data
> map will grow — indexers should not assume key-count == 1.

---

#### `registry_deactivated`

> Source: `PayrollRegistryClient.deactivate({...})`  
> Severity: `warning` — `category = "registry"`

A payroll entry has been deactivated. Payments against the entry will
be rejected by the contract after this point.

**Topics** (3 positions):

| Pos | ScVal Type | Field | Description |
|---|---|---|---|
| 0 | `ScValSymbol` | event name | `"registry_deactivated"` |
| 1 | `ScValAddress` | `employer` | Stellar public key of the employer |
| 2 | `ScValAddress` | `employee` | Stellar public key of the employee |

**Data**: `ScValVoid` (empty).

**Example (decoded):**

```json
{
  "type": "registry_deactivated",
  "employer": "GAEMPLOYER…",
  "employee": "GAEMPLOYEE…",
  "ledger": 14001,
  "timestamp": "2025-03-12T16:42:11Z"
}
```

**Consumers:** SDK parser → `RegistryDeactivatedEvent`; dashboard
off-boarding flow; compliance audit pipeline.

---

### Payroll Events

These events track the **private salary lifecycle**. The salary is
committed as a hash first (so the public chain never sees the amount),
then revealed later by the employer. Emitted by `SalaryCommitmentClient`.

#### `committed`

> Source: `SalaryCommitmentClient.commit({...})` or `batchCommit({...})`  
> Severity: `info` — `category = "payroll"`

A new salary commitment has been posted for an `(employer, employee)`
pair for a given cycle. The hash binds the employer, employee, cycle id,
salary amount, and asset so that any later tampering is detectable.

**Topics** (3 positions):

| Pos | ScVal Type | Field | Description |
|---|---|---|---|
| 0 | `ScValSymbol` | event name | `"committed"` |
| 1 | `ScValAddress` | `employer` | Stellar public key of the employer |
| 2 | `ScValAddress` | `employee` | Stellar public key of the employee |

**Data** (`ScValMap`):

| Key | ScVal Type | Decoded JS Type | Description |
|---|---|---|---|
| `commitment_hash` | `ScValBytes` | `string` (hex) | 32-byte commitment hash, lowercase hex-encoded by the SDK parser |
| `cycle_id` | `ScValU64` | `bigint` | Payroll cycle identifier (monotone per employer) |

**Example (decoded):**

```json
{
  "type": "committed",
  "employer": "GAEMPLOYER…",
  "employee": "GAEMPLOYEE…",
  "commitmentHash": "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff",
  "cycleId": 7n,
  "ledger": 15002,
  "timestamp": "2025-04-01T00:00:01Z"
}
```

**Consumers:** SDK parser → `CommittedEvent`; dashboard payroll review
queue; ZK proof attestation pipeline (see [Proof Events](#proof-events));
indexer cycle-history table.

> ⚠ **Future drift risk:** the contract currently emits `cycle_id` as
> `ScValU64`. A future upgrade could promote this to `ScValU128` or
> `ScValString` if cycle IDs become namespaced (e.g.
> `"2025-Q2-P1-employer-GA…"`). Indexers should not hard-code the U64
> width.

---

#### `salary_revealed`

> Source: `SalaryCommitmentClient.revealSalary({...})`  
> Severity: `info` — `category = "payroll"`

The employer has revealed the actual salary for a committed cycle. The
contract verifies the revealed amount matches the prior commitment
hash before accepting.

**Topics** (3 positions):

| Pos | ScVal Type | Field | Description |
|---|---|---|---|
| 0 | `ScValSymbol` | event name | `"salary_revealed"` |
| 1 | `ScValAddress` | `employer` | Stellar public key of the employer |
| 2 | `ScValAddress` | `employee` | Stellar public key of the employee |

**Data** (`ScValMap`):

| Key | ScVal Type | Decoded JS Type | Description |
|---|---|---|---|
| `cycle_id` | `ScValU64` | `bigint` | Same cycle id from the prior `committed` event |
| `actual_amount` | `ScValI128` | `bigint` | Revealed salary amount in stroops |

**Example (decoded):**

```json
{
  "type": "salary_revealed",
  "employer": "GAEMPLOYER…",
  "employee": "GAEMPLOYEE…",
  "cycleId": 7n,
  "actualAmount": 5000000000n,
  "ledger": 15102,
  "timestamp": "2025-04-15T12:00:00Z"
}
```

**Consumers:** SDK parser → `SalaryRevealedEvent`; dashboard payroll
finalisation flow; compliance reporting (this is the public record of
what was actually paid).

---

### Treasury / Payments Events

These events track **fund movement** out of the employer treasury —
both immediate execution (`payment_executed`) and the scheduled / cancelled
flow. Emitted by `PaymentExecutorClient`.

#### `payment_executed`

> Source: `PaymentExecutorClient.execute({...})`  
> Severity: `info` — `category = "payment"`

A payment has been executed on-chain. This is the **terminal event** of
a successful payroll disbursement.

**Topics** (2 positions):

| Pos | ScVal Type | Field | Description |
|---|---|---|---|
| 0 | `ScValSymbol` | event name | `"payment_executed"` |
| 1 | `ScValAddress` | `recipient` | Stellar public key receiving the payment |

**Data** (`ScValMap`):

| Key | ScVal Type | Decoded JS Type | Description |
|---|---|---|---|
| `amount` | `ScValI128` | `bigint` | Amount disbursed (in asset's smallest unit) |
| `asset` | `ScValAddress` | `string` | Asset contract address (`"native"` for XLM) |
| `tx_hash` | `ScValBytes` | `string` (hex) | Stellar transaction hash of the execution |

**Example (decoded):**

```json
{
  "type": "payment_executed",
  "recipient": "GRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "amount": 5000000000n,
  "asset": "native",
  "txHash": "deadbeef",
  "ledger": 15105,
  "timestamp": "2025-04-15T12:00:03Z"
}
```

**Consumers:** SDK parser → `PaymentExecutedEvent`; dashboard payment
status; treasury balance recalculation; indexer payment-history table;
reconciliation reporting.

> ⚠ **Future drift risk:** the contract currently emits `amount` as
> `ScValI128`. A future migration to multi-token decimals may require
> `ScValI256` or a tagged union. Indexers should not rely on the
> integer width.

---

#### `payment_scheduled`

> Source: `PaymentExecutorClient.schedule({...})`  
> Severity: `info` — `category = "payment"`

A future payment has been scheduled for execution at `execute_at`.
The contract will emit `payment_executed` (or `payment_cancelled`) when
the scheduled time elapses.

**Topics** (2 positions):

| Pos | ScVal Type | Field | Description |
|---|---|---|---|
| 0 | `ScValSymbol` | event name | `"payment_scheduled"` |
| 1 | `ScValAddress` | `recipient` | Stellar public key that will receive the payment |

**Data** (`ScValMap`):

| Key | ScVal Type | Decoded JS Type | Description |
|---|---|---|---|
| `amount` | `ScValI128` | `bigint` | Amount that will be disbursed |
| `asset` | `ScValAddress` | `string` | Asset contract address (`"native"` for XLM) |
| `execute_at` | `ScValU64` | `number` | Unix timestamp (seconds) when the payment will execute |
| `payment_id` | `ScValU64` | `bigint` | Opaque payment identifier; pass to `cancel` to revoke |

**Example (decoded):**

```json
{
  "type": "payment_scheduled",
  "recipient": "GRECIPIENT…",
  "amount": 2500000000n,
  "asset": "native",
  "executeAt": 1735689600,
  "paymentId": 42n,
  "ledger": 16010,
  "timestamp": "2025-04-20T08:00:00Z"
}
```

**Consumers:** SDK parser → `PaymentScheduledEvent`; dashboard
scheduled-payments view; indexer pending-payments table.

---

#### `payment_cancelled`

> Source: `PaymentExecutorClient.cancel({...})`  
> Severity: `warning` — `category = "payment"`

A previously scheduled payment has been cancelled before its
`execute_at`. The `payment_id` will not appear in any future
`payment_executed` event.

**Topics** (1 position):

| Pos | ScVal Type | Field | Description |
|---|---|---|---|
| 0 | `ScValSymbol` | event name | `"payment_cancelled"` |

**Data** (`ScValMap`):

| Key | ScVal Type | Decoded JS Type | Description |
|---|---|---|---|
| `payment_id` | `ScValU64` | `bigint` | Identifier of the cancelled payment |

**Fallback:** Older contract versions put the `payment_id` directly in
`topics[1]` instead of in the data map. The SDK parser handles both
shapes automatically — see
[`parsePaymentCancelled`](../packages/core/src/event-parser.ts#L305).

**Example (decoded):**

```json
{
  "type": "payment_cancelled",
  "paymentId": 42n,
  "ledger": 16099,
  "timestamp": "2025-04-21T09:00:00Z"
}
```

**Consumers:** SDK parser → `PaymentCancelledEvent`; dashboard
cancellation confirmation; indexer pending-payments table cleanup.

---

## Proof Events

> ⚠ **There is no dedicated on-chain event for proof verification.**
> This section is intentionally **short** — the ZK Payroll contracts
> do not currently emit a `proof_verified` or `proof_rejected` event.
> This is a deliberate gap; proof attestation is captured implicitly by
> the `committed` and `salary_revealed` events described above.

### Why no dedicated proof event?

1. **Privacy**: a public `proof_verified` event would disclose
   *which circuit* was verified, leaking the payroll schedule shape.
2. **Cost**: emitting an event per proof adds ledger overhead that
   grows linearly with payroll size.
3. **Sufficient signal already exists**: a `committed` event only
   succeeds if the embedded ZK proof verifies against the contract's
   stored verification key. Indexers can therefore treat `committed`
   as authoritative proof of verification — no extra event needed.

### When the gap closes (future versions)

> ⚠ **Proposed (not yet shipped)** — the events below are forward-looking
> proposals the SDK team has sketched to make indexers' future upgrade
> easier. They are **not** part of the current contract ABI and should
> not be subscribed to today.

If a future contract version needs to emit explicit proof events
(for example, to support off-chain proof-submission services that
want to log each attempt), the SDK team has sketched these names
in advance:

| Proposed Event | Topics | Data | Notes |
|---|---|---|---|
| `proof_verified` | `[name, verifier_addr, proof_kind]` | `verification_key_id (u32)`, `public_signals_hash (bytes)` | Would replace the implicit semantics of `committed` |
| `proof_rejected` | `[name, verifier_addr, proof_kind]` | `reason (symbol)`, `verification_key_id (u32)` | Severity `warning`, `category = "compliance"` |

Until those events ship, treat the **absence** of a `committed` event
within a reasonable timeout as an indication that proof verification
may have failed at the RPC layer. Watch the
[ZK Proof Generation](./ZK_PROOF_GENERATION.md) doc for updates.

---

## Backend Webhook Events

Webhook events are emitted by the **backend payroll worker** and
**transaction watcher** services, delivered as JSON over HTTPS POST
to URLs that the customer registers in their dashboard. Every webhook
envelope is wrapped in a [`SignedWebhookEnvelope`](../packages/core/src/webhooks/types.ts):

```json
{
  "payload": { "event": "payroll.completed", ... },
  "signature": "sha256=<hex>",
  "version": "1"
}
```

Receivers MUST verify the signature using the shared secret before
processing the payload — see [`webhooks/verify.ts`](../packages/core/src/webhooks/verify.ts).

All webhook payloads share this base shape
([`WebhookPayloadBase`](../packages/core/src/webhooks/types.ts#L51)):

| Field | Type | Description |
|---|---|---|
| `eventId` | `string` | Unique event ID for idempotent processing |
| `timestamp` | `string` (ISO-8601) | When the event was emitted |
| `event` | `WebhookEventType` | Event discriminant (see below) |
| `contractId?` | `string` | Contract ID that emitted the underlying on-chain event |
| `ledger?` | `number` | Ledger sequence number (when applicable) |

---

### Payroll Run Outcomes

These two events describe the **outcome of a full payroll run** as
orchestrated by the backend worker, not the individual per-employee
transactions.

#### `payroll.completed`

> Severity: `info` — `category = "payroll"`

A full payroll cycle has finished executing successfully.

| Field | Type | Description |
|---|---|---|
| `event` | `"payroll.completed"` | Discriminant |
| `employer` | `string` | Stellar public key of the employer |
| `employeeCount` | `number` | Number of employees paid in this cycle |
| `totalDisbursed` | `string` | Total amount disbursed across all payments (stringified bigint) |
| `asset` | `string` | Asset contract address used for disbursement |
| `cycleId` | `string` | Payroll cycle identifier |
| `txHash` | `string` | Transaction hash of the final execution transaction |

**Consumers:** backend reconciliation jobs, payroll completion
notifications, end-of-cycle accounting reports.

---

#### `payroll.failed`

> Severity: `error` — `category = "payroll"`

A payroll cycle failed during execution. The cycle is **not** retried
automatically — the operator must re-trigger the cycle after fixing
the underlying cause.

| Field | Type | Description |
|---|---|---|
| `event` | `"payroll.failed"` | Discriminant |
| `employer` | `string` | Stellar public key of the employer |
| `cycleId` | `string` | Payroll cycle identifier |
| `reason` | `string` | Human-readable failure reason |
| `failureCode` | `string` | Programmatic failure code (e.g. `"SIM_PROOF_GENERATION_FAILED"`, `"SIM_INSUFFICIENT_TREASURY"`) |
| `txHash?` | `string` | Transaction hash of the failed transaction, if available |

**Consumers:** backend alert pipelines (PagerDuty, Slack), operator
dashboards, simulation-failure classification (see
[`classification/TransactionFailureClassifier.ts`](../packages/core/src/classification/TransactionFailureClassifier.ts)).

---

### Transaction Lifecycle

These three events describe the **status transitions** of a single
transaction as observed by the backend's transaction watcher.

#### `transaction.pending`

> Severity: `warning` — `category = "transaction"`

The watcher has seen the transaction in the mempool / pending ledger
state. Re-emitted as `confirmations` increments.

| Field | Type | Description |
|---|---|---|
| `event` | `"transaction.pending"` | Discriminant |
| `txHash` | `string` | Stellar transaction hash |
| `status` | `"PENDING"` | Literal status string |
| `confirmations` | `number` | Number of confirmation blocks seen so far |

---

#### `transaction.confirmed`

> Severity: `info` — `category = "transaction"`

The transaction was included in a closed ledger and succeeded.

| Field | Type | Description |
|---|---|---|
| `event` | `"transaction.confirmed"` | Discriminant |
| `txHash` | `string` | Stellar transaction hash |
| `status` | `"SUCCESS"` | Literal status string |
| `ledger` | `number` | Ledger sequence number of inclusion |

---

#### `transaction.failed`

> Severity: `error` — `category = "transaction"`

The transaction was included in a closed ledger but reverted or failed.

| Field | Type | Description |
|---|---|---|
| `event` | `"transaction.failed"` | Discriminant |
| `txHash` | `string` | Stellar transaction hash |
| `status` | `"FAILED"` | Literal status string |
| `error?` | `string` | Error string from the Soroban RPC response, if available |

---

### Audit / Compliance

These three events describe the **lifecycle of audit view keys** —
credentials that grant external auditors scoped read access to a
company's payroll data. See
[`Audit View-Key Helpers`](./audit-view-keys.md) for the underlying
SDK helpers and validation rules.

#### `audit.view_key_granted`

> Severity: `info` — `category = "audit_key"`

An admin has granted a new audit view key.

| Field | Type | Description |
|---|---|---|
| `event` | `"audit.view_key_granted"` | Discriminant |
| `keyId` | `string` | The view key identifier that was granted |
| `grantedBy` | `string` | Stellar public key of the admin who granted the key |
| `scope` | `string` | `"read-only"` or `"full-audit"` |
| `expiresAt` | `string` (ISO-8601) | Expiry timestamp of the key |

---

#### `audit.view_key_revoked`

> Severity: `warning` — `category = "audit_key"`

An admin has revoked an audit view key before its expiry.

| Field | Type | Description |
|---|---|---|
| `event` | `"audit.view_key_revoked"` | Discriminant |
| `keyId` | `string` | The view key identifier that was revoked |
| `revokedBy` | `string` | Stellar public key of the admin who revoked the key |
| `revokedAt` | `string` (ISO-8601) | Timestamp of revocation |

---

#### `audit.view_key_expired`

> Severity: `warning` — `category = "audit_key"`

An audit view key has reached its expiry without being revoked.

| Field | Type | Description |
|---|---|---|
| `event` | `"audit.view_key_expired"` | Discriminant |
| `keyId` | `string` | The view key identifier that expired |
| `expiredAt` | `string` (ISO-8601) | Timestamp when the key expired |

---

## Consumer Matrix

The same event rarely has only one consumer. This matrix maps every
event to its **expected downstream consumers** and the SDK module
that bridges to each.

### SDK consumers

| Module | Consumes |
|---|---|
| [`event-parser.ts`](../packages/core/src/event-parser.ts) | All 8 on-chain events → `TypedContractEvent` |
| [`webhooks/verify.ts`](../packages/core/src/webhooks/verify.ts) | All 8 webhook events → `WebhookPayload` |
| [`audit/eventNormalizer.ts`](../packages/core/src/audit/eventNormalizer.ts) | All events (contract + webhook + dashboard) → `AuditEvent` |
| [`pagination.ts`](../packages/core/src/pagination.ts) | `RawContractEvent[]` streams via `pagingToken` |

### Dashboard consumers

| Consumer | Listens to |
|---|---|
| Employee onboarding flow | `registered` |
| Salary review widget | `registry_updated` |
| Off-boarding flow | `registry_deactivated` |
| Payroll review queue | `committed` |
| Payroll finalisation | `salary_revealed` |
| Payment status | `payment_executed`, `payment_scheduled`, `payment_cancelled` |
| Run dashboard | `payroll.completed`, `payroll.failed` |
| Tx status widgets | `transaction.pending`, `transaction.confirmed`, `transaction.failed` |
| Compliance panel | `audit.view_key_granted`, `audit.view_key_revoked`, `audit.view_key_expired` |

### Indexer consumers

| Indexer | Listens to |
|---|---|
| Public registry-history indexer | `registered`, `registry_updated`, `registry_deactivated` |
| Public payroll-history indexer | `committed`, `salary_revealed` |
| Public payment-history indexer | `payment_executed`, `payment_scheduled`, `payment_cancelled` |
| Backend reconciliation indexer | All on-chain + all webhook events |

---

## Indexer Guide

Third-party indexers (Mercury, Subnet, custom Postgres pipelines) can
pull events directly from Soroban RPC without using the SDK.

### Filtering by topic

The first topic (`topics[0]`) is the event-name symbol. Use it as a
filter to select only the events you care about:

```js
const filter = {
  contractIds: [payrollContractId],
  topics: [
    // XOR match — any one of these event names:
    [xdr.ScVal.scvSymbol("registered").toXDR()],
    [xdr.ScVal.scvSymbol("registry_updated").toXDR()],
    [xdr.ScVal.scvSymbol("registry_deactivated").toXDR()],
  ],
};
const events = await sorobanServer.getEvents({
  startLedger,
  filters: [filter],
  pagination: { limit: 100 },
});
```

### Filtering by indexed address

`topics[1]` and beyond carry indexed addresses. To follow a specific
employer's events:

```js
const employerAddr = xdr.ScVal.scvAddress(
  Address.fromString("GAEMPLOYER…").toScAddress()
).toXDR();

const filter = {
  contractIds: [payrollContractId],
  topics: [
    // Match any event name (null = wildcard at this position)
    null,
    // Restrict to this specific employer
    employerAddr,
  ],
};
```

### Pagination

The RPC `getEvents` endpoint returns up to 10 000 events per page.
Chain pages using `pagingToken` from the previous page's last event.
The SDK wraps this in [`paginateEvents`](../packages/core/src/pagination.ts).

### Cursor persistence

Storing cursors per (contract, topic-filter) pair lets an indexer
resume after a restart without losing events. Persist the **last seen
`pagingToken`** plus the **last seen `ledger`** so you can detect gaps
in case the RPC node rolls back.

---

## Decoding Reference

A quick-reference for the ScVal → JavaScript type mapping the SDK
parser enforces. Indexers not using the SDK should match this exactly.

| ScVal Type | Used For | Decoded As | Edge Cases |
|---|---|---|---|
| `ScValSymbol` | Event names, data-map keys | `string` | Strings ≤ **32 bytes** (per Soroban host spec); all shipped event names (`"registered"`, `"salary_revealed"`, …) fit comfortably. Contracts always emit the full `ScValSymbol` form on-chain — newer protocol versions may encode short symbols using a 9-byte `ScValSymbolSmall` runtime encoding, but indexers can treat both as the same `string`. |
| `ScValAddress` | Stellar addresses (accounts, contracts) | `string` (G/C… strkey) | Account addresses → `G…`; contract addresses → `C…` |
| `ScValI128` | Signed amounts (salary, payment, disbursed) | `bigint` | Both `scvI128` and `scvU64` decode to `bigint`; check `switch().name` first |
| `ScValU64` | Unsigned counters (cycle_id, payment_id, execute_at) | `bigint` (`execute_at` → `number`) | The SDK decoder turns `execute_at` into a JS `number` for ergonomic UNIX seconds |
| `ScValBytes` | Hashes (commitment, transaction) | `string` (lowercase hex) | Variable length; the SDK hex-encodes for stable JSON serialisation |
| `ScValMap` | Data payload of every event | `Record<string, ScVal>` | Keys are always `ScValSymbol`; iterate via `entry.key().sym()` |
| `ScValVoid` | Events with no payload | _(omitted)_ | `registry_deactivated` uses this — the SDK returns an empty details object |

---

## Versioning & Compatibility

| What | Current | Notes |
|---|---|---|
| **Contract ABI** | `0.1.0` | Pinned in [`tests/contract-fixtures.test.ts`](../packages/core/tests/contract-fixtures.test.ts); bump when topic layout or data map shape changes |
| **Webhook envelope** | `1` | The `version` field in [`SignedWebhookEnvelope`](../packages/core/src/webhooks/types.ts#L184); bump when the envelope schema itself changes (not when individual event payloads add fields) |
| **SDK `TypedContractEvent`** | n/a (TypeScript types) | Adding a new event type is a non-breaking change; renaming `type` literals is breaking |

### Backwards-compatibility rules

1. **Adding a new event** is always non-breaking. Indexers will simply
   see `Unknown event type` until they upgrade.
2. **Adding a new field to a data map** is non-breaking if optional;
   breaking if the field is required by the contract.
3. **Renaming a topic position** is breaking. Always append new
   indexed parameters to the end of the topic list.
4. **Renaming a data-map key** is breaking. Add the new key alongside
   the old one for one full ABI version before deprecating.
5. **Changing a ScVal type** (e.g. `ScValU64` → `ScValI128`) is
   breaking. Always emit the new type under a new key.

---

## Cross-References

- **SDK parser**: [`packages/core/src/event-parser.ts`](../packages/core/src/event-parser.ts)
- **Audit normalizer**: [`packages/core/src/audit/eventNormalizer.ts`](../packages/core/src/audit/eventNormalizer.ts)
- **Webhook verification**: [`packages/core/src/webhooks/verify.ts`](../packages/core/src/webhooks/verify.ts)
- **Event-parser tests**: [`packages/core/tests/event-parser.test.ts`](../packages/core/tests/event-parser.test.ts)
- **Audit event normalizer tests**: [`packages/core/tests/audit-event-normalizer.test.ts`](../packages/core/tests/audit-event-normalizer.test.ts)
- **Audit view-key helpers**: [`docs/audit-view-keys.md`](./audit-view-keys.md)
- **Pagination**: [`docs/pagination.md`](./pagination.md)
- **Webhook verification**: [`docs/WORKER_PROOF_GENERATION.md`](./WORKER_PROOF_GENERATION.md) (related worker-lifecycle events)
- **Progress events** (SDK-internal, not contract-emitted): [`docs/PROGRESS_EVENTS.md`](./PROGRESS_EVENTS.md)
- **Backend integration**: [`docs/BACKEND_INTEGRATION_GUIDE.md`](./BACKEND_INTEGRATION_GUIDE.md)
- **API reference**: [`docs/API.md`](./API.md)
- **Transaction failure classification**: [`packages/core/src/classification/TransactionFailureClassifier.ts`](../packages/core/src/classification/TransactionFailureClassifier.ts)
- **Payroll simulator** (end-to-end event testing): [`packages/core/src/simulation/PayrollSimulator.ts`](../packages/core/src/simulation/PayrollSimulator.ts)