# SDK API Reference

## Treasury replenishment readiness

Use `analyzeTreasuryReplenishmentReadiness` to compare per-asset payroll obligations with caller-supplied treasury balances. It returns whether payroll can execute now, each asset's buffered target balance, the exact top-up amount in stroops, and blockers or replenishment recommendations. Missing balances, locked treasuries, unsupported assets, and suspended assets are reported as blockers instead of producing a speculative top-up.

```typescript
import { analyzeTreasuryReplenishmentReadiness } from "@zk-payroll/core";

const analysis = analyzeTreasuryReplenishmentReadiness({
  obligations: [{ asset: "native", requiredAmount: 100_000n }],
  treasuryBalances: [{ asset: "native", availableBalance: 75_000n }],
  defaultBufferPercent: 10,
});

analysis.assets[0].replenishmentAmount; // 35_000n
analysis.canExecuteNow; // false
```

## Classes

## Idempotent payroll retries

Use `idempotencyKey` when submitting payroll payments so client-side retries do not create duplicate submissions.

```typescript
import { PayrollService, createPaymentIdempotencyKey } from "@zk-payroll/sdk";

const key = createPaymentIdempotencyKey({
  recipient: "G...",
  amount: 1000n,
  asset: "native",
});

const result = await service.processPayment({
  recipient: "G...",
  amount: 1000n,
  asset: "native",
  idempotencyKey: key,
});
```

Payment assets are validated before proof generation. Use `native` for XLM or a
valid Soroban token contract ID; malformed identifiers and classic issued
`CODE:ISSUER` assets are rejected with `INVALID_ASSET`. Batch validation reports
incompatible entries with the structured `INCOMPATIBLE_ASSET` error code.

### Recommendation

- Generate one idempotency key per user intent (for example, button click / request ID)
- Reuse the same key for retries of that same intent
- Use a new key for genuinely new payment requests

## Payroll operator permission validation

`PayrollService` can validate the connected signer against an authoritative role source before generating a proof or submitting a payment. Supply `resolveOperatorRoles` in the final constructor options argument; the resolver receives the signer address and must return its registered payroll roles.

```typescript
const service = new PayrollService(wrapper, proofGenerator, signer, network, logger, cache, {
  resolveOperatorRoles: (operatorAddress) => roleRegistry.getRoles(operatorAddress),
});
```

The SDK checks the `submit` capability using its payroll role matrix and rejects missing, malformed, or insufficient role data with `PayrollOperatorPermissionError`. Without a resolver, existing integrations retain their current behavior. Treat the resolver as a trusted authorization source; do not use roles supplied by an untrusted request.

### Typed Contract Clients

The SDK provides fully typed client wrappers for the core ZK Payroll Soroban contracts. Each client extends `BaseContractWrapper` and handles XDR encoding/decoding automatically.

### `PayrollRegistryClient`

Typed client for the `payroll_registry` contract. Manages employer-employee payroll relationships.

#### `constructor(server: rpc.Server, contractId: string, options?: ClientOptions)`

| Param                       | Type         | Description                                      |
| --------------------------- | ------------ | ------------------------------------------------ |
| `server`                    | `rpc.Server` | Soroban RPC server instance                      |
| `contractId`                | `string`     | Deployed contract address                        |
| `options.networkPassphrase` | `string`     | Network passphrase (default: `Networks.TESTNET`) |

#### `register(request: RegisterRequest, signer: Keypair, network?: string): Promise<void>`

Registers a new payroll relationship.

```typescript
interface RegisterRequest {
  employer: string; // Stellar address
  employee: string; // Stellar address
  salary: bigint; // Amount in stroops
  token: string; // Token contract address
  metadata?: string; // Optional description
}
```

#### `getRegistry(employer: string, employee: string, signer: Keypair, network?: string): Promise<RegistryEntry>`

Returns the payroll registry entry for an employer-employee pair.

```typescript
interface RegistryEntry {
  employer: string;
  employee: string;
  salary: bigint;
  token: string;
  metadata: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}
```

#### `updateRegistry(request: UpdateRegistryRequest, signer: Keypair, network?: string): Promise<void>`

Updates the salary for an existing registry entry.

```typescript
interface UpdateRegistryRequest {
  employer: string;
  employee: string;
  salary: bigint;
}
```

#### `deactivateRegistry(employer: string, employee: string, signer: Keypair, network?: string): Promise<void>`

Deactivates a payroll registry entry.

#### `getEmployeeCount(employer: string, signer: Keypair, network?: string): Promise<number>`

Returns the number of employees registered under an employer.

#### `getEmployees(employer: string, start: number, limit: number, signer: Keypair, network?: string): Promise<string[]>`

Returns a paginated list of employee addresses for an employer.

#### `registryExists(employer: string, employee: string, signer: Keypair, network?: string): Promise<boolean>`

Checks if a registry entry exists for the given employer-employee pair.

---

### `SalaryCommitmentClient`

Typed client for the `salary_commitment` contract. Handles salary commitments with ZK proof verification.

#### `constructor(server: rpc.Server, contractId: string, options?: ClientOptions)`

Same constructor pattern as `PayrollRegistryClient`.

#### `commit(request: CommitRequest, signer: Keypair, network?: string): Promise<void>`

Commits to a salary amount for a specific pay cycle using a hash.

```typescript
interface CommitRequest {
  employer: string;
  employee: string;
  commitmentHash: string; // Hex-encoded hash
  cycleId: bigint;
}
```

#### `getCommitment(employer: string, employee: string, cycleId: bigint, signer: Keypair, network?: string): Promise<CommitmentEntry>`

Returns the salary commitment for a specific cycle.

```typescript
interface CommitmentEntry {
  employer: string;
  employee: string;
  commitmentHash: string;
  cycleId: bigint;
  createdAt: number;
  revealed: boolean;
  actualAmount: bigint;
}
```

#### `batchCommit(employer: string, commitments: BatchCommitItem[], signer: Keypair, network?: string): Promise<void>`

Commits multiple salaries in a single transaction.

```typescript
interface BatchCommitItem {
  employee: string;
  commitmentHash: string;
  cycleId: bigint;
}
```

#### `verifyCommitment(employer: string, employee: string, cycleId: bigint, proof: ProofStruct, signer: Keypair, network?: string): Promise<boolean>`

Verifies a salary commitment against a ZK proof.

#### `revealSalary(employer: string, employee: string, cycleId: bigint, actualAmount: bigint, signer: Keypair, network?: string): Promise<void>`

Reveals the actual salary for a previously committed cycle.

#### `getCommitmentCount(employer: string, employee: string, signer: Keypair, network?: string): Promise<number>`

Returns the number of commitment cycles for an employer-employee pair.

---

### `ProofVerifierClient`

Typed client for the `proof_verifier` contract. Manages ZK proof verification and verification keys.

#### `constructor(server: rpc.Server, contractId: string, options?: ClientOptions)`

Same constructor pattern.

#### `verify(proof: ProofStruct, publicInputs: string[], verificationKeyId: number, signer: Keypair, network?: string): Promise<boolean>`

Verifies a ZK proof against a verification key.

```typescript
interface ProofStruct {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
  publicSignals: string[];
}
```

#### `addVerificationKey(vk: string, description: string, signer: Keypair, network?: string): Promise<number>`

Adds a new verification key and returns its ID.

#### `getVerificationKey(id: number, signer: Keypair, network?: string): Promise<string>`

Returns the raw verification key bytes as hex.

#### `setActiveVerificationKey(id: number, signer: Keypair, network?: string): Promise<void>`

Sets the active verification key by ID.

#### `getActiveVerificationKeyId(signer: Keypair, network?: string): Promise<number>`

Returns the ID of the currently active verification key.

#### `getVerificationKeyCount(signer: Keypair, network?: string): Promise<number>`

Returns the total number of verification keys stored.

#### `getVerificationKeyInfo(id: number, signer: Keypair, network?: string): Promise<VerificationKeyInfo>`

Returns metadata for a verification key.

```typescript
interface VerificationKeyInfo {
  id: number;
  description: string;
  key: string; // Hex-encoded
}
```

---

### `PaymentExecutorClient`

Typed client for the `payment_executor` contract. Handles executing and scheduling payments.

#### `constructor(server: rpc.Server, contractId: string, options?: ClientOptions)`

Same constructor pattern.

#### `execute(request: ExecutePaymentRequest, signer: Keypair, network?: string): Promise<ExecutePaymentResponse>`

Executes an immediate payment.

```typescript
interface ExecutePaymentRequest {
  recipient: string;
  amount: bigint;
  asset: string;
  memo?: string;
}

interface ExecutePaymentResponse {
  txHash: string;
}
```

#### `schedule(request: SchedulePaymentRequest, signer: Keypair, network?: string): Promise<SchedulePaymentResponse>`

Schedules a future payment.

```typescript
interface SchedulePaymentRequest {
  recipient: string;
  amount: bigint;
  asset: string;
  executeAt: number; // Unix timestamp
  memo?: string;
}

interface SchedulePaymentResponse {
  paymentId: bigint;
}
```

#### `cancel(paymentId: bigint, signer: Keypair, network?: string): Promise<void>`

Cancels a scheduled payment.

#### `getScheduledPayment(paymentId: bigint, signer: Keypair, network?: string): Promise<ScheduledPayment>`

Returns details of a scheduled payment.

```typescript
interface ScheduledPayment {
  id: bigint;
  employer: string;
  recipient: string;
  amount: bigint;
  asset: string;
  executeAt: number;
  memo: string;
  executed: boolean;
  cancelled: boolean;
  createdAt: number;
}
```

#### `getPendingPayments(employer: string, start: bigint, limit: number, signer: Keypair, network?: string): Promise<ScheduledPayment[]>`

Returns a paginated list of pending (non-executed, non-cancelled) payments for an employer.

#### `getPaymentCount(employer: string, signer: Keypair, network?: string): Promise<number>`

Returns the total number of payments scheduled by an employer.

---

### `AuditHoldClient`

Typed client for the audit / compliance hold contract methods (`#527`). Extends the
compliance hold helpers documented in the [Compliance Hold Client Helpers](#compliance-hold-client-helpers)
section of the SDK (see `parseHoldStatus`, `buildReleaseHoldRequest`, `isPayrollActionBlocked`).

#### `constructor(server: rpc.Server, contractId: string, options?: ClientOptions)`

Same constructor pattern as the other typed clients.

#### `getAuditHoldStatus(holdId: string, signer: Keypair | ISigner, network?: string): Promise<ComplianceHold>`

Fetches and parses the current status of a hold. Malformed or incomplete responses
parse to `state: "unknown"` (never `active` or `released`), so callers fail closed.

```typescript
const hold = await client.getAuditHoldStatus("hold-1", signer);
if (hold.state === "unknown") {
  // treat payroll as blocked until the status is confirmed
}
```

#### `releaseAuditHold(request: ReleaseHoldRequest, signer: Keypair | ISigner, network?: string): Promise<ReleaseAuditHoldResponse>`

Releases an audit hold after validating the release authorization **locally, before
any network call**: a missing `holdId`, `releasedBy`, or too-short `authorizationToken`
throws `HoldReleaseAuthorizationError` without broadcasting a transaction. The raw
authorization token is never echoed into the thrown error's context.

```typescript
interface ReleaseAuditHoldResponse {
  holdId: string;
  /** Post-release hold state; the free-text `note` is stripped for safe rendering. */
  hold: ComplianceHold;
  /** Dashboards-safe explanation (never includes the hold's note). */
  explanation: string;
}
```

Assumes the contract exposes:

- `get_audit_hold_status(hold_id)` → hold status struct
- `release_audit_hold(hold_id, released_by, authorization_token, release_reason?)` → updated hold struct

---

### `PayrollService`

Main entry point for payroll operations.

#### `constructor(config: ClientConfig)`

Initializes the service with network configuration.

#### `processPayment(recipient: string, amount: bigint): Promise<string>`

Generates a ZK proof and submits a payment transaction to the smart contract.

- **recipient**: Stellar address of the employee.
- **amount**: Salary amount to pay.
- **Returns**: Transaction hash.

#### Destination validation extension point

PayrollService runs a destination validation gate before proof generation and
submission. Built-in Stellar account/muxed-account checks always run first; a
registered extension hook adds organizational policy on top.

- **`PayrollService.setDestinationValidationHook(hook?)`** — registers a
  process-wide destination validator. The hook receives the already
  built-in-validated destination and returns `{ ok: true, kind? }` or
  `{ ok: false, code, message, retryable? }`. Pass `undefined` to restore
  built-in-only validation.
- **`PayrollService.resetDestinationValidationHook()`** — removes the
  registered hook and restores default validation.
- **`PayrollService.getDestinationValidationHook()`** — returns the currently
  registered hook, or `undefined` when built-in validation is active.
- **`service.validateDestination(value)` / `PayrollService.validateDestination(value)`**
  — pre-flight check that runs the full gate without submitting a payment.
  Returns `{ ok: true, destination, kind, state }` on success or
  `{ ok: false, code, message, state, retryable? }` on failure.

Result states: `validated` (passed all checks), `rejected` (failed a check),
`unavailable` (the hook itself failed — the gate fails closed and discards the
fault detail). Rejected destinations are never echoed in messages, errors,
progress events, or logs.

```typescript
PayrollService.setDestinationValidationHook((destination) =>
  isApprovedPayoutAccount(destination)
    ? { ok: true, kind: "internal_treasury" }
    : {
        ok: false,
        code: "COMPANY_DESTINATION_NOT_ALLOWED",
        message: "Destination is not on the approved payout list.",
      }
);

const gate = await PayrollService.validateDestination(recipient);
if (!gate.ok) {
  console.error(gate.code, gate.message); // safe to log
}
```

#### `evaluateFailedPayoutRetryEligibility(input): FailedPayoutRetryEligibility`

Checks whether an individual failed payout is safe to retry. The input includes its normalized transaction status, failure classification, attempt count, maximum attempts, and idempotency key. Retry is allowed only for a retryable failure while attempts remain and an idempotency key is present. The result provides a stable code and generic guidance; it never returns the key or reflects raw failure details.

### `PayrollContract`

Low-level wrapper for direct smart contract interactions.

### `SnarkjsProofGenerator`

Production-ready ZK proof generator using snarkjs library.

#### `constructor(config: ProofGeneratorConfig, cache?: CacheProvider<string>)`

Creates a new proof generator instance.

- **config**: Circuit artifact URLs and cache settings
- **cache**: Optional cache provider for proof results

#### `generateProof(witness: Record<string, unknown>): Promise<ProofPayload>`

Generates a Groth16 zero-knowledge proof.

- **witness**: Circuit inputs (must match circuit's input signal names)
- **Returns**: ProofPayload formatted for smart contract verification

#### `clearArtifactCache(): void`

Clears cached .wasm and .zkey files to force re-download.

### `ZKProofGenerator`

Legacy proof generator with factory methods for backward compatibility.

#### `static generateProof(witness: any, cache?: CacheProvider<string>): Promise<Uint8Array>`

**Deprecated**: Generates a simulated proof. Use `SnarkjsProofGenerator` for production.

#### `static createSnarkjsGenerator(config: ProofGeneratorConfig, cache?: CacheProvider<string>): SnarkjsProofGenerator`

Factory method to create a configured SnarkjsProofGenerator instance.

#### `static generateSnarkjsProof(witness: Record<string, unknown>, config: ProofGeneratorConfig, cache?: CacheProvider<string>): Promise<ProofPayload>`

Convenience method to generate a proof without creating a generator instance.

## Interfaces

### `ClientConfig`

- **networkUrl**: RPC URL for the Stellar network.
- **contractId**: ID of the deployed Payroll contract.

### `IProofGenerator`

Interface for zero-knowledge proof generation implementations.

#### `generateProof(witness: Record<string, unknown>): Promise<ProofPayload>`

Generates a zero-knowledge proof for the given witness data.

### `ProofGeneratorConfig`

Configuration for proof generation artifacts.

- **wasmUrl**: URL or path to the circuit .wasm file
- **zkeyUrl**: URL or path to the proving key .zkey file
- **artifactCacheTTL**: Optional cache TTL in seconds for proof results

### `ProofPayload`

Structured proof payload compatible with Solidity/Soroban verifiers.

```typescript
interface ProofPayload {
  proof: {
    pi_a: [string, string];
    pi_b: [[string, string], [string, string]];
    pi_c: [string, string];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
}
```

## Cache Providers

### `MemoryCacheProvider<T>`

In-memory cache implementation (lost on page reload).

#### `constructor()`

Creates a new memory cache instance.

### `LocalStorageCacheProvider`

Browser localStorage-based cache (persists across sessions).

#### `constructor(keyPrefix?: string)`

Creates a new localStorage cache with optional key prefix.

## Usage Examples

### Typed Client — PayrollRegistryClient

```typescript
import { rpc, Keypair } from "@stellar/stellar-sdk";
import { PayrollRegistryClient } from "@zk-payroll/sdk";

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const signer = Keypair.fromSecret("S...");

const registry = new PayrollRegistryClient(server, "CCONTRACT_ID...");

// Register a new employee
await registry.register(
  {
    employer: "GEMPLOYER...",
    employee: "GEMPLOYEE...",
    salary: 1000n,
    token: "CTOKEN...",
    metadata: "engineering",
  },
  signer
);

// Query
const entry = await registry.getRegistry("GEMPLOYER...", "GEMPLOYEE...", signer);
console.log(entry.active, entry.salary);

// Update salary
await registry.updateRegistry(
  {
    employer: "GEMPLOYER...",
    employee: "GEMPLOYEE...",
    salary: 2000n,
  },
  signer
);

// Paginated employee list
const employees = await registry.getEmployees("GEMPLOYER...", 0, 10, signer);

// Deactivate
await registry.deactivateRegistry("GEMPLOYER...", "GEMPLOYEE...", signer);
```

### Typed Client — SalaryCommitmentClient

```typescript
import { SalaryCommitmentClient } from "@zk-payroll/sdk";

const client = new SalaryCommitmentClient(server, "CCONTRACT_ID...");

// Commit to a salary
await client.commit(
  {
    employer: "GEMPLOYER...",
    employee: "GEMPLOYEE...",
    commitmentHash: "deadbeef...",
    cycleId: 1n,
  },
  signer
);

// Retrieve commitment
const commitment = await client.getCommitment("GEMPLOYER...", "GEMPLOYEE...", 1n, signer);

// Batch commit
await client.batchCommit(
  "GEMPLOYER...",
  [
    { employee: "G1...", commitmentHash: "abcd", cycleId: 1n },
    { employee: "G2...", commitmentHash: "ef01", cycleId: 1n },
  ],
  signer
);

// Reveal salary
await client.revealSalary("GEMPLOYER...", "GEMPLOYEE...", 1n, 1500n, signer);
```

### Typed Client — ProofVerifierClient

```typescript
import { ProofVerifierClient } from "@zk-payroll/sdk";

const client = new ProofVerifierClient(server, "CCONTRACT_ID...");

// Verify a proof
const valid = await client.verify(
  {
    pi_a: ["1", "2"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
    ],
    pi_c: ["7", "8"],
    publicSignals: ["sig"],
  },
  ["public_input"],
  1, // verification key ID
  signer
);

// Add verification key
const vkId = await client.addVerificationKey("aabbccdd...", "groth16 bn128", signer);

// Query key info
const info = await client.getVerificationKeyInfo(vkId, signer);

// Set as active
await client.setActiveVerificationKey(vkId, signer);
```

### Typed Client — PaymentExecutorClient

```typescript
import { PaymentExecutorClient } from "@zk-payroll/sdk";

const client = new PaymentExecutorClient(server, "CCONTRACT_ID...");

// Execute immediate payment
const execResult = await client.execute(
  {
    recipient: "GPAYEE...",
    amount: 1000n,
    asset: "CNATIVE...",
    memo: "monthly salary",
  },
  signer
);
console.log("TxHash:", execResult.txHash);

// Schedule payment
const scheduleResult = await client.schedule(
  {
    recipient: "GPAYEE...",
    amount: 500n,
    asset: "CNATIVE...",
    executeAt: Math.floor(Date.now() / 1000) + 86400,
    memo: "bonus",
  },
  signer
);

// Cancel scheduled payment
await client.cancel(scheduleResult.paymentId, signer);

// List pending payments
const pending = await client.getPendingPayments("GEMPLOYER...", 0n, 20, signer);
```

### Typed Client — AuditHoldClient

```typescript
import { AuditHoldClient } from "@zk-payroll/sdk";

const holds = new AuditHoldClient(server, "CCONTRACT_ID...");

// Check a hold's status before running payroll (fail closed on "unknown")
const hold = await holds.getAuditHoldStatus("hold-1", signer);

// Release a hold once compliance clears it — authorization is validated
// locally first, and the token is never surfaced in errors
const release = await holds.releaseAuditHold(
  {
    holdId: "hold-1",
    releasedBy: "GCOMPLIANCE_OFFICER...",
    authorizationToken: process.env.HOLD_RELEASE_TOKEN!,
    releaseReason: "KYC review completed",
  },
  signer
);
console.log(release.explanation); // safe to render in dashboards
```

### Basic Proof Generation

```typescript
import { SnarkjsProofGenerator, ProofGeneratorConfig } from "@zk-payroll/sdk";

const config: ProofGeneratorConfig = {
  wasmUrl: "https://cdn.example.com/circuit.wasm",
  zkeyUrl: "https://cdn.example.com/circuit.zkey",
  artifactCacheTTL: 86400,
};

const generator = new SnarkjsProofGenerator(config);

const witness = {
  recipient: "GDZQHV...",
  amount: 1000000n,
  nullifier: 123456789n,
  secret: 987654321n,
};

const proof = await generator.generateProof(witness);
```

### With Caching

```typescript
import { SnarkjsProofGenerator, MemoryCacheProvider } from "@zk-payroll/sdk";

const cache = new MemoryCacheProvider<string>();
const generator = new SnarkjsProofGenerator(config, cache);

// First call generates and caches
const proof1 = await generator.generateProof(witness);

// Second call returns cached result
const proof2 = await generator.generateProof(witness);
```

### Using Factory Methods

```typescript
import { ZKProofGenerator } from "@zk-payroll/sdk";

// Create generator
const generator = ZKProofGenerator.createSnarkjsGenerator(config, cache);

// Or generate directly
const proof = await ZKProofGenerator.generateSnarkjsProof(witness, config);
```

## Error Handling

All errors are wrapped in `ZkPayrollError` subclasses:

```typescript
import { PayrollError } from "@zk-payroll/sdk";

try {
  const proof = await generator.generateProof(witness);
} catch (error) {
  if (error instanceof PayrollError) {
    console.error(`Error ${error.code}: ${error.message}`);
  }
}
```

## Contract Metadata Discovery

The SDK provides helpers for discovering and validating deployed contract metadata across common Stellar environments, reducing manual wiring when connecting to testnet, mainnet, or local standalone networks.

### `getContractMetadata(environment, overrides?)`

Returns the default metadata for a known environment, with optional field overrides.

| Param         | Type                        | Description                                                    |
| ------------- | --------------------------- | -------------------------------------------------------------- |
| `environment` | `string`                    | Environment name (`"testnet"`, `"mainnet"`, or `"standalone"`) |
| `overrides`   | `Partial<ContractMetadata>` | Optional fields to merge on top of defaults                    |

**Throws** if the environment name is not recognized.

```typescript
import { getContractMetadata } from "@zk-payroll/sdk";

// Get testnet defaults
const metadata = getContractMetadata("testnet");
// {
//   networkUrl: "https://soroban-testnet.stellar.org",
//   networkPassphrase: "Test SDF Network ; September 2015",
// }

// Override with deployed contract IDs
const deployed = getContractMetadata("testnet", {
  payrollRegistryId: "CA3D5K7UZH7G4FZ...",
  salaryCommitmentId: "CB3D5K7UZH7G4FZ...",
  proofVerifierId: "CC3D5K7UZH7G4FZ...",
  paymentExecutorId: "CD3D5K7UZH7G4FZ...",
  adminPublicKey: "SAV75E2NK7Q5J2Y...",
});
```

### `validateContractMetadata(metadata)`

Validates a `ContractMetadata` object and returns a structured result with actionable errors.

| Param      | Type               | Description              |
| ---------- | ------------------ | ------------------------ |
| `metadata` | `ContractMetadata` | The metadata to validate |

Returns `{ valid: boolean, errors: MetadataValidationError[] }`. Each error has `field`, `message`, and `code` properties.

```typescript
import { validateContractMetadata } from "@zk-payroll/sdk";

const result = validateContractMetadata({
  networkUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  payrollRegistryId: "CA3D5K7UZH7G4FZ...",
});

if (!result.valid) {
  for (const err of result.errors) {
    console.error(`[${err.code}] ${err.field}: ${err.message}`);
  }
}
```

**Validation checks:**

- `networkUrl` is a valid HTTP(S) URL
- `networkPassphrase` matches a known Stellar network
- `payrollRegistryId`, `salaryCommitmentId`, `proofVerifierId`, `paymentExecutorId` are valid Soroban contract ID format (starts with `C`, 56 alphanumeric characters)
- `adminPublicKey` is a valid Stellar secret key format (starts with `S`, 56 characters)
- Required fields (`networkUrl`, `networkPassphrase`) are present and non-empty

### `isKnownEnvironment(environment)`

Returns `true` if the given environment name is recognized.

```typescript
import { isKnownEnvironment } from "@zk-payroll/sdk";

if (isKnownEnvironment(process.env.STELLAR_ENV)) {
  // proceed
}
```

### `listKnownEnvironments()`

Returns the list of known environment descriptors.

```typescript
import { listKnownEnvironments } from "@zk-payroll/sdk";

const envs = listKnownEnvironments();
// [
//   { name: "testnet",  label: "Stellar Testnet" },
//   { name: "mainnet",  label: "Stellar Mainnet" },
//   { name: "standalone", label: "Local Standalone" },
// ]
```

### `buildClientConfig(metadata)`

Extracts `networkUrl` and a contract IDs map from a metadata object, suitable for constructing typed contract clients.

```typescript
import {
  buildClientConfig,
  getContractMetadata,
  rpc,
  PayrollRegistryClient,
  Keypair,
} from "@zk-payroll/sdk";

const metadata = getContractMetadata("testnet", {
  payrollRegistryId: "CA3D5K7UZH7G4FZ...",
});

const config = buildClientConfig(metadata);
const server = new rpc.Server(config.networkUrl);
const signer = Keypair.fromSecret("SAV75E2NK7Q5J2Y...");

const registry = new PayrollRegistryClient(server, config.contractIds.payrollRegistryId);

await registry.getRegistry("GEMPLOYER...", "GEMPLOYEE...", signer);
```

### `ContractMetadata`

```typescript
interface ContractMetadata {
  networkUrl: string;
  networkPassphrase: string;
  payrollRegistryId?: string;
  salaryCommitmentId?: string;
  proofVerifierId?: string;
  paymentExecutorId?: string;
  adminPublicKey?: string;
}
```

### `KNOWN_ENVIRONMENTS`

A static array of `KnownEnvironment` entries defining the built-in network presets. Each entry has:

| Field      | Type               | Description                                                     |
| ---------- | ------------------ | --------------------------------------------------------------- |
| `name`     | `string`           | Machine-readable key (`"testnet"`, `"mainnet"`, `"standalone"`) |
| `label`    | `string`           | Human-readable label                                            |
| `metadata` | `ContractMetadata` | Default network settings                                        |

---

## See Also

- [ZK Proof Generation Guide](./ZK_PROOF_GENERATION.md) - Detailed implementation guide
- [README](../README.md) - Getting started and overview
