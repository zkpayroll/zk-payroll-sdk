# Setup Guide

This guide covers the environment variables and local setup commands needed for
contributors, SDK users, and auditors working with the ZK Payroll SDK.

## Prerequisites

- **Node.js** >= 20.x (`node -v`)
- **npm** >= 10.x (`npm -v`)
- **Git**
- A Stellar Testnet account and Friendbot access for live contract tests (optional)
- Circuit artifacts (`.wasm` + `.zkey`) for proof generation tests (optional – mocks work offline)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/your-org/zk-payroll-sdk.git
cd zk-payroll-sdk

# 2. Install
npm install

# 3. Configure environment (optional for mocked tests)
cp .env.example .env
# Edit .env – see table below

# 4. Build & verify
npm run build
npm run typecheck
npm run lint
npm test
```

For the `packages/core` package directly:

```bash
npm run build -w packages/core
npm run test -w packages/core
npm run lint -w packages/core
npm run typecheck -w packages/core
```

### Using a Clean Install

```bash
npm ci            # reproducible install from lockfile
npm run build
npm test
```

## Environment Variables

All variables can be set in a `.env` file at the repository root or exported
in your shell. Values shown are defaults used when a variable is unset.

| Variable | Required | Default | Description |
|---|---|---|---|
| `STELLAR_RPC_URL` | No | `https://soroban-testnet.stellar.org` | Soroban RPC URL. Alias: `SOROBAN_RPC_URL` |
| `PAYROLL_CONTRACT_ID` | For live network calls | `""` | Payroll contract `C...` address. Alias: `CONTRACT_ID` |
| `REGISTRY_CONTRACT_ID` | No | — | PayrollRegistry contract `C...` |
| `SALARY_COMMITMENT_CONTRACT_ID` | No | — | SalaryCommitment contract `C...` |
| `PROOF_VERIFIER_CONTRACT_ID` | No | — | ProofVerifier contract `C...` |
| `PAYMENT_EXECUTOR_CONTRACT_ID` | No | — | PaymentExecutor contract `C...` |
| `WASM_URL` | For real proofs | — | Path or HTTPS URL to `payroll_circuit.wasm` |
| `ZKEY_URL` | For real proofs | — | Path or HTTPS URL to `payroll_circuit.zkey` |
| `STELLAR_NETWORK` | No | `testnet` | `testnet` / `mainnet` / `futurenet`; maps to `Networks.TESTNET` / `Networks.PUBLIC` |
| `NETWORK_PASSPHRASE` | No | testnet passphrase | Full network passphrase (overrides `STELLAR_NETWORK` if set) |
| `SIGNER_SECRET` | No | — | Secret key (`S...`) for local signing. Alias: `STELLAR_SECRET_KEY`, `ADMIN_SECRET` |
| `ARTIFACT_CACHE_TTL` | No | `86400` | Seconds to cache downloaded `.wasm`/`.zkey` artifacts |

### `.env.example`

```bash
# Copy to .env and fill in your values
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
PAYROLL_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
REGISTRY_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SALARY_COMMITMENT_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PROOF_VERIFIER_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PAYMENT_EXECUTOR_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Circuit artifacts – local path or CDN URL
WASM_URL=./artifacts/payroll_circuit.wasm
ZKEY_URL=./artifacts/payroll_circuit.zkey
ARTIFACT_CACHE_TTL=86400

# Network
STELLAR_NETWORK=testnet
# NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Local signer – never commit this
SIGNER_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Notes

- Variables are **not required** for mocked unit tests – `MockContractEnvironment` and
  `MemoryCacheProvider` run fully offline.
- For CI, set variables as encrypted secrets, not committed files.
- The SDK reads variables at runtime via your application code (e.g. in
  `config.ts` helpers), not at build time, so changing `.env` does not require
  a rebuild.

## Local Setup Commands

| Command | Purpose |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run build` | Build `@zk-payroll/core` (runs `tsc` in `packages/core`) |
| `npm test` | Run Jest suite across packages |
| `npm run test -w packages/core -- --watch` | Watch mode for `packages/core` |
| `npm run lint` | ESLint across `src` and `tests` |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Prettier format |
| `npm run typecheck` | `tsc --noEmit` type checking |
| `npm run docs:build` | Typedoc API docs (`packages/core/docs`) |
| `npm run bundle:measure` | Bundle size report (`packages/core/scripts/measure-bundle.js`) |

### Pre-commit Hooks

Husky runs `lint` + `typecheck` on commit. Bypass only for WIP commits:

```bash
git commit --no-verify -m "WIP"
```

### Workspace Commands (Turbo)

```bash
npx turbo run build --filter=@zk-payroll/core
npx turbo run test --filter=@zk-payroll/core
```

## Privacy & Security Checklist

- [ ] No payroll-sensitive values (`recipient`, `amount`, `witness`, `privateKey`, `adminKey`) appear in logs, exports, telemetry, events, or UI state. The SDK's `redactSensitive` replaces them with `[redacted]`.
- [ ] `SIGNER_SECRET` / `STELLAR_SECRET_KEY` is never printed, committed, or sent to telemetry.
- [ ] Circuit artifacts are fetched over HTTPS.
- [ ] Contract IDs in `.env` are per-environment; production IDs never ship in the client bundle.

Verify with:

```bash
npm test -- logging.test.ts
grep -R "recipient\|amount" --include="*.ts" packages/core/src/logging/
```

Logs should contain only event names (`payment_start`, `proof_cache_hit`, etc.) and
non-sensitive context like `txHash`, `method`, or `cacheKey` hashes.

## Troubleshooting

### `Failed to fetch .wasm file`

- Check `WASM_URL` is reachable: `curl -I $WASM_URL`
- Verify CORS headers if the URL is cross-origin.
- Increase timeout for large files or use a local path for dev.

### `Failed to fetch .zkey file`

- `.zkey` can be 5–50 MB; ensure stable connectivity and try `ARTIFACT_CACHE_TTL=0` to bypass stale cache during dev.
- Use `SnarkjsProofGenerator.clearArtifactCache()` when the circuit changes.

### `Simulation failed` / `Contract reverted`

- Confirm contract IDs match the targeted network (testnet vs mainnet).
- Fund the signer via Friendbot on testnet: `https://friendbot.stellar.org/?addr=G...`
- Check `STELLAR_RPC_URL` points at the same network as the contract.

### Husky / Lint Failures

```bash
npm run lint:fix
npm run format
```

### `proof not found` / `MISSING_PROOF`

- Generate a proof first: `await new SnarkjsProofGenerator({ wasmUrl, zkeyUrl }).generateProof(witness)`
- Call `await generator.preload()` on app start to warm the artifact cache.
- Use `isMissingProofError(error)` and `getMissingProofRemediation(error)` for actionable UI messages.

## QA Steps

After any asset, proof, or setup change, verify:

1. **Success path:** mocked proof generation + `processPayment` returns `txHash` and `publicSignals`.
2. **Failure path:** missing proof error is detected by `isMissingProofError` and remediation is shown.
3. **Edge case:** whitespace/casing in asset symbols (`"  usdc  "` → `"USDC"`) normalizes correctly; empty or non-string symbols throw `ValidationError`.

## Related Docs

- [API Reference](./API.md)
- [ZK Proof Generation](./ZK_PROOF_GENERATION.md)
- [Testing Guide](./TESTING.md)
- [Examples](../examples/README.md)
