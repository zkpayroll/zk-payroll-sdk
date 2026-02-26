import { CacheProvider } from "../cache/CacheProvider";
import { SnarkjsProofGenerator } from "./SnarkjsProofGenerator";
import { ProofPayload, ProofGeneratorConfig } from "./IProofGenerator";

/**
 * Witness data for ZK proof generation.
 * Can contain various circuit inputs like recipient address, amount, etc.
 */
export interface ProofWitness {
  recipient?: string;
  amount?: bigint;
  [key: string]: unknown;
}

/**
 * Derives a stable cache key from the proof witness.
 * Handles bigint values so common witness fields (e.g. amount) are serializable.
 */
function witnessKey(witness: Record<string, unknown> | ProofWitness): string {
  return `proof:${JSON.stringify(witness, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  )}`;
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64");
}

function base64ToUint8Array(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, "base64"));
}

/**
 * Legacy ZKProofGenerator for backward compatibility.
 * For production use, prefer SnarkjsProofGenerator with proper circuit configuration.
 */
export class ZKProofGenerator {
  /**
   * Generates a ZK proof for the given witness.
   * If a CacheProvider is supplied, a cached proof is returned on hit
   * and the result is stored on miss — avoiding repeated .zkey downloads.
   *
   * @param witness  - Circuit inputs (recipient, amount, etc.)
   * @param cache    - Optional cache provider (MemoryCacheProvider or LocalStorageCacheProvider)
   * @deprecated Use SnarkjsProofGenerator for real proof generation
   */
  static async generateProof(
    witness: Record<string, unknown> | ProofWitness,
    cache?: CacheProvider<string>
  ): Promise<Uint8Array> {
    if (cache) {
      const key = witnessKey(witness);
      const cached = await cache.get(key);
      if (cached !== null) {
        return base64ToUint8Array(cached);
      }

      // Proof generation (simulated — replace with real snarkjs / .zkey call).
      const proof = new Uint8Array(32);
      await cache.set(key, uint8ArrayToBase64(proof));
      return proof;
    }

    // Proof generation without caching.
    return new Uint8Array(32);
  }
  /**
   * Creates a configured SnarkjsProofGenerator instance.
   *
   * @param config - Circuit artifact URLs and cache settings
   * @param cache - Optional cache provider for proof results
   * @returns Configured proof generator ready for use
   */
  static createSnarkjsGenerator(
    config: ProofGeneratorConfig,
    cache?: CacheProvider<string>
  ): SnarkjsProofGenerator {
    return new SnarkjsProofGenerator(config, cache);
  }

  /**
   * Generates a real ZK proof using snarkjs with the provided configuration.
   *
   * @param witness - Circuit inputs
   * @param config - Circuit artifact configuration
   * @param cache - Optional cache provider
   * @returns ProofPayload ready for contract verification
   */
  static async generateSnarkjsProof(
    witness: Record<string, unknown>,
    config: ProofGeneratorConfig,
    cache?: CacheProvider<string>
  ): Promise<ProofPayload> {
    const generator = new SnarkjsProofGenerator(config, cache);
    return generator.generateProof(witness);
  }
}
