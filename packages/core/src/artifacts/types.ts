import { ArtifactSource } from "../crypto/IArtifactResolver";

export type ProofArtifactKind = "wasm" | "zkey" | "verificationKey";

export type ProofArtifactCacheMode = "disabled" | "memory" | "persistent";

export interface ProofArtifactDescriptor {
  kind: ProofArtifactKind;
  source: ArtifactSource;
  sha256: string;
  sizeBytes?: number;
}

export interface ProofArtifactCompatibility {
  sdkVersion: string;
  circuitVersion: string;
  contractVerifierVersion: string;
  verificationKeyVersion: string;
}

export interface ProofArtifactCachePolicy {
  mode: ProofArtifactCacheMode;
  ttlSeconds?: number;
  allowStaleFallback?: boolean;
}

export interface ProofArtifactManifest {
  schemaVersion: "1.0";
  manifestVersion: string;
  circuitId: string;
  artifacts: ProofArtifactDescriptor[];
  compatibility: ProofArtifactCompatibility;
  cachePolicy?: ProofArtifactCachePolicy;
  metadata?: Record<string, unknown>;
}

export interface ProofArtifactRuntimeCompatibility {
  sdkVersion: string;
  circuitVersion: string;
  contractVerifierVersion: string;
  verificationKeyVersion: string;
}

export interface LoadedProofArtifact {
  descriptor: ProofArtifactDescriptor;
  bytes: Uint8Array;
  loadedFromCache: boolean;
  stale: boolean;
}

export interface LoadedProofArtifactSet {
  manifest: ProofArtifactManifest;
  artifacts: Record<ProofArtifactKind, LoadedProofArtifact>;
}

export interface ProofArtifactCacheEntry {
  descriptor: ProofArtifactDescriptor;
  bytes: Uint8Array;
  cachedAt: number;
}

export interface ProofArtifactCache {
  get(key: string): Promise<ProofArtifactCacheEntry | undefined>;
  set(key: string, entry: ProofArtifactCacheEntry): Promise<void>;
}

export interface ProofArtifactContentLoader {
  load(descriptor: ProofArtifactDescriptor): Promise<Uint8Array>;
}
