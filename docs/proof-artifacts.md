# Proof Artifact Lifecycle Management

Proof artifacts are security-critical dependencies. The SDK now supports a
versioned manifest format for loading WASM, zkey, and verification-key artifacts
with integrity and compatibility checks before proof generation begins.

## Manifest format

```ts
import { ProofArtifactManifest } from "@zk-payroll/core";

const manifest: ProofArtifactManifest = {
  schemaVersion: "1.0",
  manifestVersion: "2026.07.30",
  circuitId: "private-payroll",
  artifacts: [
    {
      kind: "wasm",
      source: { type: "remote", url: "https://cdn.example/payroll.wasm" },
      sha256: "...",
    },
    {
      kind: "zkey",
      source: { type: "remote", url: "https://cdn.example/payroll.zkey" },
      sha256: "...",
    },
    {
      kind: "verificationKey",
      source: { type: "remote", url: "https://cdn.example/payroll.vkey.json" },
      sha256: "...",
    },
  ],
  compatibility: {
    sdkVersion: "0.1.0",
    circuitVersion: "payroll-v1",
    contractVerifierVersion: "verifier-v1",
    verificationKeyVersion: "vk-v1",
  },
  cachePolicy: {
    mode: "memory",
    ttlSeconds: 3600,
    allowStaleFallback: true,
  },
};
```

## Loading artifacts safely

```ts
import { ProofArtifactLifecycleManager, MemoryProofArtifactCache } from "@zk-payroll/core";

const artifacts = await new ProofArtifactLifecycleManager({
  cache: new MemoryProofArtifactCache(),
}).loadArtifacts(manifest, {
  sdkVersion: "0.1.0",
  circuitVersion: "payroll-v1",
  contractVerifierVersion: "verifier-v1",
  verificationKeyVersion: "vk-v1",
});
```

The manager checks:

- manifest schema
- required artifact kinds
- SHA-256 hashes
- optional byte sizes
- SDK/circuit/verifier/verification-key compatibility
- cache freshness and stale fallback policy

## Pinning and upgrades

Integrators should pin `manifestVersion`, `circuitVersion`,
`contractVerifierVersion`, and `verificationKeyVersion` together. Upgrade by
publishing a new manifest, verifying hashes in CI, then rolling the manifest
reference to applications after contract verifier compatibility is confirmed.

Avoid silently replacing artifact bytes behind an existing hash or version. A
changed artifact should always produce a new hash and normally a new manifest
version.
