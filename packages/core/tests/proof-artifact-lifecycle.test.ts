import { sha256Digest } from "../src/crypto/hashUtils";
import {
  MemoryProofArtifactCache,
  ProofArtifactContentLoader,
  ProofArtifactDescriptor,
  ProofArtifactLifecycleError,
  ProofArtifactLifecycleErrorCode,
  ProofArtifactLifecycleManager,
  ProofArtifactManifest,
  ProofArtifactRuntimeCompatibility,
} from "../src/artifacts";

class FixtureArtifactLoader implements ProofArtifactContentLoader {
  public fail = false;

  constructor(private readonly fixtures: Record<string, Uint8Array>) {}

  async load(descriptor: ProofArtifactDescriptor): Promise<Uint8Array> {
    if (this.fail) {
      throw new ProofArtifactLifecycleError(
        "offline",
        ProofArtifactLifecycleErrorCode.NETWORK_FETCH_FAILED
      );
    }
    const key =
      descriptor.source.type === "remote" ? descriptor.source.url : descriptor.source.path;
    const bytes = this.fixtures[key];
    if (!bytes) {
      throw new ProofArtifactLifecycleError(
        "missing",
        ProofArtifactLifecycleErrorCode.MISSING_ARTIFACT
      );
    }
    return bytes;
  }
}

const runtime: ProofArtifactRuntimeCompatibility = {
  sdkVersion: "0.1.0",
  circuitVersion: "payroll-v1",
  contractVerifierVersion: "verifier-v1",
  verificationKeyVersion: "vk-v1",
};

async function makeManifest(
  overrides: Partial<ProofArtifactManifest> = {}
): Promise<ProofArtifactManifest> {
  const wasm = new TextEncoder().encode("wasm-bytes");
  const zkey = new TextEncoder().encode("zkey-bytes");
  const vkey = new TextEncoder().encode("verification-key");

  return {
    schemaVersion: "1.0",
    manifestVersion: "2026.07.30",
    circuitId: "private-payroll",
    artifacts: [
      {
        kind: "wasm",
        source: { type: "remote", url: "https://cdn.example/payroll.wasm" },
        sha256: await sha256Digest(wasm),
        sizeBytes: wasm.byteLength,
      },
      {
        kind: "zkey",
        source: { type: "remote", url: "https://cdn.example/payroll.zkey" },
        sha256: await sha256Digest(zkey),
        sizeBytes: zkey.byteLength,
      },
      {
        kind: "verificationKey",
        source: { type: "remote", url: "https://cdn.example/payroll.vkey.json" },
        sha256: await sha256Digest(vkey),
        sizeBytes: vkey.byteLength,
      },
    ],
    compatibility: runtime,
    cachePolicy: { mode: "memory", ttlSeconds: 60, allowStaleFallback: true },
    ...overrides,
  };
}

describe("ProofArtifactLifecycleManager", () => {
  it("loads versioned manifest artifacts and validates hashes", async () => {
    const manifest = await makeManifest();
    const loader = new FixtureArtifactLoader({
      "https://cdn.example/payroll.wasm": new TextEncoder().encode("wasm-bytes"),
      "https://cdn.example/payroll.zkey": new TextEncoder().encode("zkey-bytes"),
      "https://cdn.example/payroll.vkey.json": new TextEncoder().encode("verification-key"),
    });

    const result = await new ProofArtifactLifecycleManager({
      loader,
      cache: new MemoryProofArtifactCache(),
    }).loadArtifacts(manifest, runtime);

    expect(result.artifacts.wasm.bytes.byteLength).toBeGreaterThan(0);
    expect(result.artifacts.zkey.loadedFromCache).toBe(false);
    expect(result.artifacts.verificationKey.descriptor.kind).toBe("verificationKey");
  });

  it("rejects corrupted artifacts by hash", async () => {
    const manifest = await makeManifest();
    const loader = new FixtureArtifactLoader({
      "https://cdn.example/payroll.wasm": new TextEncoder().encode("tampered"),
      "https://cdn.example/payroll.zkey": new TextEncoder().encode("zkey-bytes"),
      "https://cdn.example/payroll.vkey.json": new TextEncoder().encode("verification-key"),
    });

    await expect(
      new ProofArtifactLifecycleManager({ loader }).loadArtifacts(manifest, runtime)
    ).rejects.toMatchObject({
      code: ProofArtifactLifecycleErrorCode.HASH_MISMATCH,
    });
  });

  it("rejects incompatible SDK/circuit/verifier/key versions before proof generation", async () => {
    const manifest = await makeManifest();
    await expect(
      new ProofArtifactLifecycleManager().loadArtifacts(manifest, {
        ...runtime,
        contractVerifierVersion: "verifier-v2",
      })
    ).rejects.toMatchObject({
      code: ProofArtifactLifecycleErrorCode.INCOMPATIBLE_VERSION,
    });
  });

  it("uses stale cache as an offline fallback when policy allows it", async () => {
    let now = 1_800_000_000;
    const manifest = await makeManifest({
      cachePolicy: { mode: "memory", ttlSeconds: 1, allowStaleFallback: true },
    });
    const loader = new FixtureArtifactLoader({
      "https://cdn.example/payroll.wasm": new TextEncoder().encode("wasm-bytes"),
      "https://cdn.example/payroll.zkey": new TextEncoder().encode("zkey-bytes"),
      "https://cdn.example/payroll.vkey.json": new TextEncoder().encode("verification-key"),
    });
    const manager = new ProofArtifactLifecycleManager({
      loader,
      cache: new MemoryProofArtifactCache(),
      now: () => now,
    });

    await manager.loadArtifacts(manifest, runtime);
    now += 2;
    loader.fail = true;

    const result = await manager.loadArtifacts(manifest, runtime);
    expect(result.artifacts.wasm.loadedFromCache).toBe(true);
    expect(result.artifacts.wasm.stale).toBe(true);
  });

  it("rejects manifests with missing required artifacts", async () => {
    const manifest = await makeManifest({ artifacts: [] });

    await expect(
      new ProofArtifactLifecycleManager().loadArtifacts(manifest, runtime)
    ).rejects.toMatchObject({
      code: ProofArtifactLifecycleErrorCode.MISSING_ARTIFACT,
    });
  });
});
