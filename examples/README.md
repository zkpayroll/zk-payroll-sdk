# Examples

Runnable examples for the ZK Payroll SDK. Each example is self-contained and
uses the mock environment by default so it works without a live network.

## Prerequisites

- Node.js >= 20, npm >= 10
- From the repo root: `npm install`
- Optional for live network examples: configure `.env` at the repo root (see table below)

## Environment Variables

Examples read the same variables as the SDK. For offline/mocked examples no
variables are required. For live examples set:

| Variable | Purpose |
|---|---|
| `STELLAR_RPC_URL` / `SOROBAN_RPC_URL` | Soroban RPC URL (default: testnet) |
| `PAYROLL_CONTRACT_ID` / `CONTRACT_ID` | Live contract address (`C...`) |
| `WASM_URL` / `ZKEY_URL` | Circuit artifacts for real proof generation |
| `SIGNER_SECRET` | Secret key for signing (local dev only – never log it) |
| `STELLAR_NETWORK` | `testnet` (default) or `mainnet` |

See [docs/setup.md](../docs/setup.md) for the full table and `.env.example`.

## Setup

```bash
# From repository root
npm install
cp .env.example .env   # then edit with your values for live examples
npm run build          # builds packages/core
```

## Running Examples

### Mocked payroll flow (offline, no env needed)

```bash
npx ts-node examples/mocked-payroll.ts
```

`examples/mocked-payroll.ts` demonstrates:

```typescript
import { MockContractEnvironment, MockPayrollContract } from "@zk-payroll/core/testing";

const env = new MockContractEnvironment();
env.expectInvoke("private_pay").toReturn("tx_mock_123");

const contract = new MockPayrollContract(env);
const hash = await contract.deposit(1000n);
console.log("tx:", hash);
```

### Typed clients

```bash
npx ts-node examples/typed-clients.ts
```

Shows `PayrollRegistryClient`, `SalaryCommitmentClient`, `ProofVerifierClient`, and
`PaymentExecutorClient` with mocked `rpc.Server`.

### Asset normalization

```typescript
import { normalizeAssetSymbol, normalizeSupportedAssets } from "@zk-payroll/core/assets";

normalizeAssetSymbol("  usdc  "); // => "USDC"
normalizeSupportedAssets(["usdc", { symbol: "xlm", contractId: null }]);
// => [{ symbol: "USDC", ... }, { symbol: "XLM", ... }]
```

### Missing-proof error handling

```typescript
import { isMissingProofError, getMissingProofRemediation } from "@zk-payroll/core/proofs/errors";

try {
  await generator.generateProof(badWitness);
} catch (error) {
  if (isMissingProofError(error)) {
    console.error(getMissingProofRemediation(error));
    // Remediation is actionable and never includes recipient/amount.
  }
}
```

### Proof generation (requires artifacts)

```bash
WASM_URL=./artifacts/payroll_circuit.wasm ZKEY_URL=./artifacts/payroll_circuit.zkey npx ts-node examples/proof-generation.ts
```

## Available Examples

| Example | File | Network |
|---|---|---|
| Mocked payroll | `mocked-payroll.ts` | offline |
| Typed clients | `typed-clients.ts` | offline (mocked RPC) |
| Proof generation | `proof-generation.ts` | offline or live artifacts |
| Batch payments | `batch-payments.ts` | offline |

## Local Commands for Examples

```bash
# Lint/format examples
npm run lint -w packages/core
npm run format

# Run all mocked examples in one go
npm run test -- examples
```

## Privacy Reminder

Examples intentionally use synthetic addresses (`G...`, `C...`) and
small amounts (`100n`). Real recipient addresses and salary amounts must
never be written to logs, files, or telemetry. Use `redactSensitive`
when logging context objects.

## Troubleshooting

- `PAYROLL_CONTRACT_ID not set` – set it in `.env` or pass it explicitly to the client constructor.
- `Failed to fetch .wasm / .zkey` – verify `WASM_URL` / `ZKEY_URL` and CORS.
- `MISSING_PROOF` – call `generateProof` first; check `isMissingProofError` for remediation.
