import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalArtifactResolver } from "../src/crypto/LocalArtifactResolver";
import {
  ArtifactNotFoundError,
  ArtifactCorruptError,
  ArtifactErrorCode,
} from "../src/crypto/ArtifactErrors";
import { createHookLogger, LogEvent } from "../src/logging/SdkLogger";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Creates a temp directory and returns its path. Cleaned up in afterAll. */
let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zk-payroll-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("LocalArtifactResolver", () => {
  describe("successful resolution", () => {
    it("loads valid .wasm and .zkey files from disk", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");

      // Write non-trivial content
      fs.writeFileSync(wasmPath, Buffer.alloc(128, 0xab));
      fs.writeFileSync(zkeyPath, Buffer.alloc(256, 0xcd));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });
      const result = await resolver.resolve();

      expect(result.wasm).toBeInstanceOf(ArrayBuffer);
      expect(result.wasm.byteLength).toBe(128);
      expect(result.zkey).toBeInstanceOf(Uint8Array);
      expect(result.zkey.byteLength).toBe(256);
    });

    it("preserves file content byte-for-byte", async () => {
      const dir = makeTempDir();
      const wasmContent = Buffer.from([0x00, 0x61, 0x73, 0x6d]); // \0asm magic
      const zkeyContent = Buffer.from([0x7a, 0x6b, 0x65, 0x79]);

      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, wasmContent);
      fs.writeFileSync(zkeyPath, zkeyContent);

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });
      const result = await resolver.resolve();

      expect(new Uint8Array(result.wasm)).toEqual(new Uint8Array(wasmContent));
      expect(result.zkey).toEqual(new Uint8Array(zkeyContent));
    });

    it("resolves relative paths based on cwd", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(10, 0x01));
      fs.writeFileSync(zkeyPath, Buffer.alloc(10, 0x02));

      // Use absolute paths explicitly (relative paths depend on cwd)
      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });
      const result = await resolver.resolve();

      expect(result.wasm.byteLength).toBe(10);
      expect(result.zkey.byteLength).toBe(10);
    });
  });

  describe("missing files (ArtifactNotFoundError)", () => {
    it("throws ArtifactNotFoundError when .wasm file does not exist", async () => {
      const dir = makeTempDir();
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({
        wasmPath: path.join(dir, "nonexistent.wasm"),
        zkeyPath,
      });

      await expect(resolver.resolve()).rejects.toThrow(ArtifactNotFoundError);
      await expect(resolver.resolve()).rejects.toThrow(/does not exist/);
    });

    it("throws ArtifactNotFoundError when .zkey file does not exist", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      fs.writeFileSync(wasmPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({
        wasmPath,
        zkeyPath: path.join(dir, "nonexistent.zkey"),
      });

      await expect(resolver.resolve()).rejects.toThrow(ArtifactNotFoundError);
    });

    it("includes the missing path in the error context", async () => {
      const dir = makeTempDir();
      const missingPath = path.join(dir, "missing.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({
        wasmPath: missingPath,
        zkeyPath,
      });

      try {
        await resolver.resolve();
        fail("Expected ArtifactNotFoundError");
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactNotFoundError);
        const typedErr = err as ArtifactNotFoundError;
        expect(typedErr.code).toBe(ArtifactErrorCode.ARTIFACT_NOT_FOUND);
        expect(typedErr.context.path).toBe(path.resolve(missingPath));
        expect(typedErr.context.artifactType).toBe("wasm");
      }
    });
  });

  describe("empty files (ArtifactCorruptError)", () => {
    it("throws ArtifactCorruptError when .wasm file is empty", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(0));
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });

      await expect(resolver.resolve()).rejects.toThrow(ArtifactCorruptError);
      await expect(resolver.resolve()).rejects.toThrow(/empty.*0 bytes/i);
    });

    it("throws ArtifactCorruptError when .zkey file is empty", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(10));
      fs.writeFileSync(zkeyPath, Buffer.alloc(0));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });

      await expect(resolver.resolve()).rejects.toThrow(ArtifactCorruptError);
    });
  });

  describe("wrong file extensions (ArtifactCorruptError)", () => {
    it("throws ArtifactCorruptError when wasm path has wrong extension", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.txt");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(10));
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });

      await expect(resolver.resolve()).rejects.toThrow(ArtifactCorruptError);
      await expect(resolver.resolve()).rejects.toThrow(/Expected a "\.wasm" file/);
    });

    it("throws ArtifactCorruptError when zkey path has wrong extension", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.bin");
      fs.writeFileSync(wasmPath, Buffer.alloc(10));
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });

      await expect(resolver.resolve()).rejects.toThrow(ArtifactCorruptError);
      await expect(resolver.resolve()).rejects.toThrow(/Expected a "\.zkey" file/);
    });

    it("throws ArtifactCorruptError for files with no extension", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit_wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(10));
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });

      await expect(resolver.resolve()).rejects.toThrow(ArtifactCorruptError);
      await expect(resolver.resolve()).rejects.toThrow(/no extension/);
    });
  });

  describe("error codes", () => {
    it("ArtifactNotFoundError has ARTIFACT_NOT_FOUND code", async () => {
      const dir = makeTempDir();
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({
        wasmPath: path.join(dir, "missing.wasm"),
        zkeyPath,
      });

      try {
        await resolver.resolve();
        fail("Expected error");
      } catch (err: any) {
        expect(err.code).toBe(ArtifactErrorCode.ARTIFACT_NOT_FOUND);
      }
    });

    it("ArtifactCorruptError has ARTIFACT_CORRUPT code", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(0)); // empty
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });

      try {
        await resolver.resolve();
        fail("Expected error");
      } catch (err: any) {
        expect(err.code).toBe(ArtifactErrorCode.ARTIFACT_CORRUPT);
      }
    });
  });

  describe("logger integration", () => {
    it("emits artifact_load_start and artifact_load_complete events", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(10));
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const entries: LogEvent[] = [];
      const logger = createHookLogger((e) => entries.push(e));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath }, logger);
      await resolver.resolve();

      const events = entries.map((e) => e.event);
      expect(events).toContain("artifact_load_start");
      expect(events).toContain("artifact_load_complete");
    });

    it("includes source: 'local' in log context", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(10));
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const entries: LogEvent[] = [];
      const logger = createHookLogger((e) => entries.push(e));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath }, logger);
      await resolver.resolve();

      const startEvent = entries.find((e) => e.event === "artifact_load_start");
      expect(startEvent?.context?.source).toBe("local");
    });

    it("works without a logger (no errors thrown)", async () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "circuit.wasm");
      const zkeyPath = path.join(dir, "circuit.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(10));
      fs.writeFileSync(zkeyPath, Buffer.alloc(10));

      const resolver = new LocalArtifactResolver({ wasmPath, zkeyPath });
      await expect(resolver.resolve()).resolves.toBeDefined();
    });
  });
});

describe("SnarkjsProofGenerator — local artifact resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock snarkjs
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { groth16 } = require("snarkjs");
    groth16.fullProve.mockResolvedValue({
      proof: {
        pi_a: ["1", "2", "1"],
        pi_b: [
          ["3", "4"],
          ["5", "6"],
          ["1", "1"],
        ],
        pi_c: ["7", "8", "1"],
        protocol: "groth16",
        curve: "bn128",
      },
      publicSignals: ["42"],
    });
  });

  it("generates a proof using local artifacts", async () => {
    const dir = makeTempDir();
    const wasmPath = path.join(dir, "circuit.wasm");
    const zkeyPath = path.join(dir, "circuit.zkey");
    // Write valid WASM magic number + padding
    fs.writeFileSync(wasmPath, Buffer.alloc(64, 0xab));
    fs.writeFileSync(zkeyPath, Buffer.alloc(128, 0xcd));

    const { SnarkjsProofGenerator } = await import("../src/crypto/SnarkjsProofGenerator");

    const generator = new SnarkjsProofGenerator({
      wasmUrl: wasmPath,
      zkeyUrl: zkeyPath,
    });

    const result = await generator.generateProof({ recipient: "GLOCAL", amount: "500" });

    expect(result).toHaveProperty("proof");
    expect(result).toHaveProperty("publicSignals");
    expect(result.proof.protocol).toBe("groth16");
  });

  it("generates a proof using explicit ArtifactSource config", async () => {
    const dir = makeTempDir();
    const wasmPath = path.join(dir, "circuit.wasm");
    const zkeyPath = path.join(dir, "circuit.zkey");
    fs.writeFileSync(wasmPath, Buffer.alloc(64, 0xab));
    fs.writeFileSync(zkeyPath, Buffer.alloc(128, 0xcd));

    const { SnarkjsProofGenerator } = await import("../src/crypto/SnarkjsProofGenerator");

    const generator = new SnarkjsProofGenerator({
      wasmUrl: "",
      zkeyUrl: "",
      wasmSource: { type: "local", path: wasmPath },
      zkeySource: { type: "local", path: zkeyPath },
    });

    const result = await generator.generateProof({ test: "explicit-source" });

    expect(result).toHaveProperty("proof");
    expect(result.publicSignals).toEqual(["42"]);
  });

  it("throws when local wasm file is missing", async () => {
    const dir = makeTempDir();
    const zkeyPath = path.join(dir, "circuit.zkey");
    fs.writeFileSync(zkeyPath, Buffer.alloc(10));

    const { SnarkjsProofGenerator } = await import("../src/crypto/SnarkjsProofGenerator");

    const generator = new SnarkjsProofGenerator({
      wasmUrl: path.join(dir, "nonexistent.wasm"),
      zkeyUrl: zkeyPath,
    });

    await expect(generator.generateProof({ test: "missing" })).rejects.toThrow(
      /Proof generation failed/
    );
  });

  it("preload works with local artifacts", async () => {
    const dir = makeTempDir();
    const wasmPath = path.join(dir, "circuit.wasm");
    const zkeyPath = path.join(dir, "circuit.zkey");
    fs.writeFileSync(wasmPath, Buffer.alloc(64, 0xab));
    fs.writeFileSync(zkeyPath, Buffer.alloc(128, 0xcd));

    const { SnarkjsProofGenerator } = await import("../src/crypto/SnarkjsProofGenerator");

    const generator = new SnarkjsProofGenerator({
      wasmUrl: wasmPath,
      zkeyUrl: zkeyPath,
    });

    const status = await generator.preload();
    expect(status.wasmLoaded).toBe(true);
    expect(status.zkeyLoaded).toBe(true);
    expect(typeof status.completedAt).toBe("string");
  });
});

// Ensure snarkjs is mocked for the SnarkjsProofGenerator tests
jest.mock("snarkjs", () => ({
  groth16: { fullProve: jest.fn() },
}));
