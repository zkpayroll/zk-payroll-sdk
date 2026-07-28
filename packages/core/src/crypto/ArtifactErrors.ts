/**
 * Specialized error classes for circuit artifact resolution failures.
 *
 * Each error class targets a specific failure mode and carries the offending
 * path or URL in its `context` property, making it straightforward to diagnose
 * issues in CI logs or developer tooling.
 *
 * All classes extend the SDK's base `ZkPayrollError`.
 *
 * @module
 */

import { ZkPayrollError } from "../errors";

/** Error codes scoped to artifact resolution. */
export const ArtifactErrorCode = {
  /** The file does not exist at the specified path. */
  ARTIFACT_NOT_FOUND: "ARTIFACT_NOT_FOUND",
  /** The file exists but cannot be read (e.g. permission denied). */
  ARTIFACT_ACCESS_DENIED: "ARTIFACT_ACCESS_DENIED",
  /** The file is empty, has an invalid extension, or is otherwise unusable. */
  ARTIFACT_CORRUPT: "ARTIFACT_CORRUPT",
  /** An HTTP request for a remote artifact failed. */
  ARTIFACT_FETCH_FAILED: "ARTIFACT_FETCH_FAILED",
  /** The artifact content does not match the expected SHA-256 hash. */
  ARTIFACT_HASH_MISMATCH: "ARTIFACT_HASH_MISMATCH",
} as const;

export type ArtifactErrorCode = (typeof ArtifactErrorCode)[keyof typeof ArtifactErrorCode];

/**
 * Thrown when a circuit artifact file does not exist at the expected path.
 *
 * @example
 * ```typescript
 * // context.path contains the missing file path
 * catch (err) {
 *   if (err instanceof ArtifactNotFoundError) {
 *     console.error(`Missing: ${err.context.path}`);
 *   }
 * }
 * ```
 */
export class ArtifactNotFoundError extends ZkPayrollError {
  constructor(artifactPath: string, artifactType: "wasm" | "zkey") {
    super(
      `Circuit artifact not found: the ${artifactType} file does not exist at "${artifactPath}". ` +
        `Ensure the file has been compiled and the path is correct.`,
      ArtifactErrorCode.ARTIFACT_NOT_FOUND,
      { path: artifactPath, artifactType }
    );
    this.name = "ArtifactNotFoundError";
  }
}

/**
 * Thrown when a circuit artifact file exists but cannot be read,
 * typically due to file-system permissions.
 */
export class ArtifactAccessError extends ZkPayrollError {
  constructor(artifactPath: string, artifactType: "wasm" | "zkey", reason?: string) {
    super(
      `Cannot read circuit artifact: the ${artifactType} file at "${artifactPath}" is not accessible. ` +
        `${reason ?? "Check file permissions and ownership."}`,
      ArtifactErrorCode.ARTIFACT_ACCESS_DENIED,
      { path: artifactPath, artifactType }
    );
    this.name = "ArtifactAccessError";
  }
}

/**
 * Thrown when a circuit artifact file is present but appears invalid —
 * e.g. the file is empty (0 bytes) or has an unexpected file extension.
 */
export class ArtifactCorruptError extends ZkPayrollError {
  constructor(artifactPath: string, artifactType: "wasm" | "zkey", reason: string) {
    super(
      `Invalid circuit artifact: the ${artifactType} file at "${artifactPath}" is corrupt or invalid. ${reason}`,
      ArtifactErrorCode.ARTIFACT_CORRUPT,
      { path: artifactPath, artifactType }
    );
    this.name = "ArtifactCorruptError";
  }
}

/**
 * Thrown when an HTTP fetch for a remote artifact fails.
 * Wraps the underlying network error with the URL that was attempted.
 */
export class ArtifactFetchError extends ZkPayrollError {
  constructor(url: string, artifactType: "wasm" | "zkey", reason: string) {
    super(
      `Failed to fetch ${artifactType} artifact from "${url}": ${reason}`,
      ArtifactErrorCode.ARTIFACT_FETCH_FAILED,
      { url, artifactType }
    );
    this.name = "ArtifactFetchError";
  }
}

/**
 * Thrown when a circuit artifact's SHA-256 hash does not match the expected value.
 * This prevents proof generation or transaction assembly with tampered or
 * incorrect artifacts.
 */
export class ArtifactHashMismatchError extends ZkPayrollError {
  constructor(
    artifactPath: string,
    artifactType: "wasm" | "zkey",
    expected: string,
    actual: string
  ) {
    super(
      `SHA-256 hash mismatch for ${artifactType} artifact at "${artifactPath}": ` +
        `expected ${expected} but got ${actual}. ` +
        `The artifact may be corrupted, tampered with, or from an unexpected version.`,
      ArtifactErrorCode.ARTIFACT_HASH_MISMATCH,
      { path: artifactPath, artifactType, expected, actual }
    );
    this.name = "ArtifactHashMismatchError";
  }
}
