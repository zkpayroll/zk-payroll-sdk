/**
 * Artifact resolution abstraction for the ZK Payroll SDK.
 *
 * This module defines the contract that all artifact resolvers must implement,
 * along with the configuration types used to specify where circuit artifacts
 * (.wasm and .zkey files) are located.
 *
 * Two built-in resolvers are provided:
 *   - {@link RemoteArtifactResolver} — fetches artifacts over HTTP(S).
 *   - {@link LocalArtifactResolver}  — reads artifacts from the local filesystem.
 *
 * @module
 */

/**
 * Discriminated union describing where a single circuit artifact lives.
 *
 * Use `{ type: "remote", url: "https://..." }` for network-hosted artifacts, or
 * `{ type: "local", path: "/absolute/path/to/file" }` for air-gapped and
 * offline development workflows.
 *
 * @example
 * ```typescript
 * const wasmSource: ArtifactSource = { type: "local", path: "./circuits/payroll.wasm" };
 * const zkeySource: ArtifactSource = { type: "remote", url: "https://cdn.example.com/payroll.zkey" };
 * ```
 */
export type ArtifactSource = { type: "remote"; url: string } | { type: "local"; path: string };

/**
 * The resolved binary content of a pair of circuit artifacts,
 * ready for consumption by snarkjs `groth16.fullProve()`.
 */
export interface ResolvedArtifacts {
  /** The compiled circuit as a WebAssembly binary (.wasm). */
  wasm: ArrayBuffer;
  /** The proving key (.zkey) as a byte array. */
  zkey: Uint8Array;
}

/**
 * Interface for pluggable artifact resolution strategies.
 *
 * Implement this interface to add new artifact backends (e.g. S3, IPFS,
 * in-memory test fixtures). The resolver is responsible for locating,
 * validating, and returning the raw binary content of both circuit artifacts.
 *
 * @example
 * ```typescript
 * class S3ArtifactResolver implements IArtifactResolver {
 *   async resolve(): Promise<ResolvedArtifacts> {
 *     // fetch from S3 bucket ...
 *   }
 * }
 * ```
 */
export interface IArtifactResolver {
  /**
   * Resolves and returns the circuit artifacts.
   *
   * Implementations should throw a descriptive error from `ArtifactErrors`
   * when resolution fails (file missing, network unreachable, etc.).
   *
   * @returns The resolved wasm and zkey binary content.
   * @throws {ArtifactNotFoundError} When a local file does not exist.
   * @throws {ArtifactAccessError}   When a local file cannot be read (permissions).
   * @throws {ArtifactCorruptError}  When a file is empty or has an invalid extension.
   * @throws {ArtifactFetchError}    When an HTTP fetch fails.
   */
  resolve(): Promise<ResolvedArtifacts>;
}
