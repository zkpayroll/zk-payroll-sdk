# ZK Payroll SDK

TypeScript SDK for interacting with the ZK Payroll smart contracts.

## Installation

```bash
npm install @zk-payroll/sdk
```

## Quickstart

Minimal examples using fake data — initialize the SDK, validate a payroll
draft, and read payroll status.

```typescript
import { PayrollContract, ConfigPresets, DraftBuilder } from "@zk-payroll/sdk";

// 1. Initialize the SDK
const config = ConfigPresets.testnet()
  .withContractId("CCONTRACT_ID_EXAMPLE")
  .build();
const contract = new PayrollContract(config);

// 2. Validate a payroll draft before submitting it
const { errors, warnings } = new DraftBuilder()
  .add({ recipientId: "GABC...EXAMPLE", amount: "100.00", asset: "native" })
  .validate();
if (errors.length > 0) {
  console.error("Draft is invalid:", errors);
}

// 3. Read payroll status (balance) for an address
const balance = await contract.getBalance("GABC...EXAMPLE");
```

## Usage

The SDK provides configuration presets for common environments to simplify initialization:

```typescript
import { PayrollService, ConfigPresets } from "@zk-payroll/sdk";

// Initialize config for a specific environment
const config = ConfigPresets.testnet()
  .withContractId("CCONTRACT_ID...")
  .withProofConfig({
    wasmUrl: "https://cdn.example.com/payroll_circuit.wasm",
    zkeyUrl: "https://cdn.example.com/payroll_circuit.zkey",
  })
  .build(); // Validates required fields

// Initialize service
const service = new PayrollService(config);

// Process a private payment
await service.processPayment(
  "G...", // Recipient Stellar address
  1000n   // Amount
);
```

### Configuration & Schema Validation

The SDK enforces strict schema validation for all configuration parameters (`network`, `rpcUrl`/`networkUrl`, `contractId`/`contractIds`, `proofConfig`, `retryPolicy`, and `featureFlags`) before operations run.

#### Minimal Valid Config Example
```typescript
import { ConfigPresets, validateConfig, assertValidConfig } from "@zk-payroll/sdk";

// Using ConfigPresets for a minimal valid setup:
const config = ConfigPresets.testnet()
  .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
  .build();

// Direct schema validation utility
const validation = validateConfig(config);
if (!validation.isValid) {
  console.error("Config errors:", validation.errors);
}

// Asserts configuration validity or throws structured ValidationError
assertValidConfig(config);
```

#### Invalid Configuration Handling
The `ConfigBuilder` and `assertValidConfig` fail fast with structured `ValidationError` (`code: CONFIG_VALIDATION_ERROR`) if required fields are missing or malformed:

```typescript
// Throws ValidationError: "Configuration validation failed:\n- contractId is malformed: invalid_id"
ConfigPresets.testnet().withContractId("invalid_id").build();
```

## Idempotent retries

For safe retries, pass an `idempotencyKey` when processing a payment.

```typescript
import { PayrollService, createPaymentIdempotencyKey } from "@zk-payroll/sdk";

const idempotencyKey = createPaymentIdempotencyKey({
  recipient: "G...",
  amount: 1000n,
  asset: "native",
});

await service.processPayment({
  recipient: "G...",
  amount: 1000n,
  asset: "native",
  idempotencyKey,
});
```

## Features

- **Typed Contract Clients**: Fully typed client wrappers for PayrollRegistry, SalaryCommitment, ProofVerifier, PaymentExecutor, PreflightClient, and AuditHold contracts.
- **ZK Proof Generation**: Client-side proof generation using snarkjs for privacy.
- **Caching**: Built-in caching for proofs and circuit artifacts.
- **Error Handling**: Robust error typing and management.
- **Safe Payroll Batch Submission**: Sequential batch execution with progress callbacks, guarded retries, and privacy-preserving error handling.
- **Contract Event Decoding**: Typed decoding of contract status and lifecycle events including employee status transitions.
- **Mock Testing Environment**: Comprehensive testing utilities for unit tests without a live network.

## Browser and Backend Usage

Use this section to pick the right environment before you wire the SDK into a product. The package supports **browsers** (wallets, dashboards) and **Node.js backends** (workers, automation), but secrets and signing paths differ.

### Quick matrix

| Concern | Browser (frontend) | Backend (Node worker / service) |
|--------|--------------------|----------------------------------|
| **Wallet signing** | User wallets (Freighter, Albedo) via adapters | Server-held keys from a secrets manager — **not** browser extensions |
| **Proof generation** | On-device with snarkjs; prefer [Web Workers](./docs/WORKER_PROOF_GENERATION.md) so the UI stays responsive | On the worker/process for batch payroll; good for heavy or unattended jobs |
| **Secrets / witnesses** | Never embed Stellar secret keys (`S…`) or long-lived note secrets in frontend code, env shipped to the client, or `localStorage` | Load signer material from env / KMS / secrets manager; never log full witnesses |
| **Next.js / SSR** | Import SDK only in Client Components (`"use client"`) | Do not import the browser wallet path in Server Components or Route Handlers for UI signing |
| **Best fit** | Employee/employer dashboards, interactive connect + sign | Payroll automation, queues, retries, multi-payment workers |

Supported runtime versions: [Runtime Support Matrix](./docs/SUPPORT_MATRIX.md).

### Browser (short guidance)

Interactive apps should connect a wallet, generate or request proofs without blocking the main thread when possible, and keep sensitive material off the client bundle.

```typescript
// Frontend / Next.js Client Component — "use client"
import { FreighterAdapter } from "@zk-payroll/sdk";

const wallet = new FreighterAdapter();
if (wallet.isAvailable()) {
  const publicKey = await wallet.connect();
  // Build XDR with public flows; sign via the adapter — never with a hardcoded secret key
  // const signed = await wallet.signTransaction(xdr);
}
```

- Prefer [Worker-based proof generation](./docs/WORKER_PROOF_GENERATION.md) for multi-second circuit work.
- For App Router apps, follow [Next.js Integration](./docs/NEXTJS_INTEGRATION.md) (client boundary rules).
- Wallet details: [Wallet Adapters](./docs/WALLET_ADAPTERS.md).

### Backend (short guidance)

Backend services own **automation**: queue jobs, generate proofs on the server, sign with keys that never leave the host, and submit to RPC.

```typescript
// Node worker — secrets from environment / secrets manager only
import { PayrollService, ConfigPresets } from "@zk-payroll/sdk";

const config = ConfigPresets.testnet()
  .withContractId(process.env.CONTRACT_ID!)
  .withProofConfig({
    wasmUrl: process.env.WASM_URL!,
    zkeyUrl: process.env.ZKEY_URL!,
  })
  .build();

const service = new PayrollService(config);
// Signer secret: process.env / KMS — never commit S… keys or put them in browser env
```

- End-to-end worker prototype: [Backend Worker Quickstart](./docs/BACKEND_WORKER_QUICKSTART.md).
- Production patterns (config, secret handling, retries): [Backend Integration Guide](./docs/BACKEND_INTEGRATION_GUIDE.md).

### Secret handling (both environments)

| Do | Don't |
|----|--------|
| Keep note `secret` / nullifier inputs in memory only as long as needed for proving | Log witnesses, proofs with private inputs, or secret keys |
| Use HTTPS CDN or authenticated artifact hosts for `.wasm` / `.zkey` | Ship production signing keys in frontend env (`NEXT_PUBLIC_*`, Vite `VITE_*`, etc.) |
| Rotate and scope backend signer keys; prefer HSM/KMS where possible | Reuse a single hot key across untrusted multi-tenant frontends |

Proof APIs and witness shapes: [ZK Proof Generation](./docs/ZK_PROOF_GENERATION.md).

### Related docs

- [Browser and Server Usage Guide](./docs/BROWSER_AND_SERVER_USAGE.md)
- [Runtime Support Matrix](./docs/SUPPORT_MATRIX.md)
- [Wallet Adapters](./docs/WALLET_ADAPTERS.md)
- [ZK Proof Generation](./docs/ZK_PROOF_GENERATION.md)
- [Worker Proof Generation](./docs/WORKER_PROOF_GENERATION.md)
- [Next.js Integration](./docs/NEXTJS_INTEGRATION.md)
- [Backend Worker Quickstart](./docs/BACKEND_WORKER_QUICKSTART.md)
- [Backend Integration Guide](./docs/BACKEND_INTEGRATION_GUIDE.md)

## Zero-Knowledge Proof Generation

The SDK includes production-ready ZK proof generation using snarkjs:

```typescript
import { SnarkjsProofGenerator, MemoryCacheProvider } from "@zk-payroll/sdk";

// Configure circuit artifacts
const config = {
  wasmUrl: "https://cdn.example.com/payroll_circuit.wasm",
  zkeyUrl: "https://cdn.example.com/payroll_circuit.zkey",
  artifactCacheTTL: 86400, // 24 hours
};

// Create generator with caching
const cache = new MemoryCacheProvider<string>();
const generator = new SnarkjsProofGenerator(config, cache);

// Generate proof
const witness = {
  recipient: "GDZQHV...",
  amount: 1000000n,
  nullifier: 123456789n,
  secret: 987654321n,
};

const proof = await generator.generateProof(witness);
```

See [ZK Proof Generation Guide](./docs/ZK_PROOF_GENERATION.md) for detailed documentation.

## Backend Worker Quickstart

Teams building internal payroll automation workers can follow the [Backend Worker Quickstart](./docs/BACKEND_WORKER_QUICKSTART.md) for a practical end-to-end prototype covering setup, polling, retries, and event handling.

## Testing

The SDK includes a powerful mock testing environment for writing unit tests:

```typescript
import { MockContractEnvironment, MockPayrollContract } from "@zk-payroll/sdk";

const mockEnv = new MockContractEnvironment();
mockEnv.expectInvoke("deposit").toReturn("tx_hash_123");

const mockContract = new MockPayrollContract(mockEnv);
const txHash = await mockContract.deposit(1000n);
```

See the [Testing Guide](docs/TESTING.md) for complete documentation.

## Examples

Runnable examples covering two core use cases are in the [`examples/`](./examples/) directory.
Each example works out of the box in demo mode (no Stellar node required) and switches to a
live network automatically when the relevant environment variables are set.

### Employee Onboarding

[`examples/employee-onboarding.ts`](./examples/employee-onboarding.ts)

Shows how to onboard a new employee: verify they have no existing payroll account, fund it
with an initial allocation, and confirm the deposit was recorded.

```bash
npx tsx examples/employee-onboarding.ts
```

### Payroll Execution

[`examples/payroll-execution.ts`](./examples/payroll-execution.ts)

Shows how to run a full private payroll batch: configure `SnarkjsProofGenerator` with circuit
artifacts and caching, wire up `PayrollService`, process multiple payments, and report results.

```bash
npx tsx examples/payroll-execution.ts
```

### Configuration

Copy the environment variable template and fill in your values to run against a live network:

```bash
cp examples/.env.example examples/.env
# edit examples/.env
source examples/.env && npx tsx examples/payroll-execution.ts
```

See [`examples/.env.example`](./examples/.env.example) for all available variables.

## Typed Contract Clients

The SDK provides typed client wrappers for the core ZK Payroll contracts. Each client exposes typed methods that encode arguments and decode responses automatically.

### PayrollRegistryClient

```typescript
import { PayrollRegistryClient, rpc } from "@zk-payroll/sdk";

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const client = new PayrollRegistryClient(server, "CCONTRACT_ID...");

// Register a payroll relationship
await client.register(
  { employer: "G...", employee: "G...", salary: 1000n, token: "C...", metadata: "engineering" },
  signer
);

// Query a registry entry
const entry = await client.getRegistry("G...", "G...", signer);
console.log(entry.salary, entry.active);

// List employees
const employees = await client.getEmployees("G...", 0, 10, signer);

// Check if a registry exists
const exists = await client.registryExists("G...", "G...", signer);
```

### SalaryCommitmentClient

```typescript
import { SalaryCommitmentClient } from "@zk-payroll/sdk";

const client = new SalaryCommitmentClient(server, "CCONTRACT_ID...");

// Commit to a salary amount (hidden via hash)
await client.commit(
  { employer: "G...", employee: "G...", commitmentHash: "abcd...", cycleId: 1n },
  signer
);

// Retrieve a commitment
const commitment = await client.getCommitment("G...", "G...", 1n, signer);

// Batch commit multiple salaries
await client.batchCommit("G...", [
  { employee: "G...1", commitmentHash: "abcd", cycleId: 1n },
  { employee: "G...2", commitmentHash: "ef01", cycleId: 1n },
], signer);

// Verify a commitment against a ZK proof
const isValid = await client.verifyCommitment("G...", "G...", 1n, proof, signer);

// Reveal the actual salary
await client.revealSalary("G...", "G...", 1n, 1000n, signer);
```

## Payload Normalization

Consumers rarely pass payroll data in exactly one shape (different key names, extra whitespace, comma-formatted amounts, mixed-case addresses). `normalizePayrollPayload` converts any of these variations into the SDK's canonical entry shape before validation, proof preparation, or transaction building:

```typescript
import { normalizePayrollPayload } from "@zk-payroll/sdk";

const { entries, issues } = normalizePayrollPayload({
  entries: [
    { employee_id: "  E-42  ", wallet: "gabc...", asset: "xlm", amount: "1,000.50" },
  ],
});

// entries[0] => { employeeId: "E-42", walletAddress: "GABC...", asset: "native", amount: "1000.50", source: {...} }

// Required fields (employeeId, walletAddress, asset, amount) are never silently dropped —
// missing/unparseable data shows up as an indexed issue instead, with the original
// input still reachable via entries[issue.index].source.raw for clear validation errors.
if (issues.length > 0) {
  console.log(issues);
}
```

See the [Payload Normalization Guide](./docs/PAYLOAD_NORMALIZATION.md) for the full field-by-field normalization rules.

## Batch Payload Validation

The SDK automatically validates batch payroll payloads before submitting them to contracts, preventing empty batches, duplicate recipients, and invalid amounts:

```typescript
import { BatchPayloadBuilder, validateBatchPayload, PayrollValidation } from "@zk-payroll/sdk";

const entries = [
  { recipient: "GABC...", amount: 1000n, asset: "native" },
  { recipient: "GDEF...", amount: 2000n, asset: "native" },
];

// Validate entries before building
const errors = validateBatchPayload(entries);
if (errors.length === 0) {
  const payload = new BatchPayloadBuilder().addMany(entries).build();
  // Safe to submit payload.entries
} else {
  // Structured errors returned for UI display (code, message, field, index)
  console.log(errors);
}
```

### ProofVerifierClient

```typescript
import { ProofVerifierClient } from "@zk-payroll/sdk";

const client = new ProofVerifierClient(server, "CCONTRACT_ID...");

// Verify a ZK proof on-chain
const valid = await client.verify(
  { pi_a: ["1","2"], pi_b: [["3","4"],["5","6"]], pi_c: ["7","8"], publicSignals: ["sig1"] },
  ["input1"],
  1, // verification key ID
  signer
);

// Add a new verification key
const vkId = await client.addVerificationKey("aabbcc...", "groth16 key", signer);

// Get active verification key
const activeId = await client.getActiveVerificationKeyId(signer);

// Get verification key info
const info = await client.getVerificationKeyInfo(1, signer);
```

### PaymentExecutorClient

```typescript
import { PaymentExecutorClient } from "@zk-payroll/sdk";

const client = new PaymentExecutorClient(server, "CCONTRACT_ID...");

// Execute an immediate payment
const result = await client.execute(
  { recipient: "G...", amount: 1000n, asset: "C...", memo: "salary" },
  signer
);
console.log("Transaction:", result.txHash);

// Schedule a future payment
const scheduled = await client.schedule(
  { recipient: "G...", amount: 500n, asset: "C...", executeAt: 1700000000, memo: "bonus" },
  signer
);
console.log("Payment ID:", scheduled.paymentId);

// Cancel a scheduled payment
await client.cancel(scheduled.paymentId, signer);

// Get pending payments
const payments = await client.getPendingPayments("G...", 0n, 20, signer);
```

## Environment Sanity Checker

To catch configuration integration problems (such as misconfigured RPC endpoints, invalid contract IDs, or missing/unreachable circuit artifacts) before starting runtime work, the SDK provides the `validateEnvironment` helper:

```typescript
import { validateEnvironment } from "@zk-payroll/sdk";

const clientConfig = {
  networkUrl: "https://soroban-testnet.stellar.org",
  contractId: "CCONTRACT_ID...",
};

const proofConfig = {
  wasmUrl: "https://cdn.example.com/payroll_circuit.wasm",
  zkeyUrl: "https://cdn.example.com/payroll_circuit.zkey",
};

const result = await validateEnvironment(clientConfig, proofConfig);

if (!result.isValid) {
  console.error("Environment check failed!");
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.status === "error") {
      console.error(`- [${diagnostic.component}] ${diagnostic.message}`);
    }
  }
} else {
  console.log("Environment is ready!");
}
```

### Diagnostic Result Structure

`validateEnvironment` returns a `SanityCheckResult` containing:
- `isValid: boolean` - `true` if all validations pass with no errors.
- `diagnostics: DiagnosticEntry[]` - List of diagnostics for each checked component.

Each `DiagnosticEntry` contains:
- `component: "rpc" | "contract" | "artifacts"` - The checked component.
- `status: "success" | "warning" | "error"` - The validation status.
- `message: string` - Actionable diagnostic message explaining the result.
- `error?: Error` - The caught error object, if any.
- `details?: Record<string, unknown>` - Extra context (e.g. network passphrases or RPC response details).

## Multi-Asset Support

The SDK provides a centralised `AssetRegistry` that maps asset identifiers to labels,
decimal precision, and display behaviour. Applications can extend it with any custom
Soroban token.

```typescript
import { AssetRegistry, formatAmount, parseAmount } from "@zk-payroll/sdk";

// Use a built-in asset (native XLM, USDC, EUROC ship pre-registered)
const xlm = AssetRegistry.getOrThrow("native");
formatAmount(10_000_000n, xlm); // "1.0000000 XLM"

// Register a custom Soroban token
AssetRegistry.register({
  id: "CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC",
  code: "CUSTOM",
  decimals: 7,
});
```

## Payroll reliability helpers

The core package exports stable `PayrollRunStatus` values and
`parsePayrollRunStatus()` for untrusted API or contract responses. Large period
histories can be consumed with `iteratePayrollPeriods()` or
`collectPayrollPeriods()`; both support cursors, page limits, and cancellation.

Wrap idempotent RPC reads with `withRpcRetry()` to retry transient failures with
bounded exponential backoff. Validation and contract reverts are never retried.
Use an idempotency key before applying retries to a write operation.

Pagination guardrails protect consumers from accidental unbounded pagination
requests and loops: `iterateGuardedPages()` / `collectGuardedPages()` traverse
any paginated source under configurable page-size, page-budget, and
record-budget caps, detect sources that repeat cursors, and support abort
signals — with privacy-safe, actionable errors. The same protections already
apply to `iteratePayrollPeriods()` / `collectPayrollPeriods()`.

`validatePayoutDestination()` validates Stellar account and muxed-account
destinations without including rejected values in error messages. The same
validation runs automatically before `PayrollService` submits a payment.

### Safe Payout Batch Chunking

`chunkPayoutBatches()` splits raw payout entries into validated batches according to a configured maximum batch size (safety limit). This helps developers ensure that large payroll runs are safely grouped before processing or signing.

```typescript
import { chunkPayoutBatches } from "@zk-payroll/core";

const { chunks, errors } = chunkPayoutBatches(entries, { maxBatchSize: 100 });

if (errors.length > 0) {
  // validation failed before chunking.
  // errors are privacy-safe and never leak sensitive values.
  console.error("Batch validation failed", errors);
} else {
  // process the valid chunks
  for (const chunk of chunks) {
    await processBatch(chunk);
  }
}
```
The chunking helper validates all entries first, returning structured `BatchValidationError` objects if any recipient, amount, or asset is invalid. If validation fails, no chunks are produced. Error messages are actionable but carefully avoid echoing sensitive values like amounts.

### Resuming an interrupted batch submission

`submitSequentialPayrollBatches()` (and `PayrollService#submitBatchPaymentsSafely()`)
accept an `onCheckpoint` callback that fires after every batch completes
successfully, and a `resumeToken` option to continue a submission that was
interrupted (process crash, network loss, manual cancellation) without
resubmitting already-completed batches.

```typescript
import { submitSequentialPayrollBatches } from "@zk-payroll/core";

let lastCheckpoint: string | undefined;

const result = await submitSequentialPayrollBatches(entries, submitBatch, {
  batchSize: 50,
  onCheckpoint: (resumeToken) => {
    lastCheckpoint = resumeToken;
    // Persist to disk / a queue / local storage so it survives a restart.
  },
});

// ...process crashes or is cancelled before completion...

const resumed = await submitSequentialPayrollBatches(entries, submitBatch, {
  batchSize: 50, // must match the original run
  resumeToken: lastCheckpoint,
});
```

A resume token is opaque and **privacy-safe**: it never contains recipient
addresses or payment amounts, only a non-reversible commitment hash of the
batch entries plus batch/item counters. Before skipping any batches, the SDK
independently re-derives that commitment from the `entries` passed to the
resumed call and rejects the token with an actionable `ValidationError` if:

- the entries collection has changed since the token was issued (different
  commitment hash),
- `batchSize` does not match the value used to create the token, or
- the token is malformed, corrupted, or references a batch index outside the
  current submission plan.

On failure or cancellation, `SafeBatchSubmissionResult.error.resumeToken` is
also populated (when at least one batch already succeeded), so callers that
don't wire up `onCheckpoint` can still resume from the returned error.

## Destination validation extension point

Host applications can register a custom destination validator to add
organizational rules — allowlists, compliance holds, internal account
classification — on top of the built-in Stellar checks. The hook runs inside
`PayrollService` after built-in validation and before proof generation, so
blocked destinations never reach a submission.

```typescript
import { PayrollService } from "@zk-payroll/core";

// Register an organizational destination policy
PayrollService.setDestinationValidationHook((destination) => {
  if (isApprovedPayoutAccount(destination)) {
    return { ok: true, kind: "internal_treasury" };
  }
  // Reject with a stable code and sanitized message —
  // never echo the rejected destination value.
  return {
    ok: false,
    code: "COMPANY_DESTINATION_NOT_ALLOWED",
    message: "Destination is not on the approved payout list.",
  };
});

// Pre-flight check without submitting a payment
const result = await PayrollService.validateDestination(someDestination);
if (!result.ok) {
  console.error(result.code, result.message);
} // safe to log

// Restore built-in-only validation
PayrollService.resetDestinationValidationHook();
```

The gate fails closed: if the registered hook throws, the destination is
rejected with `DESTINATION_VALIDATION_UNAVAILABLE` and the fault detail is
discarded. Rejected values are never reflected in results, errors, progress
events, or logs — only stable codes and sanitized, actionable messages.

## Withholding configuration validation

`validateWithholdingConfig()` gates tax / statutory withholding rules before
they are applied to a payroll run. It returns an explicit result —
`{ ok: true, state: "validated", config, displayEmployeeId }` or
`{ ok: false, code, message, state }` — and never throws unless you call
`assertWithholdingConfig()`.

```typescript
import { PayrollService } from "@zk-payroll/core";

const result = PayrollService.validateWithholdingConfig(
  { employeeId: "emp-123456", method: "percentage", rate: 12.5 },
  { expectedEmployeeId: "emp-123456" }
);

if (!result.ok) {
  console.error(result.code, result.message); // safe to log: no identifiers, no amounts
} else {
  const { method, rate, rounding } = result.config; // normalized, ready to apply
}
```

The validator covers the payroll workflow's real failure states: a missing or
unsupported `method`; missing, negative, zero, out-of-range, or over-precise
percentage rates (`0 < rate <= 100`, with `maxRate` / `allowZeroRate` policy
knobs); missing, negative, zero, or malformed fixed amounts; a per-run cap that
contradicts the configured amount; unsupported rounding modes; empty
jurisdiction labels; and employee bindings that do not match the run
(`requireEmployeeId`, `expectedEmployeeId`).

Failure messages carry only stable codes, sanitized text, and a redacted
employee identifier (`emp***321`); configured amounts are always `[REDACTED]`
unless `includeAmounts: true` is set for internal debugging.
`validateBatchWithholdingConfigs()` aggregates per-entry issues with their
array indexes for per-employee rule sets, `assertWithholdingConfig()` throws a
typed `WithholdingConfigError` when a hard gate is needed, and
`PayrollService.validateWithholdingConfig()` exposes the same check as an
instance and static helper.

## Audit Grant Scope Reader

Read the **effective** audit access scope for an auditor, not just the scope that was last written to disk (`#497`). Auditors accumulate grants over time — a `read-only` window, a later `full-audit` grant, one that quietly expired, one an admin revoked. `readEffectiveAuditGrantScope()` folds every grant into one typed answer so a payroll workflow never hands departmental breakdowns to a stale grant, and never blocks a legitimate auditor because it read the wrong record.

- **Fail-Closed Scope Resolution**: Reports the widest scope among grants that are **live** at the reference time — a lapsed `full-audit` grant can never widen current access, and `scope` is `null` when nothing is live.
- **Typed Lifecycle State**: Per-grant `"active" | "expired" | "revoked"` plus an effective `"active" | "expired" | "revoked" | "none"` state, with expiry ranked above revocation so a lapsed grant stays recoverable.
- **Privacy Guaranteed**: The report is metadata-only — view-key tokens, secret keys, salaries, and employee records are never copied through, and unknown fields on the source record are dropped. Every message masks addresses (`GBS***JHR`) and is safe to log verbatim.
- **Actionable Errors**: Coded `ValidationError`s (`AUDIT_GRANT_SCOPE_INVALID`, `AUDIT_GRANT_LIFECYCLE_INVALID`, …) name the offending field path without echoing payloads or payroll values.

```typescript
import {
  readEffectiveAuditGrantScope,
  auditScopeSatisfies,
} from "@zk-payroll/core";

const report = readEffectiveAuditGrantScope(persistedGrants);

if (!report.allGranteesActive) {
  // Privacy-safe: grantee addresses are masked.
  console.warn(report.message);
  // e.g. "1 of 2 grantee(s) have no live audit access: GBS***JHR"
}

for (const entry of report.grantees) {
  console.log(entry.redactedGrantee, entry.scope, entry.state);
  // e.g. "GBS***JHR" "read-only" "active"

  // A null scope (lapsed or fully revoked) never satisfies a requirement.
  if (!auditScopeSatisfies(entry.scope, "full-audit")) {
    console.log(`Limited to ${entry.scope ?? "no access"} (${entry.state})`);
    continue;
  }

  // Safe to include departmental breakdowns for this reviewer.
  await buildSelectiveDisclosurePackage(entry.grants);
}
```

## Payroll Recipient Lock Status Reader

Expose whether a payout recipient is locked because of an active payroll execution (`#512`). This strengthens operational workflows by preventing duplicate payouts, race conditions, and double-settlement during in-flight batch execution while keeping private salary and employee data protected.

- **Privacy Guaranteed**: Private compensation and salary figures are never part of lock evaluations or messages. Recipient addresses and internal payroll identifiers are automatically masked (`GA2C...6E67`, `pay...-01`) for safe logging and UI display.
- **Contract & Offline Evaluation**: Query live on-chain lock status via `fetchRecipientLockStatus()` / `PayrollService#getRecipientLockStatus()`, or evaluate offline in-flight state via `evaluateRecipientLockStatus()` / `evaluateBatchRecipientLockStatus()`.
- **UI & Dashboard Safe**: Formatted labels (`formatRecipientLockStatus()`) provide single-line status summaries with status badges (`🔒 LOCKED` / `🔓 UNLOCKED`).

```typescript
import {
  fetchRecipientLockStatus,
  evaluateRecipientLockStatus,
  evaluateBatchRecipientLockStatus,
  formatRecipientLockStatus,
  isRecipientLocked,
  PayrollService,
} from "@zk-payroll/core";

// 1. Query on-chain lock status from contract
const status = await payrollService.getRecipientLockStatus(recipientAddress, employerAddress);

if (status.isLocked) {
  // Recipient is actively locked in an in-flight payroll run
  console.log(formatRecipientLockStatus(status));
  // e.g. "Recipient GA2C...6E67: 🔒 LOCKED (active_payroll_execution in run pay...-01 since 2026-09-29T12:00:00.000Z)"
} else {
  console.log("Safe to proceed with payout:", status.canReceivePayout);
}

// 2. Pure offline evaluation across active in-flight executions
const activeExecutions = [
  {
    payrollId: "batch-run-2024-09",
    status: "executing",
    recipients: ["GA2C5RFPE6GCKMY3Z4DC6NOURMDRYZ3UMDVQ4N5ACFBPQ4E3Y3376E67"],
    lockedAt: Date.now() - 10 * 60 * 1000,
  },
];

const evalStatus = evaluateRecipientLockStatus(recipientAddress, activeExecutions, {
  lockTimeoutMs: 60 * 60 * 1000, // 1 hour timeout
});

// 3. Batch evaluation for pre-flight payroll checks
const batchSummary = evaluateBatchRecipientLockStatus(
  ["GA2C...6E67", "GBBD...7WHF"],
  activeExecutions
);
console.log(`Checked ${batchSummary.totalChecked} recipients: ${batchSummary.lockedCount} locked.`);
```

## Payroll Draft Lock Inspection Helper

Inspect payroll draft lock readiness and operational lock state before submission or settlement (`#537`). Evaluates whether a draft can be safely locked, whether it is already locked or expired, whether any recipients are locked by in-flight active payroll executions, and whether draft checksums and authorizer requirements are met.

- **Privacy Guaranteed**: Salary amounts and employee compensation figures are never exposed in blocker messages, warnings, or summaries. Recipient addresses and draft labels are automatically masked (`GA2C...6E67`, `Eng...oll`).
- **Comprehensive Blocker Detection**: Validates empty drafts, duplicate recipients, expired locks, authorizer permissions, checksum integrity, and cross-checks in-flight active executions for recipient locks.
- **Fluent & Service Integration**: Available via `inspectDraftLock()`, `assertDraftLockable()`, `draftBuilder.inspectLock()`, or `PayrollService#inspectDraftLock()`.

```typescript
import {
  DraftBuilder,
  inspectDraftLock,
  assertDraftLockable,
  formatDraftLockInspectionSummary,
} from "@zk-payroll/core";

// 1. Build and inspect a draft before locking
const builder = new DraftBuilder(undefined, "March Payroll")
  .add({ recipientId: "GA2C5RFPE6GCKMY3Z4DC6NOURMDRYZ3UMDVQ4N5ACFBPQ4E3Y3376E67", amount: "1000", asset: "native" })
  .add({ recipientId: "GBBDU6DDT5I7VO6JCT262L7X3T32NZZ6XUMG575U5K7F5T27YJ3W7WHF", amount: "2500", asset: "native" });

const inspection = builder.inspectLock({
  activeExecutions: inFlightRuns,
  authorizer: "GADMIN...",
  allowedAuthorizers: ["GADMIN..."],
});

console.log(inspection.summary);
// e.g. "Draft (Mar...oll): ✅ LOCK READY | 2 entries | 2 recipients | assets: native"

if (!inspection.canLock) {
  // Actionable, privacy-safe blockers
  for (const blocker of inspection.blockers) {
    console.error(`[${blocker.code}] ${blocker.message}`);
  }
} else {
  // Safe to lock and submit
  builder.assertLockable();
}
```

## SDK Blocked Execution Diagnostics

Pure, privacy-safe diagnostics engine for identifying, categorizing, and explaining why a payroll execution is blocked prior to on-chain submission (`#605`).

- **Zero Information Leakage**: Never exposes individual compensation numbers, private keys, or unmasked recipient credentials. Only aggregate totals, masked identifiers (`GA2C...6E67`, `EMP***1`), and operational metadata are emitted.
- **Comprehensive Blocker Detection**: Evaluates treasury reserves & buffers, ZK proof freshness and verification, contract pause states, batch capacity limits, approval governance, wallet rotation cooldowns, recipient eligibility, and session auth nonces.
- **Actionable Remediation**: Every blocker and warning provides a structured remediation with action types (`fund_treasury`, `generate_proof`, `split_batch`, `reauthenticate`, `resolve_recipients`, etc.) and suggested resolution steps.
- **Fluent & Service Integration**: Available via `diagnoseBlockedExecution()`, `assertCanExecute()`, `formatBlockedExecutionReport()`, or `PayrollService#diagnoseBlockedExecution()`.

```typescript
import {
  diagnoseBlockedExecution,
  assertCanExecute,
  formatBlockedExecutionReport,
} from "@zk-payroll/core";

const report = diagnoseBlockedExecution({
  runId: "run_001",
  totalAmount: 50_000,
  treasuryBalance: 20_000, // Shortfall: $30,000
  hasProof: false,         // Missing ZK proof
});

console.log(formatBlockedExecutionReport(report));

if (report.isBlocked) {
  console.log(`Execution blocked by ${report.blockerCount} issue(s):`);
  for (const blocker of report.blockers) {
    console.log(`[${blocker.code}] ${blocker.message}`);
    console.log(` -> Action: ${blocker.remediation.label} (${blocker.remediation.suggestedAction})`);
  }
} else {
  assertCanExecute(report);
}
```

## Event Stream Deduplication

The SDK provides deduplication helpers to prevent processing the same payroll event more than once. This strengthens payroll workflows while keeping private salary and employee data protected.
