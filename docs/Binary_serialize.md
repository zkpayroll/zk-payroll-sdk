# ZK Payroll SDK

TypeScript SDK for interacting with the ZK Payroll smart contracts.

## Installation

```bash
npm install @zk-payroll/sdk
```

## Usage

```typescript
import { PayrollService, DEFAULT_CONFIG } from "@zk-payroll/sdk";

// Initialize service
const service = new PayrollService(DEFAULT_CONFIG);

// Process a private payment
await service.processPayment(
  "G...", // Recipient Stellar address
  1000n   // Amount
);
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

- **Typed Contract Clients**: Fully typed client wrappers for PayrollRegistry, SalaryCommitment, ProofVerifier, and PaymentExecutor contracts.
- **ZK Proof Generation**: Client-side proof generation using snarkjs for privacy.
- **Caching**: Built-in caching for proofs and circuit artifacts.
- **Error Handling**: Robust error typing and management.
- **Mock Testing Environment**: Comprehensive testing utilities for unit tests without a live network.

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

## Documentation

- [API Reference](./docs/API.md) - Complete API documentation
- [ZK Proof Generation](./docs/ZK_PROOF_GENERATION.md) - Detailed proof generation guide
- [Binary Serialization](./docs/BINARY_SERIALIZATION.md) - Binary-safe wire format for proof and commitment payloads
- [Troubleshooting](./docs/TROUBLESHOOTING.md) - Solutions for common CI, dependency, and environment issues

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

> Having trouble? See the [Troubleshooting Guide](./docs/TROUBLESHOOTING.md).
