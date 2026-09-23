import { StrKey } from "@stellar/stellar-sdk";
import {
  getContractMetadata,
  isKnownEnvironment,
  listKnownEnvironments,
  validateContractMetadata,
  resolveNetworkProfile,
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

    it("returns futurenet metadata", () => {
      const metadata = getContractMetadata("futurenet");

      expect(metadata.networkUrl).toBe("https://rpc-futurenet.stellar.org");
      expect(metadata.networkPassphrase).toBe("Test SDF Future Network ; October 2022");
      expect(metadata.explorerUrl).toBe("https://stellar.expert/explorer/futurenet");
    });

    it("returns localnet metadata identical to standalone", () => {
      const localnet = getContractMetadata("localnet");
      const standalone = getContractMetadata("standalone");

      expect(localnet.networkUrl).toBe(standalone.networkUrl);
      expect(localnet.networkPassphrase).toBe(standalone.networkPassphrase);
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

      expect(envs).toHaveLength(5);
      expect(envs.map((e) => e.name)).toEqual(
        expect.arrayContaining(["testnet", "futurenet", "mainnet", "standalone", "localnet"])
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

    it("rejects invalid explorer URL", () => {
      const result = validateContractMetadata({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        explorerUrl: "not-a-url",
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === MetadataErrorCode.INVALID_EXPLORER_URL)).toBe(
        true
      );
    });

    it("accepts a valid explorer URL", () => {
      const result = validateContractMetadata({
        networkUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        explorerUrl: "https://stellar.expert/explorer/testnet",
      });

      expect(result.valid).toBe(true);
    });

    it("still rejects an unrecognized passphrase by default (requireKnownPassphrase defaults true)", () => {
      const result = validateContractMetadata({
        networkUrl: "https://example.com/rpc",
        networkPassphrase: "Some Custom Passphrase",
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe(MetadataErrorCode.INVALID_NETWORK_PASSPHRASE);
    });

    it("allows an unrecognized passphrase when requireKnownPassphrase is false", () => {
      const result = validateContractMetadata(
        {
          networkUrl: "https://example.com/rpc",
          networkPassphrase: "Some Custom Passphrase",
        },
        { requireKnownPassphrase: false }
      );

      expect(result.valid).toBe(true);
    });
  });

  describe("resolveNetworkProfile", () => {
    it("resolves a known environment name (testnet)", () => {
      const profile = resolveNetworkProfile("testnet");
      expect(profile.networkUrl).toBe("https://soroban-testnet.stellar.org");
      expect(profile.networkPassphrase).toBe("Test SDF Network ; September 2015");
    });

    it("resolves a known environment name (mainnet)", () => {
      const profile = resolveNetworkProfile("mainnet");
      expect(profile.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
    });

    it("resolves a known environment name (futurenet)", () => {
      const profile = resolveNetworkProfile("futurenet");
      expect(profile.networkPassphrase).toBe("Test SDF Future Network ; October 2022");
    });

    it("resolves a known environment name (localnet)", () => {
      const profile = resolveNetworkProfile("localnet");
      expect(profile.networkUrl).toBe("http://localhost:8000/soroban/rpc");
    });

    it("resolves the same profile consistently across repeated calls", () => {
      const first = resolveNetworkProfile("testnet");
      const second = resolveNetworkProfile("testnet");
      expect(first).toEqual(second);
    });

    it("throws a clear error for an unknown environment name", () => {
      expect(() => resolveNetworkProfile("nonexistent")).toThrow(
        'Unknown environment "nonexistent"'
      );
    });

    it("resolves a well-formed custom profile object", () => {
      const custom = {
        networkUrl: "https://my-private-node.example.com/rpc",
        networkPassphrase: "My Private Network ; 2026",
        payrollRegistryId: VALID_CONTRACT_ID,
        explorerUrl: "https://explorer.example.com",
      };

      const profile = resolveNetworkProfile(custom);
      expect(profile).toEqual(custom);
    });

    it("accepts a custom profile whose passphrase is not in the known list", () => {
      // This is the whole point of "custom": a private network's passphrase
      // will never match testnet/mainnet/futurenet/standalone.
      const custom = {
        networkUrl: "http://localhost:9000/rpc",
        networkPassphrase: "Totally Custom Network ; 2026",
      };

      expect(() => resolveNetworkProfile(custom)).not.toThrow();
    });

    it("throws with details for a custom profile missing required fields", () => {
      const malformed = {
        networkUrl: "",
        networkPassphrase: "",
      };

      expect(() => resolveNetworkProfile(malformed)).toThrow(/networkUrl is required/);
      expect(() => resolveNetworkProfile(malformed)).toThrow(/networkPassphrase is required/);
    });

    it("throws with details for a custom profile with an invalid network URL", () => {
      const malformed = {
        networkUrl: "not-a-url",
        networkPassphrase: "Custom Network",
      };

      expect(() => resolveNetworkProfile(malformed)).toThrow(/Invalid network URL/);
    });

    it("throws with details for a custom profile with a malformed contract ID", () => {
      const malformed = {
        networkUrl: "https://example.com/rpc",
        networkPassphrase: "Custom Network",
        payrollRegistryId: "not-a-contract-id",
      };

      expect(() => resolveNetworkProfile(malformed)).toThrow(/Invalid contract ID/);
    });

    it("throws with details for a custom profile with an invalid explorer URL", () => {
      const malformed = {
        networkUrl: "https://example.com/rpc",
        networkPassphrase: "Custom Network",
        explorerUrl: "not-a-url",
      };

      expect(() => resolveNetworkProfile(malformed)).toThrow(/Invalid explorer URL/);
    });

    it("combines multiple validation failures into a single error message", () => {
      const malformed = {
        networkUrl: "bad",
        networkPassphrase: "",
        payrollRegistryId: "also-bad",
      };

      try {
        resolveNetworkProfile(malformed);
        fail("expected resolveNetworkProfile to throw");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain("Invalid network URL");
        expect(message).toContain("networkPassphrase is required");
        expect(message).toContain("Invalid contract ID");
      }
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
    it("defines testnet, futurenet, mainnet, standalone, and localnet", () => {
      const names = KNOWN_ENVIRONMENTS.map((e) => e.name);
      expect(names).toContain("testnet");
      expect(names).toContain("futurenet");
      expect(names).toContain("mainnet");
      expect(names).toContain("standalone");
      expect(names).toContain("localnet");
    });

    it("each environment has networkUrl and networkPassphrase", () => {
      for (const env of KNOWN_ENVIRONMENTS) {
        expect(env.metadata.networkUrl).toBeTruthy();
        expect(env.metadata.networkPassphrase).toBeTruthy();
      }
    });
  });
});
