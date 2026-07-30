# Proof Artifact Loading Example

This example shows the expected lifecycle-management flow for integrators:

1. Fetch or read a pinned `ProofArtifactManifest`.
2. Call `ProofArtifactLifecycleManager.loadArtifacts()`.
3. Pass verified artifact bytes to proof-generation infrastructure.

See `load.ts` for a minimal TypeScript example.
