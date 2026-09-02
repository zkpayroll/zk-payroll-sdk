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
