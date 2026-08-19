import {
  generateSetupChecklist,
  generateCategoryChecklist,
  SetupChecklistResult,
  SetupCheckCategory,
} from "../src/setup";
import { StrKey } from "@stellar/stellar-sdk";

const validContractId = StrKey.encodeContract(Buffer.alloc(32, 1));
const validAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const validConfig = {
  networkUrl: "https://soroban-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  network: "testnet",
  contractId: validContractId,
  proofConfig: {
    wasmUrl: "https://example.com/payroll_circuit.wasm",
    zkeyUrl: "https://example.com/payroll_circuit.zkey",
  },
};

const validOptions = {
  expectedNetworkPassphrase: "Test SDF Network ; September 2015",
  rpcReachable: true,
  networkPassphrase: "Test SDF Network ; September 2015",
  contractDeployed: true,
  treasury: {
    treasuryAddress: validAddress,
    fundingTokenContractId: validContractId,
    funded: true,
  },
  wallet: {
    id: "freighter",
    name: "Freighter",
    isAvailable: true,
    isConnected: true,
    network: "testnet" as const,
    publicKey: validAddress,
  },
  testFixturesAvailable: true,
};

function check(result: SetupChecklistResult, id: string) {
  const item = result.checks.find((c) => c.id === id);
  if (!item) throw new Error(`Missing check: ${id}`);
  return item;
}

describe("generateSetupChecklist", () => {
  it("produces a ready checklist for a fully valid setup", () => {
    const result = generateSetupChecklist(validConfig, validOptions);

    expect(result.isReady).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);

    const categories = new Set(result.checks.map((c) => c.category));
    expect(categories).toEqual(
      new Set<SetupCheckCategory>([
        "config",
        "network",
        "contracts",
        "treasury",
        "proofs",
        "wallet",
        "test-fixtures",
      ])
    );
  });

  it("fails with an actionable blocker when the config object is missing", () => {
    const result = generateSetupChecklist(undefined, {});

    expect(result.isReady).toBe(false);
    expect(result.blockers.some((b) => b.id === "config-present")).toBe(true);
    expect(result.blockers[0].remediation).toBeTruthy();
  });

  it("fails when required config fields are invalid", () => {
    const result = generateSetupChecklist({
      networkUrl: "not-a-url",
      contractId: "invalid_id",
    });

    expect(result.isReady).toBe(false);
    const blockers = result.blockers.map((b) => b.id);
    expect(blockers).toContain("config-networkUrl");
    expect(blockers).toContain("config-contractId");
  });

  it("fails when the RPC endpoint is reported unreachable", () => {
    const result = generateSetupChecklist(validConfig, {
      ...validOptions,
      rpcReachable: false,
    });

    expect(check(result, "network-rpc-reachable").status).toBe("fail");
    expect(result.isReady).toBe(false);
  });

  it("fails when the network passphrase does not match", () => {
    const result = generateSetupChecklist(validConfig, {
      ...validOptions,
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });

    expect(check(result, "network-passphrase").status).toBe("fail");
  });

  it("fails when the contract is reported not deployed", () => {
    const result = generateSetupChecklist(validConfig, {
      ...validOptions,
      contractDeployed: false,
    });

    expect(check(result, "contract-deployed").status).toBe("fail");
  });

  it("fails on an invalid treasury address and unverified funding", () => {
    const result = generateSetupChecklist(validConfig, {
      ...validOptions,
      treasury: { ...validOptions.treasury, treasuryAddress: "not-an-address" },
    });

    expect(check(result, "treasury-address").status).toBe("fail");
  });

  it("warns (not fails) when proof config is missing", () => {
    const { proofConfig: _omitted, ...configWithoutProofs } = validConfig;
    const result = generateSetupChecklist(configWithoutProofs, validOptions);

    expect(check(result, "proof-config").status).toBe("warn");
    // Missing proofs are a warning, not a hard blocker for the full checklist.
    expect(result.isReady).toBe(true);
  });

  it("passes artifacts when configured via local source objects (edge case)", () => {
    const result = generateSetupChecklist(
      {
        ...validConfig,
        proofConfig: {
          wasmUrl: "",
          zkeyUrl: "",
          wasmSource: { type: "local", path: "./circuits/payroll_circuit.wasm" },
          zkeySource: { type: "local", path: "./circuits/payroll_circuit.zkey" },
        },
      },
      validOptions
    );

    expect(check(result, "proof-artifacts").status).toBe("pass");
    expect(check(result, "proof-artifact-locations").status).toBe("pass");
  });

  it("fails when an artifact location is malformed", () => {
    const result = generateSetupChecklist(
      {
        ...validConfig,
        proofConfig: {
          wasmUrl: "https://example.com/payroll_circuit.wasm",
          zkeyUrl: "https://exa mple.com/payroll_circuit.zkey",
        },
      },
      validOptions
    );

    expect(check(result, "proof-artifact-locations").status).toBe("fail");
  });

  it("fails when the wallet network does not match the SDK network", () => {
    const result = generateSetupChecklist(validConfig, {
      ...validOptions,
      wallet: { ...validOptions.wallet, network: "public" },
    });

    expect(check(result, "wallet-network-match").status).toBe("fail");
  });

  it("fails when the wallet adapter is not available", () => {
    const result = generateSetupChecklist(validConfig, {
      ...validOptions,
      wallet: { ...validOptions.wallet, isAvailable: false },
    });

    expect(check(result, "wallet-available").status).toBe("fail");
  });

  it("warns when a wallet adapter is not provided", () => {
    const result = generateSetupChecklist(validConfig, {
      ...validOptions,
      wallet: undefined,
    });

    expect(check(result, "wallet-adapter").status).toBe("warn");
    expect(result.isReady).toBe(true);
  });

  it("warns for unverified runtime observations", () => {
    const result = generateSetupChecklist(validConfig, {});

    expect(result.warnings.some((w) => w.id === "network-rpc-reachable")).toBe(true);
    expect(result.warnings.some((w) => w.id === "contract-deployed")).toBe(true);
    expect(result.warnings.some((w) => w.id === "test-fixtures-available")).toBe(true);
  });

  it("fails when test fixtures are reported unavailable", () => {
    const result = generateSetupChecklist(validConfig, {
      ...validOptions,
      testFixturesAvailable: false,
    });

    expect(check(result, "test-fixtures-available").status).toBe("fail");
  });

  it("never echoes private payroll values in messages", () => {
    const result = generateSetupChecklist(
      { ...validConfig, adminKey: "SVERYSECRETPRIVATEKEYVALUE" },
      validOptions
    );

    const serialized = JSON.stringify(result.checks);
    expect(serialized).not.toContain("SVERYSECRETPRIVATEKEYVALUE");
  });

  it("redacts wallet public keys in messages", () => {
    const result = generateSetupChecklist(validConfig, validOptions);

    const walletMessage = check(result, "wallet-connected").message;
    expect(walletMessage).not.toContain(validAddress);
    expect(walletMessage).toContain("…");
  });

  it("supports generating a single category", () => {
    const result = generateCategoryChecklist("proofs", validConfig, validOptions);

    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks.every((c) => c.category === "proofs")).toBe(true);
  });

  it("supports generating the config category from an empty config", () => {
    const result = generateCategoryChecklist("config", {}, {});

    // networkUrl is required -> fail
    expect(result.isReady).toBe(false);
    expect(result.blockers.some((b) => b.id === "config-networkUrl")).toBe(true);
  });
});
