# Audit-Safe Debug Snapshot

Support teams need useful diagnostics without access to private payroll
information. The SDK therefore provides `createDebugSnapshot`, a helper that
captures SDK configuration and runtime state for troubleshooting while
**redacting sensitive payroll data** and producing a JSON-safe, integrity-checked
snapshot you can log, export, or attach to a support ticket.

## Quick Start

```typescript
import { createDebugSnapshot, verifyDebugSnapshot } from "@zk-payroll/sdk";

const { snapshot, redactedFieldCount, redactedKeys } = await createDebugSnapshot({
  sdkVersion: "0.1.0",
  config: client.getConfig(), // redacted internally
  state: {
    pendingPayments,
    draft,
    signerSecret: signer.secret(), // redacted automatically
  },
});

console.log(`Redacted ${redactedFieldCount} sensitive fields: ${redactedKeys.join(", ")}`);
console.log(JSON.stringify(snapshot)); // safe to send to support

// Confirm the snapshot has not been tampered with later:
const stillValid = await verifyDebugSnapshot(snapshot);
```

## Snapshot Shape

| Field | Description |
|-------|-------------|
| `schemaVersion` | Snapshot format version (`"1.0"`). |
| `snapshotId` | Run identifier; set `options.snapshotId` to override. |
| `generatedAt` | ISO-8601 capture timestamp. |
| `sdkVersion` | Recorded when supplied via `options.sdkVersion`. |
| `sections` | Structured `runtime` / `config` / `state` (and optional `memory`) sections with `key`, `status`, `message`, `data`. |
| `redaction` | `redactedFieldCount` and unique `redactedKeys` that were stripped. |
| `integrityHash` | SHA-256 over the stable-serialized snapshot, for tamper detection. |

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `snapshotId` | Explicit snapshot identifier. | fresh run identifier |
| `sdkVersion` | SDK version recorded for troubleshooting. | omitted |
| `state` | Arbitrary SDK state to capture (deep-redacted). | warning section |
| `config` | Raw client configuration to capture (deep-redacted). | warning section |
| `additionalSensitiveKeys` | Extra key names treated as sensitive. | built-in payroll defaults |
| `includeEnvironment` | Add a `runtime` section. | `true` |
| `includeMemory` | Add a process memory sample (Node only). | `false` |

## What Gets Redacted

The default sensitive set composes the SDK's existing vocabularies:

- Redaction engine defaults: `recipient`, `amount`, `witness`, `privateKey`,
  `adminKey`, `secret`, `password`, `token`, `mnemonic`, `seed`,
  `authorization`, `apiKey`, `accessToken`, `refreshToken`, `signingKey`.
- Audit package defaults: `viewKey`, `viewingKey`, `secretKey`, `salaryAmount`,
  `ssn`, `taxId`, `creditCard`, `bankAccount`.
- Payroll extras: `asset`, `salary`, `employer`, `employee`, `commitment`,
  `commitmentHash`, `nullifier`.

Matching is **case-insensitive** and recursive through nested objects and
arrays. Values are replaced with `[REDACTED]`, and the summary in
`snapshot.redaction` tells you exactly which keys were stripped.

## Safety Guarantees

- **Never exposes private values.** The snapshot contains no payloads,
  salaries, recipient addresses, private keys, or signatures — and the
  redaction summary lets you audit what was removed.
- **Always JSON-serializable.** BigInt values are converted to strings, dates
  to ISO strings, maps/sets to plain structures, typed arrays to hex, and
  circular references to a `[Circular]` marker. `JSON.stringify(snapshot)`
  never throws.
- **Tamper-evident.** `verifyDebugSnapshot(snapshot)` recomputes the integrity
  hash so you can detect a modified snapshot.

## Low-Level Helper

`redactDebugData(data, { additionalKeys })` performs the deep redaction +
normalization pass on any object, returning `{ redactedData, redactedFieldCount,
redactedKeys }`. `buildDebugSensitiveKeys(additionalKeys)` returns the composed
sensitive key list if you need to extend or inspect it.