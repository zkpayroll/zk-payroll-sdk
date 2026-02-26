import { SnarkjsProofGenerator } from "../src/crypto/SnarkjsProofGenerator";
import { MemoryCacheProvider } from "../src/cache/MemoryCacheProvider";
import { PayrollError } from "../src/errors";
import { ProofGeneratorConfig } from "../src/crypto/IProofGenerator";
import axios from "axios";

// Mock snarkjs
jest.mock("snarkjs", () => ({
  groth16: {
    fullProve: jest.fn(),
  },
}));

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("SnarkjsProofGenerator", () => {
  const mockConfig: ProofGeneratorConfig = {
    wasmUrl: "https://example.com/circuit.wasm",
    zkeyUrl: "https://example.com/circuit.zkey",
    artifactCacheTTL: 3600,
  };

  const mockWasm = new ArrayBuffer(100);
  const mockZkey = new Uint8Array(200);

  const mockProof = {
    pi_a: ["1", "2", "1"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
      ["1", "1"],
    ],
    pi_c: ["7", "8", "1"],
    protocol: "groth16",
    curve: "bn128",
  };

  const mockPublicSignals = ["123456789", "987654321"];

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock axios responses
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes(".wasm")) {
        return Promise.resolve({ data: mockWasm });
      }
      if (url.includes(".zkey")) {
        return Promise.resolve({ data: mockZkey.buffer });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    // Mock snarkjs fullProve
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { groth16 } = require("snarkjs");
    groth16.fullProve.mockResolvedValue({
      proof: mockProof,
      publicSignals: mockPublicSignals,
    });
  });

  describe("generateProof", () => {
    it("generates a proof successfully", async () => {
      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = { recipient: "GTEST", amount: 1000n };

      const result = await generator.generateProof(witness);

      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("publicSignals");
      expect(result.proof.protocol).toBe("groth16");
      expect(result.proof.curve).toBe("bn128");
      expect(result.publicSignals).toEqual(mockPublicSignals);
    });

    it("fetches .wasm and .zkey files on first call", async () => {
      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = { recipient: "GTEST", amount: 1000n };

      await generator.generateProof(witness);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        mockConfig.wasmUrl,
        expect.objectContaining({ responseType: "arraybuffer" })
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        mockConfig.zkeyUrl,
        expect.objectContaining({ responseType: "arraybuffer" })
      );
    });

    it("caches artifacts and reuses them on subsequent calls", async () => {
      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = { recipient: "GTEST", amount: 1000n };

      await generator.generateProof(witness);
      await generator.generateProof(witness);

      // Should only fetch once
      expect(mockedAxios.get).toHaveBeenCalledTimes(2); // 1 wasm + 1 zkey
    });

    it("caches proof results when cache provider is supplied", async () => {
      const cache = new MemoryCacheProvider<string>();
      const generator = new SnarkjsProofGenerator(mockConfig, cache);
      const witness = { recipient: "GTEST", amount: 1000n };

      const setSpy = jest.spyOn(cache, "set");

      await generator.generateProof(witness);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy).toHaveBeenCalledWith(
        expect.stringContaining("proof:"),
        expect.any(String),
        mockConfig.artifactCacheTTL
      );
    });

    it("returns cached proof on subsequent calls with same witness", async () => {
      const cache = new MemoryCacheProvider<string>();
      const generator = new SnarkjsProofGenerator(mockConfig, cache);
      const witness = { recipient: "GTEST", amount: 1000n };

      const first = await generator.generateProof(witness);
      const second = await generator.generateProof(witness);

      expect(first).toEqual(second);
      // snarkjs should only be called once
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { groth16 } = require("snarkjs");
      expect(groth16.fullProve).toHaveBeenCalledTimes(1);
    });

    it("generates different proofs for different witnesses", async () => {
      const cache = new MemoryCacheProvider<string>();
      const generator = new SnarkjsProofGenerator(mockConfig, cache);

      await generator.generateProof({ recipient: "A", amount: 100n });
      await generator.generateProof({ recipient: "B", amount: 200n });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { groth16 } = require("snarkjs");
      expect(groth16.fullProve).toHaveBeenCalledTimes(2);
    });

    it("handles bigint values in witness correctly", async () => {
      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = {
        recipient: "GTEST",
        amount: 999999999999999999n,
        nullifier: 123456789012345678n,
      };

      await expect(generator.generateProof(witness)).resolves.toBeDefined();
    });

    it("throws PayrollError when .wasm fetch fails", async () => {
      // Create a fresh generator without cache to avoid cached results
      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = { recipient: "GTEST_WASM_FAIL", amount: 9999n };

      // Mock failure for wasm fetch
      mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));

      await expect(generator.generateProof(witness)).rejects.toThrow(PayrollError);
    });

    it("throws PayrollError when .zkey fetch fails", async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes(".wasm")) {
          return Promise.resolve({ data: mockWasm });
        }
        return Promise.reject(new Error("Network error"));
      });

      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = { recipient: "GTEST", amount: 1000n };

      await expect(generator.generateProof(witness)).rejects.toThrow(PayrollError);
      await expect(generator.generateProof(witness)).rejects.toThrow(/Failed to fetch .zkey file/);
    });

    it("throws PayrollError when snarkjs proof generation fails", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { groth16 } = require("snarkjs");
      groth16.fullProve.mockRejectedValueOnce(new Error("Invalid witness"));

      // Create a fresh generator and clear artifact cache
      const generator = new SnarkjsProofGenerator(mockConfig);
      generator.clearArtifactCache();

      const witness = { recipient: "GTEST_SNARKJS_FAIL", amount: 8888n };

      await expect(generator.generateProof(witness)).rejects.toThrow(PayrollError);
    });

    it("formats proof payload correctly for contract verification", async () => {
      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = { recipient: "GTEST", amount: 1000n };

      const result = await generator.generateProof(witness);

      // Verify proof structure
      expect(result.proof.pi_a).toHaveLength(2);
      expect(result.proof.pi_b).toHaveLength(2);
      expect(result.proof.pi_b[0]).toHaveLength(2);
      expect(result.proof.pi_b[1]).toHaveLength(2);
      expect(result.proof.pi_c).toHaveLength(2);

      // Verify pi_b coordinate swap (snarkjs quirk)
      expect(result.proof.pi_b[0]).toEqual(["4", "3"]);
      expect(result.proof.pi_b[1]).toEqual(["6", "5"]);
    });
  });

  describe("clearArtifactCache", () => {
    it("forces re-download of artifacts after clearing cache", async () => {
      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = { recipient: "GTEST", amount: 1000n };

      await generator.generateProof(witness);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);

      generator.clearArtifactCache();
      await generator.generateProof(witness);

      // Should fetch again after clearing
      expect(mockedAxios.get).toHaveBeenCalledTimes(4);
    });
  });

  describe("configuration", () => {
    it("respects custom timeout settings", async () => {
      const generator = new SnarkjsProofGenerator(mockConfig);
      const witness = { recipient: "GTEST", amount: 1000n };

      await generator.generateProof(witness);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        mockConfig.wasmUrl,
        expect.objectContaining({ timeout: 30000 })
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        mockConfig.zkeyUrl,
        expect.objectContaining({ timeout: 60000 })
      );
    });

    it("works without artifactCacheTTL specified", async () => {
      const configWithoutTTL: ProofGeneratorConfig = {
        wasmUrl: mockConfig.wasmUrl,
        zkeyUrl: mockConfig.zkeyUrl,
      };

      const cache = new MemoryCacheProvider<string>();
      const generator = new SnarkjsProofGenerator(configWithoutTTL, cache);
      const witness = { recipient: "GTEST", amount: 1000n };

      await expect(generator.generateProof(witness)).resolves.toBeDefined();
    });
  });
});
