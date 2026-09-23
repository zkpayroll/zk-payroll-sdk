# Payroll Setup Checklist

`generateSetupChecklist` produces a structured integration checklist so new
integrators can confirm their **configuration, network, contracts, treasury,
proofs, wallet, and test fixtures** are in place *before* running payroll.

The generator is synchronous and purely static. Runtime observations (RPC
reachability, contract deployment, network passphrase, treasury funding, wallet
state) are supplied as options — typically collected once with
`validateEnvironment` and the wallet adapter — and are folded into
the relevant checks.

## Quick Start

```typescript
import {
  PayrollService,
  ConfigPresets,
  validateEnvironment,
  generateSetupChecklist,
} from "@zk-payroll/sdk";

const config = ConfigPresets.testnet()
  .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
  .withProofConfig({
    wasmUrl: "https://cdn.example.com/payroll_circuit.wasm",
    zkeyUrl: "https://cdn.example.com/payroll_circuit.zkey",
  })
  .build();

// 1. Probe the live environment (optional but recommended).
const sanity = await validateEnvironment(config);
const networkPassphrase = sanity.diagnostics.find((d) => d.component === "rpc")?.details?.networkPassphrase;

// 2. Generate the checklist, folding runtime observations in.
const checklist = generateSetupChecklist(config, {
  expectedNetworkPassphrase: "Test SDF Network ; September 2015",
  rpcReachable: sanity.isValid,
  networkPassphrase,
  contractDeployed: sanity.diagnostics.some((d) => d.component === "contract" && d.status === "success"),
  treasury: {
    treasuryAddress: "G...",
    funded: true,
  },
  wallet: {
    name: "Freighter",
    isAvailable: true,
    isConnected: true,
    network: "testnet",
  },
  testFixturesAvailable: true,
});

// 3. Block on failures, surface warnings, and proceed when ready.
if (!checklist.isReady) {
  for (const blocker of checklist.blockers) {
    console.error(`[${blocker.category}] ${blocker.message} → ${blocker.remediation}`);
  }
  throw new Error("Payroll setup checklist has blockers; resolve them before running payroll.");
}
for (const warning of checklist.warnings) {
  console.warn(`[${warning.category}] ${warning.message}`);
}
```

## Single-Category Checklists

Use `generateCategoryChecklist(category, config, options)` to check one category
at a time:

```typescript
import { generateCategoryChecklist } from "@zk-payroll/sdk";

const proofs = generateCategoryChecklist("proofs", config);
for (const check of proofs.checks) {
  console.log(`${check.status.toUpperCase()} - ${check.label}: ${check.message}`);
}
```

Categories: `config`, `network`, `contracts`, `treasury`, `proofs`, `wallet`,
`test-fixtures`.

## Statuses

| Status | Meaning |
|--------|---------|
| `pass` | The check succeeded; nothing to do. |
| `warn` | Non-blocking but should be reviewed (e.g. runtime verification not performed, wallet not connected). |
| `fail` | Blocking; `isReady` becomes `false` and the item appears in `blockers`. |

## Result Shape

```typescript
interface SetupChecklistResult {
  generatedAt: number;      // UTC epoch ms
  checks: SetupCheckItem[]; // every check, in stable category order
  isReady: boolean;         // false when any check has status "fail"
  blockers: SetupCheckItem[]; // checks with status "fail"
  warnings: SetupCheckItem[]; // checks with status "warn"
}
```

Each `SetupCheckItem` exposes `id`, `category`, `label`, `status`, `message`,
and an optional `remediation` with actionable guidance.

## Options

| Option | Description |
|--------|-------------|
| `expectedNetworkPassphrase` | Passphrase expected for the configured network (used to cross-check the RPC). |
| `rpcReachable` | Runtime result of probing the RPC endpoint (from `validateEnvironment`). |
| `networkPassphrase` | Passphrase returned by the RPC endpoint (from `validateEnvironment`). |
| `contractDeployed` | Runtime result of the on-chain contract deployment check (from `validateEnvironment`). |
| `treasury` | `{ treasuryAddress?, fundingTokenContractId?, funded? }` — treasury account and funding token. |
| `wallet` | `{ id?, name?, isAvailable?, isConnected?, network?, publicKey? }` — wallet adapter state. |
| `testFixturesAvailable` | Whether `MockContractEnvironment` / `MockPayrollContract` import in your environment. |

## Privacy

The generator never includes private payroll values (admin keys, salaries, or
amounts) in messages. Wallet public keys are redacted (e.g. `GAAA…HWHF`). Only
public identifiers (contract IDs, treasury addresses) and presence/shape details
are reported, so results are safe to log or display.
