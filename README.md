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

- **Typed Contract Clients**: Fully typed client wrappers for PayrollRegistry, SalaryCommitment, ProofVerifier, PaymentExecutor, and AuditHold contracts.
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

// Cancel a scheduled payment
await client.cancel(scheduled.paymentId, signer);

// Get pending payments
const payments = await client.getPendingPayments("G...", 0n, 20, signer);
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

## Documentation

- [Setup Guide](./docs/setup.md) - Environment variables and local development setup
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



draft pr 
