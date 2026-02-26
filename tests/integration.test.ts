import { ZKProofGenerator } from "../src/crypto/proofs";
import { SnarkjsProofGenerator } from "../src/crypto/SnarkjsProofGenerator";
import { MemoryCacheProvider } from "../src/cache/MemoryCacheProvider";
import { ProofGeneratorConfig } from "../src/crypto/IProofGenerator";

describe("Integration", () => {
  describe("ZKProofGenerator factory methods", () => {
    it("creates SnarkjsProofGenerator with configuration", () => {
      const config: ProofGeneratorConfig = {
        wasmUrl: "https://example.com/circuit.wasm",
        zkeyUrl: "https://example.com/circuit.zkey",
      };

      const generator = ZKProofGenerator.createSnarkjsGenerator(config);

      expect(generator).toBeInstanceOf(SnarkjsProofGenerator);
    });

    it("creates SnarkjsProofGenerator with cache provider", () => {
      const config: ProofGeneratorConfig = {
        wasmUrl: "https://example.com/circuit.wasm",
        zkeyUrl: "https://example.com/circuit.zkey",
      };
      const cache = new MemoryCacheProvider<string>();

      const generator = ZKProofGenerator.createSnarkjsGenerator(config, cache);

      expect(generator).toBeInstanceOf(SnarkjsProofGenerator);
    });
  });

  describe("Real-world usage example", () => {
    it("demonstrates typical proof generation workflow", async () => {
      // This test demonstrates the expected usage pattern
      // In production, replace URLs with actual circuit artifact locations

      const config: ProofGeneratorConfig = {
        wasmUrl: "https://cdn.example.com/payroll_circuit.wasm",
        zkeyUrl: "https://cdn.example.com/payroll_circuit.zkey",
        artifactCacheTTL: 86400, // 24 hours
      };

      // Optional: Use cache to avoid regenerating identical proofs
      const cache = new MemoryCacheProvider<string>();

      // Create generator instance
      const generator = new SnarkjsProofGenerator(config, cache);

      // This would generate a real proof in production
      // For this test, we just verify the interface works
      expect(generator.generateProof).toBeDefined();
      expect(typeof generator.generateProof).toBe("function");
    });
  });
});
