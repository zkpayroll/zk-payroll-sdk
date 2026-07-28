import { ConfigBuilder, ConfigPresets, ClientConfig } from "../src/config";

describe("ConfigBuilder and ConfigPresets", () => {
  it("should build a valid config", () => {
    const config = new ConfigBuilder()
      .withNetworkUrl("https://soroban-testnet.stellar.org")
      .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
      .build();

    expect(config.networkUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.contractId).toBe("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC");
  });

  it("should fail validation if networkUrl is missing", () => {
    const builder = new ConfigBuilder().withContractId(
      "CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC"
    );

    expect(() => builder.build()).toThrow("networkUrl is required.");
  });

  it("should fail validation if networkUrl is malformed", () => {
    const builder = new ConfigBuilder()
      .withNetworkUrl("not-a-valid-url")
      .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC");

    expect(() => builder.build()).toThrow("networkUrl is malformed");
  });

  it("should fail validation if contractId is missing", () => {
    const builder = new ConfigBuilder().withNetworkUrl("http://localhost:8000");

    expect(() => builder.build()).toThrow("contractId is required.");
  });

  it("should fail validation if contractId is malformed", () => {
    const builder = new ConfigBuilder()
      .withNetworkUrl("http://localhost:8000")
      .withContractId("invalid_contract_id");

    expect(() => builder.build()).toThrow("contractId is malformed");
  });

  it("should fail validation if proofConfig is incomplete", () => {
    const builder = new ConfigBuilder()
      .withNetworkUrl("http://localhost:8000")
      .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
      .withProofConfig({ wasmUrl: "http://example.com/circuit.wasm" } as any);

    expect(() => builder.build()).toThrow("proofConfig.zkeyUrl is required.");
  });

  describe("Presets", () => {
    it("should initialize local preset correctly", () => {
      const config = ConfigPresets.local()
        .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
        .build();

      expect(config.networkUrl).toBe("http://localhost:8000");
    });

    it("should initialize testnet preset correctly", () => {
      const config = ConfigPresets.testnet()
        .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
        .build();

      expect(config.networkUrl).toBe("https://soroban-testnet.stellar.org");
    });

    it("should initialize production preset correctly", () => {
      const config = ConfigPresets.production()
        .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
        .build();

      expect(config.networkUrl).toBe("https://soroban-rpc.mainnet.stellar.org");
    });
  });

  describe("RetryPolicyConfig", () => {
    it("should allow configuring custom retry policy", () => {
      const config = new ConfigBuilder()
        .withNetworkUrl("https://soroban-testnet.stellar.org")
        .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
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
        .withContractId("CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC")
        .withRetryPolicy({ maxAttempts: 0 });

      expect(() => builder.build()).toThrow("retryPolicy.maxAttempts must be at least 1.");
    });
  });
});
