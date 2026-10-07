import {
  ConfigBuilder,
  ConfigPresets,
  ClientConfig,
  validateConfig,
  assertValidConfig,
} from "../src/config";
import { ValidationError } from "../src/errors";

describe("ConfigBuilder, validateConfig, and ConfigPresets", () => {
  const VALID_CONTRACT_ID =
    "CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC";
  const VALID_CONTRACT_ID_2 = VALID_CONTRACT_ID;
  it("should build a valid config", () => {
    const config = new ConfigBuilder()
      .withNetworkUrl("https://soroban-testnet.stellar.org")
      .withContractId(VALID_CONTRACT_ID)
      .build();

    expect(config.networkUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.contractId).toBe(VALID_CONTRACT_ID);
  });

  it("should support rpcUrl and network fields", () => {
    const config = new ConfigBuilder()
      .withRpcUrl("https://soroban-testnet.stellar.org")
      .withNetwork("testnet")
      .withContractId(VALID_CONTRACT_ID)
      .build();

    expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.network).toBe("testnet");
    expect(config.networkUrl).toBe("https://soroban-testnet.stellar.org");
  });

  it("should support multiple contractIds mapping", () => {
    const config = new ConfigBuilder()
      .withNetworkUrl("https://soroban-testnet.stellar.org")
      .withContractIds({
        payroll: VALID_CONTRACT_ID,
        token: VALID_CONTRACT_ID_2,
      })
      .build();

    expect(config.contractIds?.payroll).toBe(VALID_CONTRACT_ID);
    expect(config.contractIds?.token).toBe(VALID_CONTRACT_ID_2);
  });

  it("should fail validation if networkUrl is missing", () => {
    const builder = new ConfigBuilder().withContractId(VALID_CONTRACT_ID);

    expect(() => builder.build()).toThrow(ValidationError);
    expect(() => builder.build()).toThrow(
      "networkUrl (or rpcUrl) is required.",
    );
  });

  it("should fail validation if networkUrl is malformed", () => {
    const builder = new ConfigBuilder()
      .withNetworkUrl("not-a-valid-url")
      .withContractId(VALID_CONTRACT_ID);

    expect(() => builder.build()).toThrow("networkUrl is malformed");
  });

  it("should fail validation if networkUrl protocol is invalid", () => {
    const result = validateConfig({
      networkUrl: "ftp://soroban-testnet.stellar.org",
      contractId: VALID_CONTRACT_ID,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors[0].message).toContain(
      "must use http, https, ws, or wss protocol",
    );
  });

  it("should fail validation if network is invalid", () => {
    const result = validateConfig({
      networkUrl: "https://soroban-testnet.stellar.org",
      network: "   ",
      contractId: VALID_CONTRACT_ID,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "network")).toBe(true);
  });

  it("should fail validation if contractId is missing", () => {
    const builder = new ConfigBuilder().withNetworkUrl("http://localhost:8000");

    expect(() => builder.build()).toThrow(
      "contractId (or contractIds) is required.",
    );
  });

  it("should fail validation if contractId is malformed", () => {
    const builder = new ConfigBuilder()
      .withNetworkUrl("http://localhost:8000")
      .withContractId("invalid_contract_id");

    expect(() => builder.build()).toThrow("contractId is malformed");
  });

  it("should fail validation if entry in contractIds is malformed", () => {
    const result = validateConfig({
      networkUrl: "https://soroban-testnet.stellar.org",
      contractIds: {
        payroll: VALID_CONTRACT_ID,
        token: "bad_contract_id",
      },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "contractIds.token")).toBe(
      true,
    );
  });

  it("should fail validation if proofConfig is incomplete", () => {
    const builder = new ConfigBuilder()
      .withNetworkUrl("http://localhost:8000")
      .withContractId(
        "CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC",
      )
      .withProofConfig({ wasmUrl: "http://example.com/circuit.wasm" } as never);

    expect(() => builder.build()).toThrow("proofConfig.zkeyUrl is required.");
  });

  describe("validateConfig utility", () => {
    it("returns isValid = true for valid configuration", () => {
      const result = validateConfig({
        networkUrl: "https://soroban-testnet.stellar.org",
        contractId: VALID_CONTRACT_ID,
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns structured errors for missing config object", () => {
      const result = validateConfig(undefined);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe("config");
    });
  });

  describe("assertValidConfig utility", () => {
    it("returns normalized ClientConfig on valid input", () => {
      const config = assertValidConfig({
        networkUrl: "https://soroban-testnet.stellar.org",
        contractId: VALID_CONTRACT_ID,
      });

      expect(config.networkUrl).toBe("https://soroban-testnet.stellar.org");
      expect(config.contractId).toBe(VALID_CONTRACT_ID);
    });

    it("throws ValidationError with CONFIG_VALIDATION_ERROR code on invalid input", () => {
      try {
        assertValidConfig({ networkUrl: "invalid" });
        fail("Should have thrown ValidationError");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.code).toBe("CONFIG_VALIDATION_ERROR");
      }
    });
  });

  describe("FeatureFlagsConfig", () => {
    it("validates boolean feature flags", () => {
      const config = new ConfigBuilder()
        .withNetworkUrl("https://soroban-testnet.stellar.org")
        .withContractId(VALID_CONTRACT_ID)
        .withFeatureFlags({
          enableIdempotency: true,
          strictValidation: false,
        })
        .build();

      expect(config.featureFlags?.enableIdempotency).toBe(true);
      expect(config.featureFlags?.strictValidation).toBe(false);
    });

    it("fails validation if feature flag value is non-boolean", () => {
      const result = validateConfig({
        networkUrl: "https://soroban-testnet.stellar.org",
        contractId: VALID_CONTRACT_ID,
        featureFlags: {
          enableIdempotency: "yes" as any,
        },
      });

      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "featureFlags.enableIdempotency"),
      ).toBe(true);
    });
  });

  describe("Presets", () => {
    it("should initialize local preset correctly", () => {
      const config = ConfigPresets.local()
        .withContractId(VALID_CONTRACT_ID)
        .build();

      expect(config.networkUrl).toBe("http://localhost:8000");
      expect(config.network).toBe("localnet");
    });

    it("should initialize testnet preset correctly", () => {
      const config = ConfigPresets.testnet()
        .withContractId(VALID_CONTRACT_ID)
        .build();

      expect(config.networkUrl).toBe("https://soroban-testnet.stellar.org");
      expect(config.network).toBe("testnet");
    });

    it("should initialize production preset correctly", () => {
      const config = ConfigPresets.production()
        .withContractId(VALID_CONTRACT_ID)
        .build();

      expect(config.networkUrl).toBe("https://soroban-rpc.mainnet.stellar.org");
      expect(config.network).toBe("mainnet");
    });
  });

  describe("RetryPolicyConfig", () => {
    it("should allow configuring custom retry policy", () => {
      const config = new ConfigBuilder()
        .withNetworkUrl("https://soroban-testnet.stellar.org")
        .withContractId(VALID_CONTRACT_ID)
        .withRetryPolicy({
          maxAttempts: 5,
          initialDelayMs: 250,
          maxDelayMs: 5000,
          backoffFactor: 2,
        })
        .build();

      expect(config.retryPolicy).toBeDefined();
      expect(config.retryPolicy?.maxAttempts).toBe(5);
      expect(config.retryPolicy?.initialDelayMs).toBe(250);
    });

    it("should fail validation if maxAttempts is less than 1", () => {
      const builder = new ConfigBuilder()
        .withNetworkUrl("https://soroban-testnet.stellar.org")
        .withContractId(VALID_CONTRACT_ID)
        .withRetryPolicy({ maxAttempts: 0 });

      expect(() => builder.build()).toThrow(
        "retryPolicy.maxAttempts must be at least 1.",
      );
    });

    it("should fail validation if maxDelayMs is less than initialDelayMs", () => {
      const result = validateConfig({
        networkUrl: "https://soroban-testnet.stellar.org",
        contractId: VALID_CONTRACT_ID,
        retryPolicy: {
          initialDelayMs: 1000,
          maxDelayMs: 500,
        },
      });

      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "retryPolicy.maxDelayMs"),
      ).toBe(true);
    });

    it("should fail validation if backoffFactor is less than 1", () => {
      const result = validateConfig({
        networkUrl: "https://soroban-testnet.stellar.org",
        contractId: VALID_CONTRACT_ID,
        retryPolicy: {
          backoffFactor: 0.5,
        },
      });

      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "retryPolicy.backoffFactor"),
      ).toBe(true);
    });
  });
});
