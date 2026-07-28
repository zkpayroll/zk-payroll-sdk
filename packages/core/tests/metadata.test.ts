import { StrKey } from "@stellar/stellar-sdk";
import {
  getContractMetadata,
  isKnownEnvironment,
  listKnownEnvironments,
  validateContractMetadata,
  buildClientConfig,
  KNOWN_ENVIRONMENTS,
} from "../src/metadata";
import { MetadataErrorCode } from "../src/metadata/types";

const VALID_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

describe("Contract Metadata Discovery", () => {
  describe("getContractMetadata", () => {
    it("returns testnet metadata", () => {
      const metadata = getContractMetadata("testnet");

      expect(metadata.networkUrl).toBe("https://soroban-testnet.stellar.org");
      expect(metadata.networkPassphrase).toBe("Test SDF Network ; September 2015");
    });

    it("returns mainnet metadata", () => {
      const metadata = getContractMetadata("mainnet");

      expect(metadata.networkUrl).toBe("https://soroban.stellar.org");
      expect(metadata.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
    });

    it("returns standalone metadata", () => {
      const metadata = getContractMetadata("standalone");

      expect(metadata.networkUrl).toBe("http://localhost:8000/soroban/rpc");
      expect(metadata.networkPassphrase).toBe("Standalone Network ; February 2017");
    });

    it("merges overrides into environment defaults", () => {
      const metadata = getContractMetadata("testnet", {
        payrollRegistryId: "CA3D5K7UZH7G4FZ5Q6XJ2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S",
        adminPublicKey: "SAV75E2NK7Q5J2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S1T",
      });

      expect(metadata.networkUrl).toBe("https://soroban-testnet.stellar.org");
      expect(metadata.payrollRegistryId).toBe(
        "CA3D5K7UZH7G4FZ5Q6XJ2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S"
      );
      expect(metadata.adminPublicKey).toBe("SAV75E2NK7Q5J2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S1T");
    });

    it("throws for unknown environment", () => {
      expect(() => getContractMetadata("unknown")).toThrow('Unknown environment "unknown"');
    });
  });

  describe("isKnownEnvironment", () => {
    it("returns true for known environments", () => {
      expect(isKnownEnvironment("testnet")).toBe(true);
      expect(isKnownEnvironment("mainnet")).toBe(true);
      expect(isKnownEnvironment("standalone")).toBe(true);
    });

    it("returns false for unknown environment", () => {
      expect(isKnownEnvironment("unknown")).toBe(false);
      expect(isKnownEnvironment("")).toBe(false);
    });
  });

  describe("listKnownEnvironments", () => {
    it("returns all known environments", () => {
      const envs = listKnownEnvironments();

      expect(envs).toHaveLength(3);
      expect(envs.map((e) => e.name)).toEqual(
        expect.arrayContaining(["testnet", "mainnet", "standalone"])
      );
    });

    it("includes human-readable labels", () => {
      const envs = listKnownEnvironments();
      const testnet = envs.find((e) => e.name === "testnet");

      expect(testnet?.label).toBe("Stellar Testnet");
    });
  });

  describe("validateContractMetadata", () => {
    it("passes valid metadata", () => {
      const result = validateContractMetadata({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        payrollRegistryId: VALID_CONTRACT_ID,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects missing required fields", () => {
      const result = validateContractMetadata({
        networkUrl: "",
        networkPassphrase: "",
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.field === "networkUrl")).toBe(true);
      expect(result.errors.some((e) => e.field === "networkPassphrase")).toBe(true);
    });

    it("rejects invalid network URL", () => {
      const result = validateContractMetadata({
        networkUrl: "not-a-url",
        networkPassphrase: "Test SDF Network ; September 2015",
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe(MetadataErrorCode.INVALID_NETWORK_URL);
    });

    it("rejects unrecognized network passphrase", () => {
      const result = validateContractMetadata({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Fake Network",
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe(MetadataErrorCode.INVALID_NETWORK_PASSPHRASE);
    });

    it("rejects invalid contract ID format", () => {
      const result = validateContractMetadata({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        payrollRegistryId: "invalid-id",
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe(MetadataErrorCode.INVALID_CONTRACT_ID);
    });

    it("accepts valid contract ID format", () => {
      const result = validateContractMetadata({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        payrollRegistryId: VALID_CONTRACT_ID,
      });

      expect(result.valid).toBe(true);
    });

    it("rejects invalid admin secret key", () => {
      const result = validateContractMetadata({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        adminPublicKey: "not-a-secret",
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe(MetadataErrorCode.INVALID_ADMIN_KEY);
    });

    it("returns multiple errors for composite validation failures", () => {
      const result = validateContractMetadata({
        networkUrl: "bad",
        networkPassphrase: "Unknown",
        payrollRegistryId: "bad-id",
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("buildClientConfig", () => {
    it("extracts networkUrl and contract IDs from metadata", () => {
      const config = buildClientConfig({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        payrollRegistryId: "CA3D5K7UZH7G4FZ5Q6XJ2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S",
        salaryCommitmentId: "CB3D5K7UZH7G4FZ5Q6XJ2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S",
        proofVerifierId: "CC3D5K7UZH7G4FZ5Q6XJ2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S",
        paymentExecutorId: "CD3D5K7UZH7G4FZ5Q6XJ2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S",
      });

      expect(config.networkUrl).toBe("https://soroban-testnet.stellar.org");
      expect(config.contractIds.payrollRegistryId).toBeDefined();
      expect(config.contractIds.salaryCommitmentId).toBeDefined();
      expect(config.contractIds.proofVerifierId).toBeDefined();
      expect(config.contractIds.paymentExecutorId).toBeDefined();
    });

    it("omits undefined contract IDs", () => {
      const config = buildClientConfig({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        payrollRegistryId: "CA3D5K7UZH7G4FZ5Q6XJ2Y3A4B5C6D7E8F9G0H1J2K3L4M5N6O7P8Q9R0S",
      });

      expect(Object.keys(config.contractIds)).toHaveLength(1);
      expect(config.contractIds.payrollRegistryId).toBeDefined();
    });
  });

  describe("KNOWN_ENVIRONMENTS", () => {
    it("defines testnet, mainnet, and standalone", () => {
      const names = KNOWN_ENVIRONMENTS.map((e) => e.name);
      expect(names).toContain("testnet");
      expect(names).toContain("mainnet");
      expect(names).toContain("standalone");
    });

    it("each environment has networkUrl and networkPassphrase", () => {
      for (const env of KNOWN_ENVIRONMENTS) {
        expect(env.metadata.networkUrl).toBeTruthy();
        expect(env.metadata.networkPassphrase).toBeTruthy();
      }
    });
  });
});
