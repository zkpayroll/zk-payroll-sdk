import { groth16 } from "snarkjs";
import axios from "axios";
import { CacheProvider } from "../cache/CacheProvider";
import { PayrollError } from "../errors";
import { IProofGenerator, ProofPayload, ProofGeneratorConfig } from "./IProofGenerator";

/**
 * Snarkjs-based implementation of IProofGenerator.
 * Handles downloading circuit artifacts (.wasm, .zkey) and generating Groth16 proofs.
 */
export class SnarkjsProofGenerator implements IProofGenerator {
  private wasmCache?: ArrayBuffer;
  private zkeyCache?: Uint8Array;

  constructor(
    private config: ProofGeneratorConfig,
    private cache?: CacheProvider<string>
  ) {}

  /**
   * Generates a Groth16 zero-knowledge proof using snarkjs.
   *
   * @param witness - Circuit inputs (must match circuit's input signal names)
   * @returns ProofPayload formatted for smart contract verification
   */
  async generateProof(witness: Record<string, unknown>): Promise<ProofPayload> {
    try {
      // Check cache for existing proof
      if (this.cache) {
        const cacheKey = this.witnessKey(witness);
        const cached = await this.cache.get(cacheKey);
        if (cached !== null) {
          return JSON.parse(cached);
        }
      }

      // Fetch circuit artifacts
      const [wasm, zkey] = await Promise.all([this.fetchWasm(), this.fetchZkey()]);

      // Generate proof using snarkjs
      const { proof, publicSignals } = await groth16.fullProve(witness, wasm, zkey);

      // Format proof for contract verification
      const payload = this.formatProofPayload(proof, publicSignals);

      // Cache the result
      if (this.cache) {
        const cacheKey = this.witnessKey(witness);
        const ttl = this.config.artifactCacheTTL;
        await this.cache.set(cacheKey, JSON.stringify(payload), ttl);
      }

      return payload;
    } catch (error) {
      throw new PayrollError(
        `Proof generation failed: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  /**
   * Fetches the circuit .wasm file with caching.
   */
  private async fetchWasm(): Promise<ArrayBuffer> {
    if (this.wasmCache) {
      return this.wasmCache;
    }

    try {
      const response = await axios.get<ArrayBuffer>(this.config.wasmUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });

      this.wasmCache = response.data;
      return this.wasmCache;
    } catch (error) {
      throw new PayrollError(
        `Failed to fetch .wasm file from ${this.config.wasmUrl}: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  /**
   * Fetches the proving key .zkey file with caching.
   */
  private async fetchZkey(): Promise<Uint8Array> {
    if (this.zkeyCache) {
      return this.zkeyCache;
    }

    try {
      const response = await axios.get<ArrayBuffer>(this.config.zkeyUrl, {
        responseType: "arraybuffer",
        timeout: 60000, // .zkey files can be large
      });

      this.zkeyCache = new Uint8Array(response.data);
      return this.zkeyCache;
    } catch (error) {
      throw new PayrollError(
        `Failed to fetch .zkey file from ${this.config.zkeyUrl}: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  /**
   * Formats snarkjs proof output into contract-compatible structure.
   */
  private formatProofPayload(
    proof: {
      pi_a: string[];
      pi_b: string[][];
      pi_c: string[];
      protocol?: string;
      curve?: string;
    },
    publicSignals: string[]
  ): ProofPayload {
    return {
      proof: {
        pi_a: [proof.pi_a[0], proof.pi_a[1]],
        pi_b: [
          [proof.pi_b[0][1], proof.pi_b[0][0]],
          [proof.pi_b[1][1], proof.pi_b[1][0]],
        ],
        pi_c: [proof.pi_c[0], proof.pi_c[1]],
        protocol: proof.protocol || "groth16",
        curve: proof.curve || "bn128",
      },
      publicSignals,
    };
  }

  /**
   * Generates a stable cache key from witness data.
   */
  private witnessKey(witness: Record<string, unknown>): string {
    return `proof:${JSON.stringify(witness, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )}`;
  }

  /**
   * Clears cached artifacts to force re-download.
   */
  clearArtifactCache(): void {
    this.wasmCache = undefined;
    this.zkeyCache = undefined;
  }
}
