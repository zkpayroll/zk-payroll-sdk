import {
  MemoryProofArtifactCache,
  ProofArtifactLifecycleManager,
  ProofArtifactManifest,
} from "@zk-payroll/core";

const manifest: ProofArtifactManifest = {
  schemaVersion: "1.0",
  manifestVersion: "2026.07.30",
  circuitId: "private-payroll",
  artifacts: [
    {
      kind: "wasm",
      source: { type: "remote", url: "https://cdn.example/payroll.wasm" },
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      kind: "zkey",
      source: { type: "remote", url: "https://cdn.example/payroll.zkey" },
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      kind: "verificationKey",
      source: { type: "remote", url: "https://cdn.example/payroll.vkey.json" },
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    },
  ],
  compatibility: {
    sdkVersion: "0.1.0",
    circuitVersion: "payroll-v1",
    contractVerifierVersion: "verifier-v1",
    verificationKeyVersion: "vk-v1",
  },
};

async function loadArtifacts(): Promise<void> {
  const manager = new ProofArtifactLifecycleManager({
    cache: new MemoryProofArtifactCache(),
  });

  const result = await manager.loadArtifacts(manifest, {
    sdkVersion: "0.1.0",
    circuitVersion: "payroll-v1",
    contractVerifierVersion: "verifier-v1",
    verificationKeyVersion: "vk-v1",
  });

  console.log(`Loaded ${result.artifacts.wasm.bytes.byteLength} WASM bytes`);
}

void loadArtifacts();
