/**
 * Remote (HTTP/HTTPS) artifact resolver.
 *
 * This resolver extracts the existing HTTP-fetch logic that was previously
 * inlined in {@link SnarkjsProofGenerator} into a standalone class implementing
 * the {@link IArtifactResolver} interface.
 *
 * Functionally identical to the original `fetchWasm()` / `fetchZkey()` methods
 * but now composable with other resolvers via the common interface.
 *
 * @module
 */

import axios from "axios";
import { IArtifactResolver, ResolvedArtifacts } from "./IArtifactResolver";
import { ArtifactFetchError, ArtifactHashMismatchError } from "./ArtifactErrors";
import { sha256Digest } from "./hashUtils";
import { SdkLogger } from "../logging/SdkLogger";

/**
 * Configuration for the remote artifact resolver.
 */
export interface RemoteArtifactResolverConfig {
  /** HTTP(S) URL to the circuit .wasm file. */
  wasmUrl: string;
  /** HTTP(S) URL to the proving key .zkey file. */
  zkeyUrl: string;
  /** Timeout in milliseconds for the .wasm download. @default 30000 */
  wasmTimeoutMs?: number;
  /** Timeout in milliseconds for the .zkey download. @default 60000 */
  zkeyTimeoutMs?: number;
  /**
   * Expected SHA-256 hex digest of the .wasm file.
   * When set, the resolver verifies the hash before returning,
   * throwing {@link ArtifactHashMismatchError} on mismatch.
   */
  expectedWasmHash?: string;
  /**
   * Expected SHA-256 hex digest of the .zkey file.
   * When set, the resolver verifies the hash before returning,
   * throwing {@link ArtifactHashMismatchError} on mismatch.
   */
  expectedZkeyHash?: string;
}

/**
 * Resolves circuit artifacts by fetching them over HTTP(S) using axios.
 *
 * @example
 * ```typescript
 * const resolver = new RemoteArtifactResolver({
 *   wasmUrl: "https://cdn.example.com/circuit.wasm",
 *   zkeyUrl: "https://cdn.example.com/circuit.zkey",
 * });
 *
 * const { wasm, zkey } = await resolver.resolve();
 * ```
 */
export class RemoteArtifactResolver implements IArtifactResolver {
  private readonly config: RemoteArtifactResolverConfig;

  constructor(
    config: RemoteArtifactResolverConfig,
    private readonly logger?: SdkLogger
  ) {
    this.config = { ...config };
  }

  /**
   * Fetches both circuit artifact files over HTTP.
   *
   * @returns Resolved wasm and zkey binary content.
   * @throws {ArtifactFetchError} If either HTTP request fails.
   * @throws {ArtifactHashMismatchError} If an expected hash is set and the content doesn't match.
   */
  async resolve(): Promise<ResolvedArtifacts> {
    const [wasm, zkey] = await Promise.all([
      this.fetchArtifact(this.config.wasmUrl, "wasm", this.config.wasmTimeoutMs ?? 30_000),
      this.fetchArtifact(this.config.zkeyUrl, "zkey", this.config.zkeyTimeoutMs ?? 60_000),
    ]);

    // Verify SHA-256 hashes if expected values were provided
    const zkeyBytes = new Uint8Array(zkey);
    await Promise.all([
      this.verifyHash(wasm, this.config.wasmUrl, "wasm", this.config.expectedWasmHash),
      this.verifyHash(zkeyBytes, this.config.zkeyUrl, "zkey", this.config.expectedZkeyHash),
    ]);

    return { wasm, zkey: zkeyBytes };
  }

  /**
   * Fetches a single artifact from the given URL.
   */
  private async fetchArtifact(
    url: string,
    artifactType: "wasm" | "zkey",
    timeoutMs: number
  ): Promise<ArrayBuffer> {
    this.logger?.info("artifact_fetch_start", { type: artifactType, url });

    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
        timeout: timeoutMs,
      });

      this.logger?.info("artifact_fetch_complete", { type: artifactType });
      return response.data;
    } catch (error) {
      throw new ArtifactFetchError(
        url,
        artifactType,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Verifies the SHA-256 hash of fetched content against an expected value.
   * No-op if expectedHash is undefined.
   */
  private async verifyHash(
    content: Uint8Array | ArrayBuffer,
    url: string,
    artifactType: "wasm" | "zkey",
    expectedHash?: string
  ): Promise<void> {
    if (!expectedHash) {
      return;
    }

    const actualHash = await sha256Digest(content);

    if (actualHash !== expectedHash.toLowerCase()) {
      throw new ArtifactHashMismatchError(url, artifactType, expectedHash, actualHash);
    }

    this.logger?.info("artifact_hash_verified", {
      type: artifactType,
      url,
    });
  }
}
