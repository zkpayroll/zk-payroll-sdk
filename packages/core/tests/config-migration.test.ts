import {
  migrateConfig,
  detectDeprecatedConfigFields,
  validateConfig,
  ConfigBuilder,
} from "../src/config";

const VALID_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("migrateConfig", () => {
  it("passes a current-schema config through unchanged with no warnings", () => {
    const current = {
      networkUrl: "https://soroban-testnet.stellar.org",
      contractId: VALID_CONTRACT,
    };

    const { config, warnings, migrated, validation } = migrateConfig(current);

    expect(warnings).toHaveLength(0);
    expect(migrated).toBe(false);
    expect(validation.isValid).toBe(true);
    expect(config.networkUrl).toBe(current.networkUrl);
    expect(config.contractId).toBe(VALID_CONTRACT);
  });

  it("remaps the deprecated nodeUrl field to networkUrl", () => {
    const legacy = {
      nodeUrl: "https://old.example.com",
      contractId: VALID_CONTRACT,
    };

    const { config, warnings, migrated } = migrateConfig(legacy);

    expect(migrated).toBe(true);
    expect(config.networkUrl).toBe("https://old.example.com");
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "nodeUrl",
          message: expect.stringContaining("networkUrl"),
        }),
      ])
    );
  });

  it("remaps adminSecret to adminKey", () => {
    const legacy = {
      networkUrl: "https://soroban-testnet.stellar.org",
      contractId: VALID_CONTRACT,
      adminSecret: "S_SECRET_VALUE",
    };

    const { config, warnings } = migrateConfig(legacy);

    expect(config.adminKey).toBe("S_SECRET_VALUE");
    expect(warnings.some((w) => w.field === "adminSecret")).toBe(true);
  });

  it("remaps contractAddress to contractId", () => {
    const legacy = {
      networkUrl: "https://soroban-testnet.stellar.org",
      contractAddress: VALID_CONTRACT,
    };

    const { config, warnings } = migrateConfig(legacy);

    expect(config.contractId).toBe(VALID_CONTRACT);
    expect(warnings.some((w) => w.field === "contractAddress")).toBe(true);
  });

  it("prefers an explicit current field over a legacy alias", () => {
    const legacy = {
      nodeUrl: "https://legacy.example.com",
      networkUrl: "https://current.example.com",
      contractId: VALID_CONTRACT,
    };

    const { config, warnings } = migrateConfig(legacy);

    expect(config.networkUrl).toBe("https://current.example.com");
    // nodeUrl is remapped, but networkUrl already set so it is ignored.
    expect(warnings.some((w) => w.field === "nodeUrl")).toBe(true);
    expect(config.networkUrl).not.toBe("https://legacy.example.com");
  });

  it("treats a lone rpcUrl as the primary endpoint (deprecated)", () => {
    const legacy = {
      rpcUrl: "https://rpc.example.com",
      contractId: VALID_CONTRACT,
    };

    const { config, warnings, migrated } = migrateConfig(legacy);

    expect(migrated).toBe(true);
    expect(config.networkUrl).toBe("https://rpc.example.com");
    expect(warnings.some((w) => w.field === "rpcUrl")).toBe(true);
  });

  it("carries through non-deprecated fields such as retryPolicy and featureFlags", () => {
    const legacy = {
      nodeUrl: "https://soroban-testnet.stellar.org",
      contractId: VALID_CONTRACT,
      retryPolicy: { maxAttempts: 3 },
      featureFlags: { fastProofs: true },
    };

    const { config } = migrateConfig(legacy);

    expect(config.retryPolicy).toEqual({ maxAttempts: 3 });
    expect(config.featureFlags).toEqual({ fastProofs: true });
  });

  it("produces a config that passes validation", () => {
    const legacy = {
      nodeUrl: "https://soroban-testnet.stellar.org",
      contractId: VALID_CONTRACT,
    };

    const { config, validation } = migrateConfig(legacy);

    expect(validation.isValid).toBe(true);
    expect(validateConfig(config).isValid).toBe(true);
  });
});

describe("detectDeprecatedConfigFields", () => {
  it("returns an empty list for a clean config", () => {
    const warnings = detectDeprecatedConfigFields({
      networkUrl: "https://soroban-testnet.stellar.org",
      contractId: VALID_CONTRACT,
    });
    expect(warnings).toHaveLength(0);
  });

  it("reports every deprecated field found", () => {
    const warnings = detectDeprecatedConfigFields({
      nodeUrl: "x",
      adminSecret: "y",
      contractAddress: "z",
      contractId: VALID_CONTRACT,
    });
    const fields = warnings.map((w) => w.field);
    expect(fields).toEqual(expect.arrayContaining(["nodeUrl", "adminSecret", "contractAddress"]));
  });

  it("reports no issues for a current config built via ConfigBuilder", () => {
    const config = new ConfigBuilder({
      networkUrl: "https://soroban-testnet.stellar.org",
      contractId: VALID_CONTRACT,
    }).build();
    const warnings = detectDeprecatedConfigFields({ ...config });
    expect(warnings).toHaveLength(0);
  });
});
