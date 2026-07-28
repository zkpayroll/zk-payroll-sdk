# ZK Payroll SDK

TypeScript SDK for interacting with the ZK Payroll smart contracts.

## Installation

```bash
npm install @zk-payroll/sdk
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

### Configuration Validations

The `ConfigBuilder` fails fast if required configuration is missing or malformed:

```typescript
// Throws Error: "Configuration validation failed:\n- contractId is malformed: invalid_id"
ConfigPresets.testnet().withContractId("invalid_id").build();
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
  id: "CTOKEN_CORP123",
  symbol: "CORP",
  label: "Corp Company Token",
  decimals: 7,
});

const corp = AssetRegistry.getOrThrow("CTOKEN_CORP123");
parseAmount("500.00 CORP", corp); // 3_500_000_000n
```

### Canonical amount normalization

Before submitting any amount to a contract, batch builder, or commitment hash, normalize
it into the asset's canonical smallest-unit `bigint`. `normalizeCanonicalAmount` accepts
any of the loose shapes payroll data arrives in (`string`, `number`, `bigint`) and either
an asset id string (resolved via the registry) or an `AssetMetadata` object:

```typescript
import {
  normalizeCanonicalAmount,
  tryNormalizeCanonicalAmount,
  RoundingMode,
} from "@zk-payroll/sdk";

// Throwing variant — canonical { amount, decimals, assetSymbol, assetId, wasRounded, original }
const { amount, assetSymbol, wasRounded } = normalizeCanonicalAmount(
  "  $1,000.50 XLM  ", // formatted string with currency symbol + whitespace
  "native",             // asset id resolved via AssetRegistry
  { rounding: RoundingMode.HALF_UP }
);
// amount      => 10_005_000_000n (canonical stroops)
// assetSymbol => "XLM"
// wasRounded  => false  (input has 2 decimals, XLM has 7 — no rounding)

// bigint inputs are already canonical (matches formatAmount) — no double-scaling
normalizeCanonicalAmount(10_005_000_000n, "native").amount; // 10_005_000_000n

// Non-throwing variant — discriminated { ok, value | error }
const result = tryNormalizeCanonicalAmount(input, "USDC");
if (!result.ok) {
  console.warn(result.error.code, result.error.message);
} else {
  submit(result.value.amount);
}
```

Use `normalizeCanonicalAmount` instead of manually scaling strings, so submissions always
carry the canonical precision the contract expects.

See the [Multi-Asset Guide](./docs/MULTI_ASSET.md) for the full API reference, isolation
patterns for tests, and rules for extending the registry in production.

## Documentation

- [Runtime Support Matrix](./docs/SUPPORT_MATRIX.md) - Supported Node.js and browser versions
- [Browser and Backend Usage](#browser-and-backend-usage) - Where to run the SDK, wallets, proofs, and secrets
- [Payload Normalization](./docs/PAYLOAD_NORMALIZATION.md) - Canonicalizing payroll payloads before validation
- [API Reference](./docs/API.md) - Complete API documentation
- [Error Handling](./docs/ERRORS.md) - Public error hierarchy and recovery patterns
- [ZK Proof Generation](./docs/ZK_PROOF_GENERATION.md) - Detailed proof generation guide
- [Versioning & Compatibility](./docs/VERSIONING.md) - SDK semantic versioning and contract compatibility matrix
- [SDK Migration Cookbook](./docs/SDK_MIGRATION_COOKBOOK.md) - Step-by-step upgrade checklist and migration patterns
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
