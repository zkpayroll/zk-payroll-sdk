import { sha256Digest } from "../crypto/hashUtils";
import { ProofArtifactLifecycleError, ProofArtifactLifecycleErrorCode } from "./errors";
import {
  LoadedProofArtifact,
  LoadedProofArtifactSet,
  ProofArtifactCache,
  ProofArtifactCacheEntry,
  ProofArtifactContentLoader,
  ProofArtifactDescriptor,
  ProofArtifactKind,
  ProofArtifactManifest,
  ProofArtifactRuntimeCompatibility,
} from "./types";

export class MemoryProofArtifactCache implements ProofArtifactCache {
  private readonly entries = new Map<string, ProofArtifactCacheEntry>();

  async get(key: string): Promise<ProofArtifactCacheEntry | undefined> {
    return this.entries.get(key);
  }

  async set(key: string, entry: ProofArtifactCacheEntry): Promise<void> {
    this.entries.set(key, entry);
  }
}

export class FetchProofArtifactContentLoader implements ProofArtifactContentLoader {
  async load(descriptor: ProofArtifactDescriptor): Promise<Uint8Array> {
    if (descriptor.source.type === "local") {
      throw new ProofArtifactLifecycleError(
        "Local artifact loading requires a custom ProofArtifactContentLoader in this runtime.",
        ProofArtifactLifecycleErrorCode.MISSING_ARTIFACT,
        { kind: descriptor.kind, path: descriptor.source.path }
      );
    }

    let response: Response;
    try {
      response = await fetch(descriptor.source.url);
    } catch (err: unknown) {
      throw new ProofArtifactLifecycleError(
        `Failed to fetch ${descriptor.kind} artifact: ${(err as Error).message}`,
        ProofArtifactLifecycleErrorCode.NETWORK_FETCH_FAILED,
        { kind: descriptor.kind, url: descriptor.source.url }
      );
    }

    if (!response.ok) {
      throw new ProofArtifactLifecycleError(
        `Failed to fetch ${descriptor.kind} artifact: HTTP ${response.status}.`,
        ProofArtifactLifecycleErrorCode.NETWORK_FETCH_FAILED,
        { kind: descriptor.kind, url: descriptor.source.url, status: response.status }
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}

export interface ProofArtifactLifecycleManagerOptions {
  loader?: ProofArtifactContentLoader;
  cache?: ProofArtifactCache;
  now?: () => number;
}

export class ProofArtifactLifecycleManager {
  private readonly loader: ProofArtifactContentLoader;
  private readonly cache?: ProofArtifactCache;
  private readonly now: () => number;

  constructor(options: ProofArtifactLifecycleManagerOptions = {}) {
    this.loader = options.loader ?? new FetchProofArtifactContentLoader();
    this.cache = options.cache;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async loadArtifacts(
    manifest: ProofArtifactManifest,
    runtime: ProofArtifactRuntimeCompatibility
  ): Promise<LoadedProofArtifactSet> {
    this.validateManifest(manifest);
    this.validateCompatibility(manifest, runtime);

    const loaded = await Promise.all(
      manifest.artifacts.map((descriptor) => this.loadArtifact(manifest, descriptor))
    );

    return {
      manifest,
      artifacts: loaded.reduce(
        (acc, artifact) => ({
          ...acc,
          [artifact.descriptor.kind]: artifact,
        }),
        {} as Record<ProofArtifactKind, LoadedProofArtifact>
      ),
    };
  }

  validateManifest(manifest: ProofArtifactManifest): void {
    if (manifest.schemaVersion !== "1.0" || !manifest.manifestVersion || !manifest.circuitId) {
      throw new ProofArtifactLifecycleError(
        "Proof artifact manifest is missing schemaVersion, manifestVersion, or circuitId.",
        ProofArtifactLifecycleErrorCode.INVALID_MANIFEST,
        { schemaVersion: manifest.schemaVersion, manifestVersion: manifest.manifestVersion }
      );
    }

    const requiredKinds: ProofArtifactKind[] = ["wasm", "zkey", "verificationKey"];
    const seen = new Set(manifest.artifacts.map((artifact) => artifact.kind));
    for (const kind of requiredKinds) {
      if (!seen.has(kind)) {
        throw new ProofArtifactLifecycleError(
          `Proof artifact manifest is missing required ${kind} artifact.`,
          ProofArtifactLifecycleErrorCode.MISSING_ARTIFACT,
          { kind }
        );
      }
    }

    for (const artifact of manifest.artifacts) {
      if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
        throw new ProofArtifactLifecycleError(
          `Proof artifact ${artifact.kind} has a malformed SHA-256 hash.`,
          ProofArtifactLifecycleErrorCode.INVALID_MANIFEST,
          { kind: artifact.kind, sha256: artifact.sha256 }
        );
      }
    }
  }

  validateCompatibility(
    manifest: ProofArtifactManifest,
    runtime: ProofArtifactRuntimeCompatibility
  ): void {
    const expected = manifest.compatibility;
    const checks: Array<keyof ProofArtifactRuntimeCompatibility> = [
      "sdkVersion",
      "circuitVersion",
      "contractVerifierVersion",
      "verificationKeyVersion",
    ];

    for (const key of checks) {
      if (expected[key] !== runtime[key]) {
        throw new ProofArtifactLifecycleError(
          `Proof artifact ${key} mismatch: expected ${expected[key]}, got ${runtime[key]}.`,
          ProofArtifactLifecycleErrorCode.INCOMPATIBLE_VERSION,
          { field: key, expected: expected[key], actual: runtime[key] }
        );
      }
    }
  }

  private async loadArtifact(
    manifest: ProofArtifactManifest,
    descriptor: ProofArtifactDescriptor
  ): Promise<LoadedProofArtifact> {
    const cacheKey = this.cacheKey(manifest, descriptor);
    const cached = await this.cache?.get(cacheKey);
    const cachePolicy = manifest.cachePolicy ?? { mode: "disabled" as const };

    if (cached && !this.isExpired(cached, cachePolicy.ttlSeconds)) {
      await this.verifyHash(cached.bytes, descriptor);
      return { descriptor, bytes: cached.bytes, loadedFromCache: true, stale: false };
    }

    try {
      const bytes = await this.loader.load(descriptor);
      await this.verifyHash(bytes, descriptor);
      if (cachePolicy.mode !== "disabled") {
        await this.cache?.set(cacheKey, { descriptor, bytes, cachedAt: this.now() });
      }
      return { descriptor, bytes, loadedFromCache: false, stale: false };
    } catch (err: unknown) {
      if (cached && cachePolicy.allowStaleFallback) {
        await this.verifyHash(cached.bytes, descriptor);
        return { descriptor, bytes: cached.bytes, loadedFromCache: true, stale: true };
      }
      throw err;
    }
  }

  private async verifyHash(bytes: Uint8Array, descriptor: ProofArtifactDescriptor): Promise<void> {
    const actual = await sha256Digest(bytes);
    if (actual !== descriptor.sha256.toLowerCase()) {
      throw new ProofArtifactLifecycleError(
        `SHA-256 mismatch for ${descriptor.kind} artifact.`,
        ProofArtifactLifecycleErrorCode.HASH_MISMATCH,
        { kind: descriptor.kind, expected: descriptor.sha256, actual }
      );
    }

    if (descriptor.sizeBytes !== undefined && descriptor.sizeBytes !== bytes.byteLength) {
      throw new ProofArtifactLifecycleError(
        `Size mismatch for ${descriptor.kind} artifact.`,
        ProofArtifactLifecycleErrorCode.HASH_MISMATCH,
        { kind: descriptor.kind, expected: descriptor.sizeBytes, actual: bytes.byteLength }
      );
    }
  }

  private isExpired(entry: ProofArtifactCacheEntry, ttlSeconds?: number): boolean {
    return ttlSeconds !== undefined && entry.cachedAt + ttlSeconds <= this.now();
  }

  private cacheKey(manifest: ProofArtifactManifest, descriptor: ProofArtifactDescriptor): string {
    return [
      "proof-artifact",
      manifest.circuitId,
      manifest.manifestVersion,
      descriptor.kind,
      descriptor.sha256,
    ].join(":");
  }
}
