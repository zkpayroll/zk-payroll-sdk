import { groth16 } from "snarkjs";
import axios from "axios";
import * as fs from "fs";
import { CacheProvider } from "../cache/CacheProvider";
import { PayrollError, ProofGenerationError } from "../errors";
import {
  IPreloadableProofGenerator,
  ProofPayload,
  ProofGeneratorConfig,
  PreloadStatus,
  witnessKey,
} from "./IProofGenerator";
import { ArtifactHashMismatchError } from "./ArtifactErrors";
import { sha256Digest } from "./hashUtils";
import { SdkLogger } from "../logging/SdkLogger";
import { Semaphore } from "../core/concurrency";
import { IdempotencyRegistry } from "../core/idempotency";
import { validateProofConfig } from "./configValidation";
import { sanitizeProofInput } from "./proofInputSanitizer";

/**
 * Default max concurrency for `groth16.fullProve`. The snarkjs call is
 * CPU/memory-heavy so we keep it capped at 1 by default to prevent OOM
 * loops in consumer apps. Bump via `config.maxConcurrency` if your host
 * has enough cores / memory for parallel proofs.
 */
const DEFAULT_MAX_CONCURRENCY = 1;

/**
 * Snarkjs-based implementation of IPreloadableProofGenerator.
 * Handles downloading circuit artifacts (.wasm, .zkey) and generating Groth16 proofs.
 *
 * Concurrency guarantees (Issue #65):
 * - Same-witness requests share a single in-flight Promise (keyed dedup).
 * - Distinct-witness requests are bounded by `config.maxConcurrency` (FIFO).
 * - Concurrent `.wasm` / `.zkey` downloads are coalesced via in-flight
 *   Promise memoization, so a burst of N requests doesn't trigger N
 *   separate downloads.
 *
 * Pass an SdkLogger to observe proof generation and artifact lifecycle events.
 * Sensitive data (witness fields, amounts, recipients) is never logged.
 */
export class SnarkjsProofGenerator implements IPreloadableProofGenerator {
  private wasmCache?: ArrayBuffer;
  private zkeyCache?: Uint8Array;
  private wasmFetchPromise?: Promise<ArrayBuffer>;
  private zkeyFetchPromise?: Promise<Uint8Array>;
  private preloadStatus: PreloadStatus = { wasmLoaded: false, zkeyLoaded: false };

  private readonly config: ProofGeneratorConfig;
  private readonly expectedWasmHash?: string;
  private readonly expectedZkeyHash?: string;
  private readonly dedup: IdempotencyRegistry<ProofPayload>;
  private readonly semaphore: Semaphore;

  constructor(
    config: ProofGeneratorConfig,
    private readonly cache?: CacheProvider<string>,
    private readonly logger?: SdkLogger
  ) {
    validateProofConfig(config);

    const wasmUrl = config.wasmSource
      ? config.wasmSource.type === "local"
        ? config.wasmSource.path
        : config.wasmSource.url
      : config.wasmUrl!;
    const zkeyUrl = config.zkeySource
      ? config.zkeySource.type === "local"
        ? config.zkeySource.path
        : config.zkeySource.url
      : config.zkeyUrl!;

    this.config = {
      ...config,
      wasmUrl,
      zkeyUrl,
    };
    this.expectedWasmHash = config.expectedWasmHash;
    this.expectedZkeyHash = config.expectedZkeyHash;
    const permits = config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.semaphore = new Semaphore(permits);
    this.dedup = new IdempotencyRegistry<ProofPayload>(0);
  }

  /**
   * Generates a ZK proof for the given witness.
   *
   * Same-witness concurrent calls share a single underlying proof computation,
   * and distinct-witness calls are bounded by `config.maxConcurrency`.
   *
   * @param witness - Circuit inputs (recipient, amount, etc.)
   */
  async generateProof(witness: Record<string, unknown>): Promise<ProofPayload> {
    this.logger?.info("proof_generation_start", { wasmUrl: this.config.wasmUrl });

    // ── Sanitize witness before any proof work begins ────────────────────
    const sanitizeResult = sanitizeProofInput(witness);
    if (!sanitizeResult.valid) {
      const firstError = sanitizeResult.errors[0];
      throw new ProofGenerationError(firstError.message, firstError.code, {
        field: firstError.field,
      });
    }
    const sanitized = sanitizeResult.sanitized!;

    try {
      return await this.dedup.execute(witnessKey(sanitized), () =>
        this.semaphore.runExclusive(() => this.computeProof(sanitized))
      );
    } catch (error) {
      this.logger?.error("proof_generation_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new PayrollError(
        `Proof generation failed: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  /**
   * The actual proof-generation work, gated by the dedup registry AND
   * the semaphore. Re-checks the user cache first so a recently-populated
   * entry from a sibling caller is returned without re-running snarkjs.
   */
  private async computeProof(witness: Record<string, unknown>): Promise<ProofPayload> {
    const key = witnessKey(witness);

    if (this.cache) {
      const cached = await this.cache.get(key);
      if (cached !== null) {
        this.logger?.info("proof_cache_hit");
        return JSON.parse(cached) as ProofPayload;
      }
      this.logger?.info("proof_cache_miss");
    }

    const [wasm, zkey] = await Promise.all([this.fetchWasm(), this.fetchZkey()]);

    const { proof, publicSignals } = await groth16.fullProve(witness, wasm, zkey);

    const payload = this.formatProofPayload(proof, publicSignals);

    if (this.cache) {
      const ttl = this.config.artifactCacheTTL;
      await this.cache.set(key, JSON.stringify(payload), ttl);
    }

    this.logger?.info("proof_generation_complete");
    return payload;
  }

  /**
   * Preloads the .wasm and .zkey circuit artifacts into memory so that
   * the first generateProof() call incurs no download latency.
   *
   * Reuses artifacts already cached from a previous preload or generateProof() call.
   */
  async preload(): Promise<PreloadStatus> {
    this.logger?.info("artifact_preload_start", {
      wasmUrl: this.config.wasmUrl,
      zkeyUrl: this.config.zkeyUrl,
    });

    await Promise.all([this.fetchWasm(), this.fetchZkey()]);

    this.preloadStatus = {
      wasmLoaded: true,
      zkeyLoaded: true,
      completedAt: new Date().toISOString(),
    };

    this.logger?.info("artifact_preload_complete");
    return this.preloadStatus;
  }

  /** Returns the current preload status without triggering any downloads. */
  getPreloadStatus(): PreloadStatus {
    return { ...this.preloadStatus };
  }

  /**
   * Fetches the .wasm artifact. Idempotent for cached results, and coalesces
   * any concurrent calls into a single in-flight download so a burst of N
   * requests doesn't trigger N separate downloads.
   */
  private async fetchWasm(): Promise<ArrayBuffer> {
    if (this.wasmCache) {
      return this.wasmCache;
    }
    if (this.wasmFetchPromise) {
      return this.wasmFetchPromise;
    }

    this.logger?.info("artifact_fetch_start", { type: "wasm", url: this.config.wasmUrl });

    this.wasmFetchPromise = this.downloadWasm().finally(() => {
      this.wasmFetchPromise = undefined;
    });
    return this.wasmFetchPromise;
  }

  private isRemoteUrl(url: string): boolean {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  }

  private async downloadWasm(): Promise<ArrayBuffer> {
    try {
      if (this.isRemoteUrl(this.config.wasmUrl)) {
        const response = await axios.get<ArrayBuffer>(this.config.wasmUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
        });
        this.wasmCache = response.data;
      } else {
        const buffer = await fs.promises.readFile(this.config.wasmUrl);
        const ab = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(ab).set(buffer);
        this.wasmCache = ab;
      }

      await this.verifyHash(this.wasmCache, this.config.wasmUrl, "wasm", this.expectedWasmHash);

      this.preloadStatus = { ...this.preloadStatus, wasmLoaded: true };
      this.logger?.info("artifact_fetch_complete", { type: "wasm" });
      return this.wasmCache;
    } catch (error) {
      if (error instanceof ArtifactHashMismatchError) {
        throw error;
      }
      throw new PayrollError(
        `Failed to fetch wasm artifact from ${this.config.wasmUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        500
      );
    }
  }

  /**
   * Fetches the .zkey artifact. Idempotent for cached results, and coalesces
   * any concurrent calls into a single in-flight download.
   */
  private async fetchZkey(): Promise<Uint8Array> {
    if (this.zkeyCache) {
      return this.zkeyCache;
    }
    if (this.zkeyFetchPromise) {
      return this.zkeyFetchPromise;
    }

    this.logger?.info("artifact_fetch_start", { type: "zkey", url: this.config.zkeyUrl });

    this.zkeyFetchPromise = this.downloadZkey().finally(() => {
      this.zkeyFetchPromise = undefined;
    });
    return this.zkeyFetchPromise;
  }

  private async downloadZkey(): Promise<Uint8Array> {
    try {
      if (this.isRemoteUrl(this.config.zkeyUrl)) {
        const response = await axios.get<ArrayBuffer>(this.config.zkeyUrl, {
          responseType: "arraybuffer",
          timeout: 60000,
        });
        this.zkeyCache = new Uint8Array(response.data);
      } else {
        const buffer = await fs.promises.readFile(this.config.zkeyUrl);
        this.zkeyCache = new Uint8Array(buffer);
      }

      await this.verifyHash(this.zkeyCache, this.config.zkeyUrl, "zkey", this.expectedZkeyHash);

      this.preloadStatus = { ...this.preloadStatus, zkeyLoaded: true };
      this.logger?.info("artifact_fetch_complete", { type: "zkey" });
      return this.zkeyCache;
    } catch (error) {
      if (error instanceof ArtifactHashMismatchError) {
        throw error;
      }
      throw new PayrollError(
        `Failed to fetch zkey artifact from ${this.config.zkeyUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        500
      );
    }
  }

  private async verifyHash(
    content: Uint8Array | ArrayBuffer,
    source: string,
    artifactType: "wasm" | "zkey",
    expectedHash?: string
  ): Promise<void> {
    if (!expectedHash) {
      return;
    }

    const actualHash = await sha256Digest(content);

    if (actualHash !== expectedHash.toLowerCase()) {
      throw new ArtifactHashMismatchError(source, artifactType, expectedHash, actualHash);
    }

    this.logger?.info("artifact_hash_verified", { type: artifactType, source });
  }

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
   * Clears in-memory artifact cache and the in-flight dedup registry so the
   * next `generateProof` call will re-download artifacts and (for distinct
   * witnesses) re-run snarkjs.
   */
  clearArtifactCache(): void {
    this.wasmCache = undefined;
    this.zkeyCache = undefined;
    this.wasmFetchPromise = undefined;
    this.zkeyFetchPromise = undefined;
    this.preloadStatus = { wasmLoaded: false, zkeyLoaded: false };
    this.dedup.clear();
  }
}
