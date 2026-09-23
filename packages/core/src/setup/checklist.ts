/**
 * Payroll setup checklist generator.
 *
 * {@link generateSetupChecklist} produces a structured integration checklist so
 * new integrators can confirm their configuration, network, contracts,
 * treasury, proofs, wallet, and test fixtures are ready *before* running
 * payroll. {@link generateCategoryChecklist} generates a single category.
 *
 * The generator is synchronous and performs static validation only. Runtime
 * observations (RPC reachability, contract deployment, passphrase, funding,
 * wallet state) can be supplied via {@link SetupChecklistOptions} — typically
 * collected once with `validateEnvironment` and the wallet adapter — and are
 * folded into the relevant checks.
 *
 * Security: no private payroll values (admin keys, salaries, amounts) are ever
 * echoed into messages. Wallet public keys are redacted. Only public
 * identifiers (contract IDs, treasury addresses) and presence/shape details are
 * reported, so the result is safe to log or display.
 *
 * @module
 */

import { validateConfig } from "../config";
import type { ClientConfig } from "../config";
import type { WalletNetwork } from "../wallets";
import type {
  SetupCheckCategory,
  SetupCheckItem,
  SetupChecklistOptions,
  SetupChecklistResult,
} from "./types";

let StrKeyModule: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  StrKeyModule = require("@stellar/stellar-sdk")?.StrKey;
} catch {
  // fallback for environments without stellar-sdk in node_modules
}

/** Returns true when a value is a well-formed Soroban contract ID. */
function isValidContractId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  try {
    if (StrKeyModule && typeof StrKeyModule.isValidContract === "function") {
      return StrKeyModule.isValidContract(id);
    }
  } catch {
    // fallback to Soroban contract ID regex pattern
  }
  return /^C[A-Z2-7]{55}$/.test(id);
}

/** Returns true when a value is a well-formed Stellar account (G...) address. */
function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  try {
    if (StrKeyModule && typeof StrKeyModule.isValidEd25519PublicKey === "function") {
      return StrKeyModule.isValidEd25519PublicKey(address);
    }
  } catch {
    // fallback to Stellar account ID regex pattern
  }
  return /^G[A-Z2-7]{55}$/.test(address);
}

/** Redacts a wallet public key so it never appears in full in messages. */
function redactPublicKey(publicKey: string | null | undefined): string {
  if (!publicKey) return "<none>";
  if (publicKey.length <= 8) return "****";
  return `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
}

/** Matches a wallet network against the SDK target network. */
function matchWalletNetwork(
  configNetwork: string | undefined,
  walletNetwork: WalletNetwork | null | undefined
): "pass" | "warn" | "fail" {
  if (!configNetwork || !walletNetwork) return "warn";
  const norm = configNetwork.toLowerCase();
  if (norm === "testnet") return walletNetwork === "testnet" ? "pass" : "fail";
  if (norm === "mainnet") return walletNetwork === "public" ? "pass" : "fail";
  if (norm === "localnet") return walletNetwork === "testnet" ? "warn" : "fail";
  return "warn";
}

function buildConfigChecks(
  config: Partial<ClientConfig> | undefined,
  _options: SetupChecklistOptions
): SetupCheckItem[] {
  const checks: SetupCheckItem[] = [];

  if (!config) {
    checks.push({
      id: "config-present",
      category: "config",
      label: "SDK configuration present",
      status: "fail",
      message: "No SDK configuration object was provided.",
      remediation:
        "Create a ClientConfig (e.g. via ConfigBuilder or ConfigPresets) and pass it to generateSetupChecklist.",
    });
    return checks;
  }

  const validation = validateConfig(config);
  // Proof artifact fields are validated under the "proofs" category instead so
  // the source-object form (wasmSource/zkeySource) is also recognized.
  const relevantErrors = validation.errors.filter((e) => !e.field.startsWith("proofConfig."));

  if (relevantErrors.length === 0) {
    checks.push({
      id: "config-valid",
      category: "config",
      label: "SDK configuration valid",
      status: "pass",
      message:
        "Configuration passed static validation (network URL, network name, contract ID(s), retry policy, feature flags).",
    });
    return checks;
  }

  for (const error of relevantErrors) {
    checks.push({
      id: `config-${error.field}`,
      category: "config",
      label: `Configuration field: ${error.field}`,
      status: "fail",
      message: error.message,
      remediation: `Fix config.${error.field} and re-run the checklist.`,
    });
  }

  return checks;
}

function buildNetworkChecks(
  config: Partial<ClientConfig> | undefined,
  options: SetupChecklistOptions
): SetupCheckItem[] {
  const checks: SetupCheckItem[] = [];
  const effectiveUrl = config?.rpcUrl || config?.networkUrl;

  if (!effectiveUrl || effectiveUrl.trim() === "") {
    checks.push({
      id: "network-url",
      category: "network",
      label: "Network RPC URL configured",
      status: "fail",
      message: "Network (RPC) URL is not configured.",
      remediation:
        "Set config.networkUrl or config.rpcUrl (e.g. via ConfigPresets.testnet() or ConfigPresets.production()).",
    });
  } else {
    try {
      const parsedUrl = new URL(effectiveUrl);
      if (["http:", "https:", "ws:", "wss:"].includes(parsedUrl.protocol)) {
        checks.push({
          id: "network-url",
          category: "network",
          label: "Network RPC URL configured",
          status: "pass",
          message: "Network URL is a well-formed HTTP(S) or WebSocket endpoint.",
        });
      } else {
        checks.push({
          id: "network-url",
          category: "network",
          label: "Network RPC URL configured",
          status: "fail",
          message: "Network URL must use the http, https, ws, or wss protocol.",
          remediation: "Provide a valid Soroban RPC endpoint URL.",
        });
      }
    } catch {
      checks.push({
        id: "network-url",
        category: "network",
        label: "Network RPC URL configured",
        status: "fail",
        message: "Network URL is malformed.",
        remediation: "Provide a valid Soroban RPC endpoint URL.",
      });
    }
  }

  if (config?.network) {
    checks.push({
      id: "network-name",
      category: "network",
      label: "Network name set",
      status: "pass",
      message: `Network name is set to "${config.network}".`,
    });
  } else {
    checks.push({
      id: "network-name",
      category: "network",
      label: "Network name set",
      status: "warn",
      message: "Network name is not set; the RPC endpoint will determine the network.",
      remediation: "Set config.network to 'testnet', 'mainnet', or 'localnet'.",
    });
  }

  if (options.rpcReachable === true) {
    checks.push({
      id: "network-rpc-reachable",
      category: "network",
      label: "RPC endpoint reachable",
      status: "pass",
      message: "RPC endpoint was reached successfully during verification.",
    });
  } else if (options.rpcReachable === false) {
    checks.push({
      id: "network-rpc-reachable",
      category: "network",
      label: "RPC endpoint reachable",
      status: "fail",
      message: "RPC endpoint was not reachable during verification.",
      remediation:
        "Confirm the RPC URL and network connectivity, then re-run validateEnvironment(config).",
    });
  } else {
    checks.push({
      id: "network-rpc-reachable",
      category: "network",
      label: "RPC endpoint reachable",
      status: "warn",
      message: "RPC reachability was not verified.",
      remediation: "Call validateEnvironment(config) and pass the result via options.rpcReachable.",
    });
  }

  if (options.networkPassphrase && options.expectedNetworkPassphrase) {
    if (options.networkPassphrase === options.expectedNetworkPassphrase) {
      checks.push({
        id: "network-passphrase",
        category: "network",
        label: "Network passphrase matches",
        status: "pass",
        message: "Network passphrase matches the expected passphrase for this environment.",
      });
    } else {
      checks.push({
        id: "network-passphrase",
        category: "network",
        label: "Network passphrase matches",
        status: "fail",
        message: "Network passphrase does not match the expected passphrase.",
        remediation:
          "Ensure the RPC endpoint belongs to the intended network (testnet vs mainnet).",
      });
    }
  } else {
    checks.push({
      id: "network-passphrase",
      category: "network",
      label: "Network passphrase matches",
      status: "warn",
      message: "Network passphrase was not cross-checked.",
      remediation:
        "Provide options.expectedNetworkPassphrase and options.networkPassphrase (returned by validateEnvironment) to confirm the correct network.",
    });
  }

  return checks;
}

function buildContractsChecks(
  config: Partial<ClientConfig> | undefined,
  options: SetupChecklistOptions
): SetupCheckItem[] {
  const checks: SetupCheckItem[] = [];
  const primaryId =
    config?.contractId || (config?.contractIds ? Object.values(config.contractIds)[0] : undefined);

  if (!primaryId || primaryId.trim() === "") {
    checks.push({
      id: "contract-id",
      category: "contracts",
      label: "Contract ID configured",
      status: "fail",
      message: "No contract ID is configured.",
      remediation:
        "Set config.contractId (or config.contractIds) to the deployed payroll contract ID.",
    });
  } else {
    if (isValidContractId(primaryId)) {
      checks.push({
        id: "contract-id",
        category: "contracts",
        label: "Contract ID configured",
        status: "pass",
        message: "Primary contract ID is in a valid Stellar contract format.",
      });
    } else {
      checks.push({
        id: "contract-id",
        category: "contracts",
        label: "Contract ID configured",
        status: "fail",
        message: "Primary contract ID is not a valid Stellar contract ID.",
        remediation: "Provide a valid Soroban contract ID (starts with 'C').",
      });
    }

    if (options.contractDeployed === true) {
      checks.push({
        id: "contract-deployed",
        category: "contracts",
        label: "Contract deployed on-chain",
        status: "pass",
        message: "Primary contract is deployed and accessible on-chain.",
      });
    } else if (options.contractDeployed === false) {
      checks.push({
        id: "contract-deployed",
        category: "contracts",
        label: "Contract deployed on-chain",
        status: "fail",
        message: "Primary contract was not found on-chain during verification.",
        remediation: "Deploy the payroll contracts to the target network or fix the contract ID.",
      });
    } else {
      checks.push({
        id: "contract-deployed",
        category: "contracts",
        label: "Contract deployed on-chain",
        status: "warn",
        message: "Contract deployment was not verified on-chain.",
        remediation: "Call validateEnvironment(config) to confirm the contract is deployed.",
      });
    }
  }

  const contractIdsMap = config?.contractIds;
  if (contractIdsMap && Object.keys(contractIdsMap).length > 0) {
    const invalidKeys = Object.entries(contractIdsMap)
      .filter(([, id]) => !isValidContractId(id))
      .map(([key]) => key);
    if (invalidKeys.length === 0) {
      checks.push({
        id: "contract-ids-map",
        category: "contracts",
        label: "Multi-contract map valid",
        status: "pass",
        message: "All configured contract IDs (contractIds) are valid.",
      });
    } else {
      checks.push({
        id: "contract-ids-map",
        category: "contracts",
        label: "Multi-contract map valid",
        status: "fail",
        message: `Invalid contract ID(s) in contractIds: ${invalidKeys.join(", ")}.`,
        remediation: "Replace each listed key with a valid Soroban contract ID.",
      });
    }
  }

  return checks;
}

function buildTreasuryChecks(
  _config: Partial<ClientConfig> | undefined,
  options: SetupChecklistOptions
): SetupCheckItem[] {
  const checks: SetupCheckItem[] = [];
  const treasury = options.treasury;

  if (treasury?.treasuryAddress) {
    if (isValidStellarAddress(treasury.treasuryAddress)) {
      checks.push({
        id: "treasury-address",
        category: "treasury",
        label: "Treasury address valid",
        status: "pass",
        message: "Treasury address is a valid Stellar account address.",
      });
    } else {
      checks.push({
        id: "treasury-address",
        category: "treasury",
        label: "Treasury address valid",
        status: "fail",
        message: "Treasury address is not a valid Stellar account address.",
        remediation: "Provide a valid G... public key for the treasury/employer account.",
      });
    }
  } else {
    checks.push({
      id: "treasury-address",
      category: "treasury",
      label: "Treasury address valid",
      status: "warn",
      message: "Treasury address was not provided.",
      remediation:
        "Confirm which Stellar account funds and signs payroll submissions, then pass it via options.treasury.treasuryAddress.",
    });
  }

  if (treasury?.funded === true) {
    checks.push({
      id: "treasury-funded",
      category: "treasury",
      label: "Treasury funded",
      status: "pass",
      message: "Treasury account is funded on the target network.",
    });
  } else if (treasury?.funded === false) {
    checks.push({
      id: "treasury-funded",
      category: "treasury",
      label: "Treasury funded",
      status: "fail",
      message: "Treasury account is not funded on the target network.",
      remediation:
        "Fund the treasury account with XLM (and the payroll token) to cover fees and payroll amounts.",
    });
  } else {
    checks.push({
      id: "treasury-funded",
      category: "treasury",
      label: "Treasury funded",
      status: "warn",
      message: "Treasury funding was not verified.",
      remediation:
        "Confirm the treasury account holds sufficient XLM and token balance for the first payroll run.",
    });
  }

  if (treasury?.fundingTokenContractId) {
    if (isValidContractId(treasury.fundingTokenContractId)) {
      checks.push({
        id: "treasury-funding-token",
        category: "treasury",
        label: "Funding token configured",
        status: "pass",
        message: "Funding token contract ID is valid.",
      });
    } else {
      checks.push({
        id: "treasury-funding-token",
        category: "treasury",
        label: "Funding token configured",
        status: "fail",
        message: "Funding token contract ID is not valid.",
        remediation: "Provide a valid Soroban token contract ID (starts with 'C').",
      });
    }
  } else {
    checks.push({
      id: "treasury-funding-token",
      category: "treasury",
      label: "Funding token configured",
      status: "warn",
      message: "No funding token contract ID provided; payroll will assume native XLM.",
      remediation:
        "If payroll uses a custom token, pass its contract ID via options.treasury.fundingTokenContractId.",
    });
  }

  return checks;
}

/** Resolves the effective wasm/zkey location from a proof config, honoring sources. */
function resolveArtifactLocation(
  proofConfig: ClientConfig["proofConfig"],
  kind: "wasm" | "zkey"
): string | undefined {
  const source = kind === "wasm" ? proofConfig?.wasmSource : proofConfig?.zkeySource;
  if (source) {
    return source.type === "local" ? source.path : source.url;
  }
  return kind === "wasm" ? proofConfig?.wasmUrl : proofConfig?.zkeyUrl;
}

function buildProofsChecks(
  config: Partial<ClientConfig> | undefined,
  _options: SetupChecklistOptions
): SetupCheckItem[] {
  const checks: SetupCheckItem[] = [];
  const proofConfig = config?.proofConfig;

  if (!proofConfig) {
    checks.push({
      id: "proof-config",
      category: "proofs",
      label: "ZK proof configuration provided",
      status: "warn",
      message: "ZK proof configuration is not provided.",
      remediation:
        "Add proofConfig with .wasm and .zkey circuit artifacts to enable private payroll proofs.",
    });
    return checks;
  }

  checks.push({
    id: "proof-config",
    category: "proofs",
    label: "ZK proof configuration provided",
    status: "pass",
    message: "ZK proof configuration is provided.",
  });

  const wasmLocation = resolveArtifactLocation(proofConfig, "wasm");
  const zkeyLocation = resolveArtifactLocation(proofConfig, "zkey");
  const missing: string[] = [];
  if (!wasmLocation || wasmLocation.trim() === "") missing.push("wasm");
  if (!zkeyLocation || zkeyLocation.trim() === "") missing.push("zkey");

  if (missing.length === 0) {
    checks.push({
      id: "proof-artifacts",
      category: "proofs",
      label: "Circuit artifacts configured",
      status: "pass",
      message: "Both .wasm and .zkey circuit artifacts are configured.",
    });
  } else {
    checks.push({
      id: "proof-artifacts",
      category: "proofs",
      label: "Circuit artifacts configured",
      status: "fail",
      message: `Missing circuit artifact(s): ${missing.join(", ")}.`,
      remediation:
        "Point proofConfig.wasmUrl/wasmSource and zkeyUrl/zkeySource at valid .wasm and .zkey artifacts.",
    });
    return checks;
  }

  const malformed: string[] = [];
  const artifactPairs: Array<[string, string]> = [
    ["wasm", wasmLocation ?? ""],
    ["zkey", zkeyLocation ?? ""],
  ];
  for (const [kind, location] of artifactPairs) {
    if (/^https?:\/\//i.test(location)) {
      try {
        new URL(location);
      } catch {
        malformed.push(kind);
      }
    } else if (!location.toLowerCase().endsWith(`.${kind}`) || /\s/.test(location)) {
      malformed.push(`${kind} (path)`);
    }
  }

  if (malformed.length === 0) {
    checks.push({
      id: "proof-artifact-locations",
      category: "proofs",
      label: "Artifact locations well-formed",
      status: "pass",
      message: "Circuit artifact locations are well-formed (HTTP(S) URLs or local paths).",
    });
  } else {
    checks.push({
      id: "proof-artifact-locations",
      category: "proofs",
      label: "Artifact locations well-formed",
      status: "fail",
      message: `Artifact location issue(s): ${malformed.join(", ")}.`,
      remediation: "Use well-formed HTTP(S) URLs or local .wasm/.zkey file paths.",
    });
  }

  return checks;
}

function buildWalletChecks(
  config: Partial<ClientConfig> | undefined,
  options: SetupChecklistOptions
): SetupCheckItem[] {
  const checks: SetupCheckItem[] = [];
  const wallet = options.wallet;

  if (!wallet) {
    checks.push({
      id: "wallet-adapter",
      category: "wallet",
      label: "Wallet adapter configured",
      status: "warn",
      message: "No wallet adapter was provided for inspection.",
      remediation:
        "Pass options.wallet (e.g. a FreighterAdapter or AlbedoAdapter state) to verify wallet readiness.",
    });
    return checks;
  }

  const walletName = wallet.name || wallet.id || "wallet adapter";

  checks.push({
    id: "wallet-adapter",
    category: "wallet",
    label: "Wallet adapter configured",
    status: "pass",
    message: `Wallet adapter "${walletName}" is configured.`,
  });

  if (wallet.isAvailable === true) {
    checks.push({
      id: "wallet-available",
      category: "wallet",
      label: "Wallet available in environment",
      status: "pass",
      message: `"${walletName}" is available in this environment.`,
    });
  } else if (wallet.isAvailable === false) {
    checks.push({
      id: "wallet-available",
      category: "wallet",
      label: "Wallet available in environment",
      status: "fail",
      message: `"${walletName}" is not available in this environment.`,
      remediation:
        "Install/enable the wallet provider (e.g. the Freighter or Albedo browser extension).",
    });
  } else {
    checks.push({
      id: "wallet-available",
      category: "wallet",
      label: "Wallet available in environment",
      status: "warn",
      message: `Availability of "${walletName}" was not verified.`,
    });
  }

  if (wallet.isConnected === true) {
    const account = redactPublicKey(wallet.publicKey);
    checks.push({
      id: "wallet-connected",
      category: "wallet",
      label: "Wallet connected",
      status: "pass",
      message: `Wallet is connected${wallet.publicKey ? ` (account ${account})` : ""}.`,
    });
  } else if (wallet.isConnected === false) {
    checks.push({
      id: "wallet-connected",
      category: "wallet",
      label: "Wallet connected",
      status: "warn",
      message: "Wallet is not connected yet.",
      remediation: "Connect the wallet before submitting payroll transactions.",
    });
  } else {
    checks.push({
      id: "wallet-connected",
      category: "wallet",
      label: "Wallet connected",
      status: "warn",
      message: "Wallet connection state was not provided.",
    });
  }

  if (wallet.network) {
    const match = matchWalletNetwork(config?.network, wallet.network);
    if (match === "pass") {
      checks.push({
        id: "wallet-network-match",
        category: "wallet",
        label: "Wallet network matches SDK",
        status: "pass",
        message: "Wallet network matches the SDK target network.",
      });
    } else if (match === "warn") {
      checks.push({
        id: "wallet-network-match",
        category: "wallet",
        label: "Wallet network matches SDK",
        status: "warn",
        message: "Wallet is on testnet while the SDK targets a local/unknown network.",
        remediation: "Confirm the wallet is pointed at the same network as the SDK.",
      });
    } else {
      checks.push({
        id: "wallet-network-match",
        category: "wallet",
        label: "Wallet network matches SDK",
        status: "fail",
        message: "Wallet network does not match the SDK target network.",
        remediation: "Switch the wallet to the same network as the SDK (testnet or mainnet).",
      });
    }
  } else {
    checks.push({
      id: "wallet-network-match",
      category: "wallet",
      label: "Wallet network matches SDK",
      status: "warn",
      message: "Wallet network was not provided.",
    });
  }

  return checks;
}

function buildTestFixturesChecks(
  _config: Partial<ClientConfig> | undefined,
  options: SetupChecklistOptions
): SetupCheckItem[] {
  const checks: SetupCheckItem[] = [];

  if (options.testFixturesAvailable === true) {
    checks.push({
      id: "test-fixtures-available",
      category: "test-fixtures",
      label: "Testing fixtures available",
      status: "pass",
      message:
        "SDK testing fixtures (MockContractEnvironment, MockPayrollContract) are available for local integration tests.",
    });
  } else if (options.testFixturesAvailable === false) {
    checks.push({
      id: "test-fixtures-available",
      category: "test-fixtures",
      label: "Testing fixtures available",
      status: "fail",
      message: "SDK testing fixtures are not importable in this environment.",
      remediation:
        "Run local integration tests in an environment where the SDK testing utilities can be imported.",
    });
  } else {
    checks.push({
      id: "test-fixtures-available",
      category: "test-fixtures",
      label: "Testing fixtures available",
      status: "warn",
      message: "Testing fixture availability was not verified.",
      remediation:
        "Confirm MockContractEnvironment imports work in your test environment (see docs/TESTING.md).",
    });
  }

  return checks;
}

type ChecklistBuilder = (
  config: Partial<ClientConfig> | undefined,
  options: SetupChecklistOptions
) => SetupCheckItem[];

const CATEGORY_BUILDERS: Record<SetupCheckCategory, ChecklistBuilder> = {
  config: buildConfigChecks,
  network: buildNetworkChecks,
  contracts: buildContractsChecks,
  treasury: buildTreasuryChecks,
  proofs: buildProofsChecks,
  wallet: buildWalletChecks,
  "test-fixtures": buildTestFixturesChecks,
};

function aggregate(checks: SetupCheckItem[]): SetupChecklistResult {
  const blockers = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  return {
    generatedAt: Date.now(),
    checks,
    isReady: blockers.length === 0,
    blockers,
    warnings,
  };
}

/**
 * Generates a payroll setup checklist for a single category.
 *
 * @param category - The category to check.
 * @param config - The SDK configuration (can be partial).
 * @param options - Runtime observations and optional inputs to fold into checks.
 * @returns A structured checklist for the requested category.
 */
export function generateCategoryChecklist(
  category: SetupCheckCategory,
  config?: Partial<ClientConfig>,
  options: SetupChecklistOptions = {}
): SetupChecklistResult {
  return aggregate(CATEGORY_BUILDERS[category](config, options));
}

/**
 * Generates a complete payroll integration checklist covering config, network,
 * contracts, treasury, proofs, wallet, and test fixtures.
 *
 * @example
 * ```typescript
 * const config = ConfigPresets.testnet()
 *   .withContractId("CCONTRACT...")
 *   .withProofConfig({ wasmUrl, zkeyUrl })
 *   .build();
 *
 * const checklist = generateSetupChecklist(config, {
 *   expectedNetworkPassphrase: "Test SDF Network ; September 2015",
 *   rpcReachable: true,
 *   networkPassphrase: "Test SDF Network ; September 2015",
 *   contractDeployed: true,
 *   treasury: { treasuryAddress: "G...", funded: true },
 *   wallet: { name: "Freighter", isAvailable: true, isConnected: true, network: "testnet" },
 *   testFixturesAvailable: true,
 * });
 *
 * if (!checklist.isReady) {
 *   for (const blocker of checklist.blockers) {
 *     console.error(`[${blocker.category}] ${blocker.message} → ${blocker.remediation}`);
 *   }
 * }
 * ```
 *
 * @param config - The SDK configuration (can be partial).
 * @param options - Runtime observations and optional inputs to fold into checks.
 * @returns A structured checklist across all categories.
 */
export function generateSetupChecklist(
  config?: Partial<ClientConfig>,
  options: SetupChecklistOptions = {}
): SetupChecklistResult {
  const categories = Object.keys(CATEGORY_BUILDERS) as SetupCheckCategory[];
  const checks = categories.flatMap((category) => CATEGORY_BUILDERS[category](config, options));
  return aggregate(checks);
}
