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
const config = ConfigPresets.testnet().withContractId("CCONTRACT_ID_EXAMPLE").build();
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

```typescript
import { PayrollService, DEFAULT_CONFIG } from "@zk-payroll/sdk";

// Initialize service
const service = new PayrollService(DEFAULT_CONFIG);

// Process a private payment
await service.processPayment(
  "G...", // Recipient Stellar address
  1000n // Amount
);
```

## Features

- **Typed Contract Clients**: Fully typed client wrappers for PayrollRegistry, SalaryCommitment, ProofVerifier, PaymentExecutor, PreflightClient, and AuditHold contracts.
- **ZK Proof Generation**: Client-side proof generation using snarkjs for privacy.
- **Caching**: Built-in caching for proofs and circuit artifacts.
- **Error Handling**: Robust error typing and management.
- **Safe Payroll Batch Submission**: Sequential batch execution with progress callbacks, guarded retries, and privacy-preserving error handling.
- **Contract Event Decoding**: Typed decoding of contract status and lifecycle events including employee status transitions.
- **Mock Testing Environment**: Comprehensive testing utilities for unit tests without a live network.

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
  console.error(result.code, result.message); // safe to log
}

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

## Event Stream Deduplication

The SDK provides deduplication helpers to prevent processing the same payroll event more than once. This strengthens payroll workflows while keeping private salary and employee data protected.

```typescript
import { detectDuplicates, formatDeduplicationSummary } from "@zk-payroll/core";

// Detect duplicate entries in a payroll batch
const entries = [
  { recipient: "GA1...", amount: 1000n, asset: "native" },
  { recipient: "GB2...", amount: 2000n, asset: "native" },
  { recipient: "GA1...", amount: 1000n, asset: "native" }, // Duplicate
];

const result = detectDuplicates(entries);
if (result.hasDuplicates) {
  console.log(formatDeduplicationSummary(result));
  // Output: "Duplicate recipient: GA1... at indices [0, 2]"
}
```

The deduplication helper:
- Validates input data and configuration before processing
- Provides privacy-safe error messages that don't expose sensitive payroll values
- Supports configurable deduplication keys (recipient, amount, asset)
- Returns detailed duplicate information for debugging without revealing full addresses or amounts

## Duplicate employee record validation

`PayrollRequestBuilder` rejects payroll requests that reference the same
employee more than once, catching accidental re-submissions and duplicated rows
before a request is created. Detection is case-insensitive by default and
messages expose only a masked identifier (`EMP***001`) — never the full
employee ID.

```typescript
import { PayrollRequestBuilder, detectDuplicateEmployeeRecords } from "@zk-payroll/core";

const builder = new PayrollRequestBuilder()
  .add({ recipient: "GA1...", amount: 1000n, asset: "native", employeeId: "EMP-001" })
  .add({ recipient: "GB2...", amount: 2000n, asset: "native", employeeId: "emp-001" });

// Inspect without building — returns a structured, privacy-safe report.
const report = builder.validate();
// report.errors[0].code === "DUPLICATE_EMPLOYEE_ID"

// build() throws when duplicates are present, naming only the masked id.
builder.build(); // Error: ... Duplicate employee record "EMP***001" (also at index 0)

// Or scan a plain list of records directly.
detectDuplicateEmployeeRecords([{ employeeId: "EMP-001" }, { employeeId: "EMP-001" }]);
```

Entries without an `employeeId` are ignored, so existing request flows are
unaffected.

## Configurable SDK logging

Host applications can route SDK diagnostics into their own logger. All log
context is redacted before it reaches the host, so sensitive payroll values
never leak into application logs.

```typescript
import { setSdkLogger, createConsoleLogger, resetSdkLogger } from "@zk-payroll/core";

// Forward SDK logs to your own pipeline…
setSdkLogger((entry) => myLogger[entry.level](entry.event, entry.context));
// …or bridge to the console, or silence the SDK entirely (the default).
setSdkLogger(createConsoleLogger());
resetSdkLogger();
```

Per-instance `SdkLogger` injection (`new PayrollService(..., logger)`) keeps
working; `setSdkLogger()` additionally configures the process-wide default.

## Payroll completion polling

`pollPayrollCompletion()` / `waitForPayrollRunCompletion()` provide bounded
polling with cancellation support for long-running payrolls. Timeouts throw a
`ContractExecutionError` (`TRANSACTION_TIMEOUT`) whose message never echoes
status values.

```typescript
import { pollPayrollCompletion, waitForPayrollRunCompletion } from "@zk-payroll/core";

const controller = new AbortController();
const { value } = await waitForPayrollRunCompletion(() => fetchRunStatus(runId), {
  timeoutMs: 90_000,
  intervalMs: 2_000,
  signal: controller.signal, // abort when the user navigates away
});
```

## Transaction fee estimation

Estimate what a Soroban transaction will cost **before** it is signed or
submitted. `TransactionFeeEstimator` wraps RPC simulation and returns a
privacy-safe `TransactionFeeEstimate` — base fee, Soroban resource fee, an
optional safety buffer, and a human-readable breakdown — never recipient
addresses, amounts, or proofs.

```typescript
import {
  TransactionFeeEstimator,
  estimatePreparedTransactionFee,
} from "@zk-payroll/core";

const estimator = new TransactionFeeEstimator(server, { bufferBps: 1_000 }); // +10%

// Build the unsigned transaction first — no signing, no submission.
const prepared = await contractWrapper.buildPrivatePayInvocation(
  recipient,
  amount,
  asset,
  proof,
  sourcePublicKey
);

// Option A: simulate an unsigned transaction
const estimate = await estimator.estimate(prepared.transaction);

// Option B: reuse the simulation already performed while building (no extra RPC)
const same = estimatePreparedTransactionFee(prepared.transaction, { bufferBps: 1_000 });

console.log(estimate.totalFee, estimate.breakdown);
// "Base: 100, Resource: 1234, Buffer: 133, Total: 1467 stroops"
```

`PayrollContractWrapper.estimatePrivatePayFee(recipient, amount, asset, proof,
sourcePublicKey, network?, options?)` is the payroll-specific wrapper: it builds
and simulates a `private_pay` invocation without a signer and without
broadcasting, then returns the exact fee the assembled transaction would carry.
Fee-estimation failures are typed and sanitized — a `ValidationError` for
non-Soroban/empty transactions and a `ContractExecutionError` with
`SIMULATION_FAILED` for rejected simulations — and never echo rejected
destination, amount, or proof values.

## Transaction fee ceiling

Gate an estimate against an explicit maximum **before** anything is signed or
submitted. Pass `feeCeiling` (stroops) to any estimation entry point — the
cap is applied to the total the transaction would actually carry, including
the safety buffer — or run the validator yourself for a non-throwing
pre-flight check.

```typescript
import { validateFeeCeiling, TransactionFeeCeilingError } from "@zk-payroll/core";

// Fail fast when the simulated total (base + resource + buffer) is too expensive:
const estimate = await contractWrapper.estimatePrivatePayFee(
  recipient,
  amount,
  asset,
  proof,
  sourcePublicKey,
  undefined,
  { bufferBps: 1_000, feeCeiling: 5_000n } // throws TransactionFeeCeilingError
);

// Or check without throwing:
const check = validateFeeCeiling(estimate.totalFee, 5_000n, { warnBps: 8_000 });
if (!check.ok) {
  console.error(check.code, check.message); // safe to log
} else if (check.state === "approaching_ceiling") {
  console.warn(check.warning); // 80%+ of the ceiling already committed
}
```

`validateFeeCeiling()` returns `{ ok: true, state, fee, ceiling, headroom,
utilizationBps, warning }` or `{ ok: false, state, code, message }`. States
are `within_ceiling`, `approaching_ceiling` (default ≥ 80% of the ceiling,
tunable via `warnBps`, `0` disables), `exceeds_ceiling`, and `invalid`
(malformed fee, non-positive ceiling, or an out-of-range `warnBps`).
`assertFeeWithinCeiling()` throws a typed `TransactionFeeCeilingError`,
`validateTransactionFeeCeiling()` applies the same gate to a
`TransactionFeeEstimate`, and `isFeeWithinCeiling()` is the boolean shortcut.
Messages carry fee figures and an optional operation label only — never
recipients, payroll amounts, or proofs — and a malformed `feeCeiling` option
surfaces as a `ValidationError` (`FEE_ESTIMATION_INVALID_CEILING`).

## Request identifier propagation

Pass a `requestId` to correlate one payroll operation across transaction
confirmation polling, emitted events, error messages, network timing records
and outbound HTTP artifact requests.

```typescript
import { RunIdentifier, TransactionWatcher, timeAxiosRequest } from "@zk-payroll/core";

const runId = RunIdentifier.generate();
const requestId = RunIdentifier.generateCorrelationId(runId, "private_pay");

const watcher = new TransactionWatcher(server);
watcher.on("timeout", ({ txHash, requestId }) => log.warn({ txHash, requestId }));
await watcher.waitForConfirmation(txHash, { requestId });

// HTTP(S) requests carry it as an `X-Request-Id` header and on their timing record
const { timing } = await timeAxiosRequest({ url: artifactUrl }, onTiming, requestId);
```

- `polling`, `confirmed`, `timeout` and `cancelled` events, the
  `ConfirmationResult`, and failure/timeout/cancellation error messages all
  include the `requestId`.
- With `installAxiosTiming()`, an `X-Request-Id` header already set on a
  request is recorded on its timing record.
- IDs must be 1–128 characters of letters, digits, `.`, `_`, `:` or `-`
  (all `RunIdentifier` formats and UUIDs qualify). Anything else throws a
  `ValidationError` with code `INVALID_REQUEST_ID` **before** any network
  call, and the error never echoes the rejected value — so free-form text
  such as names or salary amounts can't leak into logs or telemetry.

## Payroll run summaries

`createExecutionSummary()` builds the normalized summary; pair it with
`formatPayrollRunSummary()` (human-readable text for notifications and audits)
or `toPayrollRunDashboardView()` (JSON-safe view with counts, success rate,
and timing for dashboards). Recipient addresses are truncated by default and
are only revealed in full with explicit `fullRecipients: true` in authorized
audit contexts.

```typescript
import { createExecutionSummary, formatPayrollRunSummary } from "@zk-payroll/core";

const summary = createExecutionSummary(outcomes, durationMs);
console.log(formatPayrollRunSummary(summary));
```

## Payroll command serialization

`encodePayrollCommandEntry()` / `encodePayrollRequest()` serialize payroll
command payloads to the versioned binary wire format (tags `0x05`/`0x06`),
validating entries against contract expectations (non-empty recipient,
positive amount, non-empty asset) at encode time so incompatible requests
fail fast with a clear `SerializationError` instead of an opaque on-chain
revert.

```typescript
import { encodePayrollRequest, decodePayrollRequest } from "@zk-payroll/core";

const bytes = encodePayrollRequest(request);
const roundTripped = decodePayrollRequest(bytes);
```

`validateSettlementReceipt()` validates settlement receipts produced after
payroll finalization before they enter reconciliation or archival flows. It
checks the receipt and payroll identifiers, settled status, transaction
reference, and metadata digest — returning an explicit result with a stable
error code and a sanitized, actionable message that never echoes rejected
values. The display receipt ID in the result is redacted for safe logging.

## Signed payroll instruction builder

`SignedPayrollInstructionBuilder` composes a payroll request, deterministically
serializes it (the same encoder used for on-chain command payloads), and
produces a signed, auditable instruction — independent of transaction
assembly and submission. It's the right building block when a payroll
instruction needs to be authorized, persisted, or handed to an approver
*before* a Soroban transaction exists.

```typescript
import {
  SignedPayrollInstructionBuilder,
  KeypairInstructionSigner,
  verifySignedPayrollInstruction,
  describeSignedPayrollInstruction,
} from "@zk-payroll/core";

const instruction = await new SignedPayrollInstructionBuilder()
  .add({ recipient: "GABC...", amount: 1000n, asset: "native" })
  .withContext({ network: "testnet", contractId: "CABC..." })
  .sign(new KeypairInstructionSigner(employerKeypair));

// Safe to log or display — never contains recipient/amount values.
console.log(describeSignedPayrollInstruction(instruction));

// Independently verify integrity (unmodified since signing) and authenticity
// (the signature matches signerPublicKey) before acting on the instruction.
const check = await verifySignedPayrollInstruction(instruction);
if (!check.ok) {
  console.error(check.code, check.message); // safe to log
}
```

`sign()` throws a typed `PayrollInstructionError` for empty or invalid
entries, an unavailable signer, or a signing failure — messages carry only
stable codes and field/index references, never recipient, amount, or asset
values. Any object implementing `getPublicKey()` / `signPayload()` can be
used as the signer (`KeypairInstructionSigner` adapts a Stellar `Keypair`),
so hardware wallets, browser extensions, or KMS-backed signers work the same
way as backend keypairs.

## SDK / contract revision compatibility warnings

`checkConnectedContractCompatibility()` warns when the connected payroll
contract's revision falls outside the range this SDK version has been built
and tested against (`SDK_SUPPORTED_CONTRACT_REVISION_RANGE`). It's a
read-only, unsigned check — safe to run at startup or before a payroll run —
and never throws: RPC failures, an invalid contract ID, or a contract that
doesn't expose a revision method all resolve to `status: "unknown"` with a
stable code instead of crashing the workflow.

```typescript
import { checkConnectedContractCompatibility } from "@zk-payroll/core";

const warning = await checkConnectedContractCompatibility({ server, contractId });

if (!warning.compatible) {
  console.warn(warning.code, warning.message); // safe to log — no payroll values
}
```

States: `compatible`, `outdated` (contract revision below the SDK's minimum
— upgrade the contract or use an older SDK), `ahead` (contract revision
above the SDK's maximum — upgrade the SDK), and `unknown` (revision could
not be determined; treat as unverified rather than a hard failure). Only
integer revision numbers are read from or reported by this check — never
recipient, amount, or employee data.

Use `checkContractRevisionCompatibility(revision, range?)` directly when you
already have the revision (e.g. from your own contract read) and just need
the comparison, without an RPC round-trip.

## Explicit Operation Result Types

Instead of relying on thrown exceptions alone, `runSdkOperation()` returns an
explicit discriminated result: `{ ok: true, value }` on success and
`{ ok: false, error }` on failure. Failure results carry a stable error code,
a sanitized message, retryability classification, and actionable remediation
guidance — with sensitive payroll values (amounts, salaries, keys, recipients)
redacted before the result is ever returned.

```typescript
import { runSdkOperation, unwrapSdkOperationResult } from "@zk-payroll/core";

const result = await runSdkOperation(() => client.pay(params), {
  operation: "payroll_pay",
  validate: () => (params.amount > 0n ? { ok: true } : { ok: false, message: "Amount must be positive." }),
  onEvent: (event) => logger.info(event), // sanitized, safe to log
});

if (result.ok) {
  console.log("Correlation ID:", result.correlationId);
} else {
  console.error(result.error.code, result.error.message); // never contains payroll values
  console.error(result.error.remediation.action); // actionable next step
  console.error("Retryable:", result.error.retryable);
}

// Or throw on failure with a sanitized, typed error:
const value = unwrapSdkOperationResult(result);
```

`EmployeeLifecycleClient` methods (`create`, `suspend`, `reactivate`,
`offboard`) return the same explicit result shape, validate destinations
locally before any network call, and never throw for expected failures.

## Contract error remediation hints

`toUserFriendlyErrorWithGuidance()` combines the SDK's existing
`toUserFriendlyError()` message mapping with audience-specific "what do I do
now" guidance, so applications can surface an actionable next step alongside
any contract, wallet, network, or validation error without building their own
error-code lookup table.

```typescript
import { toUserFriendlyErrorWithGuidance } from "@zk-payroll/core";

try {
  await payroll.processPayment(params);
} catch (err) {
  const { friendlyMessage, remediation } = toUserFriendlyErrorWithGuidance(err);
  showToast(friendlyMessage, remediation.action);
  // remediation.selfServiceable tells you whether to show a "retry" action
  // or a "contact your administrator" action.
}
```

Guidance is tailored per audience via `RemediationAudience` (`"admin"`,
`"contributor"`, `"sdk-user"` (default), `"auditor"`) — the same error can
tell an SDK-integrating application to "contact your payroll administrator"
while telling an admin to "verify the calling account holds the required
contract role." Use `mapErrorToRemediation(error, audience)` directly (from
the same module) when you only need the guidance, not the friendly message.

Guidance text is static, curated copy keyed by stable error code — never
interpolated from the underlying error — so it cannot leak recipient
addresses, amounts, or other private payroll values even if the original
error message contains them. Unrecognized error codes always resolve to a
safe, generic fallback (`remediation.known === false`) instead of throwing.

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
await client.batchCommit(
  "G...",
  [
    { employee: "G...1", commitmentHash: "abcd", cycleId: 1n },
    { employee: "G...2", commitmentHash: "ef01", cycleId: 1n },
  ],
  signer
);

// Verify a commitment against a ZK proof
const isValid = await client.verifyCommitment("G...", "G...", 1n, proof, signer);

// Reveal the actual salary
await client.revealSalary("G...", "G...", 1n, 1000n, signer);
```

### ProofVerifierClient

```typescript
import { ProofVerifierClient } from "@zk-payroll/sdk";

const client = new ProofVerifierClient(server, "CCONTRACT_ID...");

// Verify a ZK proof on-chain
const valid = await client.verify(
  {
    pi_a: ["1", "2"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
    ],
    pi_c: ["7", "8"],
    publicSignals: ["sig1"],
  },
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

// Cancel a scheduled payment with an optional reason code
await client.cancel(scheduled.paymentId, signer, "insufficient_funds");

// Get pending payments
const payments = await client.getPendingPayments("G...", 0n, 20, signer);
```

### PreflightClient

Expose the contract preflight response as typed, actionable execution blockers. This strengthens a practical payroll workflow while keeping private salary and employee data protected.

```typescript
import { PreflightClient } from "@zk-payroll/sdk";

const client = new PreflightClient(server, "CCONTRACT_ID...");

// Validate an execution via dry-run simulation
const result = await client.preflightExecute(
  { recipient: "G...", amount: 1000n, asset: "native", memo: "salary" },
  signer.publicKey() // Can check without signing
);

if (!result.canProceed) {
  console.error("Dry run failed:", result.findings);
} else {
  console.log("Safe to execute!");
}
```

### AuditHoldClient

Query and release compliance holds. Release authorization is validated locally
before any network call, and the authorization token and hold notes are never
exposed in errors or dashboard-facing output.

```typescript
import { AuditHoldClient } from "@zk-payroll/sdk";

### Employer Onboarding Readiness

Before starting an employer payroll workflow, use `checkEmployerReadiness` to verify the employer
address and signer match, the RPC and payroll contract are available, and the employer account
exists on the selected network. The check is read-only and returns fixed diagnostic messages; it
does not include signer errors, addresses, balances, employee data, or salary values in its result.

```typescript
import { checkEmployerReadiness } from "@zk-payroll/sdk";

const readiness = await checkEmployerReadiness({
  config: clientConfig,
  employerAddress,
  signer,
});

if (!readiness.canProceed) {
  for (const check of readiness.checks) {
    console.error(`[${check.code}] ${check.message}`);
  }
  throw new Error(`Employer readiness status: ${readiness.status}`);
}

// Continue with employer onboarding or PayrollService setup.
```

If the employer account is missing, create and fund it on the configured network. A `ready`
result confirms account existence and setup checks; it does not read account balances or guarantee
that the employer has enough XLM for transaction fees or enough of the payment asset for a payroll
run.

## Multi-Asset Support

// Check a hold's status (malformed responses parse to state: "unknown", fail closed)
const hold = await client.getAuditHoldStatus("hold-1", signer);

// Release a hold once compliance clears it
const release = await client.releaseAuditHold(
  {
    holdId: "hold-1",
    releasedBy: "G...",
    authorizationToken: process.env.HOLD_RELEASE_TOKEN!,
    releaseReason: "KYC review completed",
  },
  signer
);
console.log(release.explanation); // dashboards-safe summary
```

## Environment Variables

The SDK and its examples read configuration from environment variables so that
contracts, RPC endpoints, and circuit artifacts can be swapped per environment
without code changes. Never commit secrets (private keys) to version control.

| Variable | Required | Default | Description |
|---|---|---|---|
| `STELLAR_RPC_URL` / `SOROBAN_RPC_URL` | No | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint for contract calls |
| `PAYROLL_CONTRACT_ID` / `CONTRACT_ID` | Yes for live calls | `""` | Deployed Payroll contract address (`C...`) |
| `REGISTRY_CONTRACT_ID` | No | — | PayrollRegistry contract address |
| `SALARY_COMMITMENT_CONTRACT_ID` | No | — | SalaryCommitment contract address |
| `PROOF_VERIFIER_CONTRACT_ID` | No | — | ProofVerifier contract address |
| `PAYMENT_EXECUTOR_CONTRACT_ID` | No | — | PaymentExecutor contract address |
| `WASM_URL` | No* | — | URL or local path to the circuit `.wasm` artifact |
| `ZKEY_URL` | No* | — | URL or local path to the proving key `.zkey` artifact |
| `NETWORK_PASSPHRASE` / `STELLAR_NETWORK` | No | `Test SDF Network ; September 2015` | Stellar network passphrase (`testnet` / `mainnet`) |
| `SIGNER_SECRET` / `STELLAR_SECRET_KEY` | No | — | Secret key for local signing (use only in local dev / tests) |
| `ARTIFACT_CACHE_TTL` | No | `86400` | Cache TTL in seconds for proof artifacts |

\* Required when using `SnarkjsProofGenerator` for real proof generation.
See [Setup Guide](./docs/setup.md) for `.env` examples and local quick-start.

**Privacy note:** The SDK never logs `recipient`, `amount`, `witness`, or
`privateKey` values. Logging hooks receive `[redacted]` for those fields via
`redactSensitive` – even when `STELLAR_SECRET_KEY` is set, the secret is
excluded from logs, exports, telemetry, and events.

## Safe Credential and Payroll Data Handling

Applications interacting with private zero-knowledge payroll contracts handle highly sensitive assets: Stellar secret keys (`S...`), zero-knowledge witness secrets, private viewing keys, and confidential employee compensation amounts.

The SDK includes dedicated safeguards to prevent credentials and private payroll data from leaking into persistent logs, unencrypted storage, or public telemetry:

- **Runtime Credential Scanning**: `validateSafeCredentialUsage()` and `assertSafeCredentialUsage()` detect accidentally exposed secret seeds, private hex keys, seed phrases, and plaintext salaries before payloads are logged or transmitted.
- **Deep Sanitization for Persistence**: `sanitizeForPersistence()` deeply walks complex payloads and strips or masks credentials and salary records before database persistence or caching.
- **Safe Credential Masking**: `maskCredential()` partially masks secret seeds (e.g. `S****...****XYZ`) for safe administrative display without exposing the secret body.
- **Leak Auditing**: `SafeCredentialAuditor` tracks operations across batch jobs to guarantee no secret leakage occurred.

```typescript
import {
  validateSafeCredentialUsage,
  assertSafeCredentialUsage,
  sanitizeForPersistence,
  maskCredential,
  SafeCredentialAuditor,
} from "@zk-payroll/core";

// 1. Assert payload safety before logging or submitting
assertSafeCredentialUsage(payload, { context: "logging" });

// 2. Deeply sanitize before storing to database or local cache
const safeRecord = sanitizeForPersistence(payrollDraft, {
  removeSecrets: true,
  redactCompensation: true,
  maskIdentifiers: true,
});
await db.collection("payroll_drafts").insertOne(safeRecord);

// 3. Mask keys safely for audit or administrative logs
const displayKey = maskCredential(process.env.STELLAR_SECRET_KEY);
console.log(`Configured signer: ${displayKey}`);
```

For complete architectural patterns, threat models, and an incident response checklist, see the [Safe Credential Handling Guide](./docs/SAFE_CREDENTIAL_HANDLING.md).

## Documentation

- [Setup Guide](./docs/setup.md) - Environment variables and local development setup
- [Safe Credential Handling](./docs/SAFE_CREDENTIAL_HANDLING.md) - Best practices for protecting secret keys, viewing keys, and employee salary data
- [Troubleshooting Guide](./docs/TROUBLESHOOTING.md) - Fixes for common install, build, and test failures
- [API Reference](./docs/API.md) - Complete API documentation
- [Pagination Helpers](./docs/pagination.md) - Cursor- and offset-based pagination for payroll history and audit records
- [Payroll UX Helpers](./docs/payroll-ux-helpers.md) - Configurable logging, completion polling, run summaries, and command serialization
- [ZK Proof Generation](./docs/ZK_PROOF_GENERATION.md) - Detailed proof generation guide
- [Examples](./examples/README.md) - Runnable examples and setup steps

## Development

```bash
# 1. Clone and install
git clone https://github.com/your-org/zk-payroll-sdk.git
cd zk-payroll-sdk
npm install

# 2. Configure environment (copy and edit)
cp .env.example .env
# Edit .env with your RPC URL, contract IDs and artifact URLs

# 3. Build, typecheck, lint, and test
npm run build
npm run typecheck
npm run lint
npm test

# Or run via Turbo in the monorepo root
npm run build -w packages/core
npm run test -w packages/core
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/setup.md](./docs/setup.md) for
full contributor workflow, pre-commit hooks, and troubleshooting.
