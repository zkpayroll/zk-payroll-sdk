import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { checkProofReadiness, SUPPORTED_PROOF_MODES } from "../src/proof-readiness";
import type { ProofGeneratorConfig } from "../src/crypto/IProofGenerator";

// ── Helpers ──────────────────────────────────────────────────────────────────

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zk-readiness-test-"));
  tempDirs.push(dir);
  return dir;
}

/** Writes valid, non-empty .wasm and .zkey files and returns their paths. */
function writeValidArtifacts(): { wasmPath: string; zkeyPath: string } {
  const dir = makeTempDir();
  const wasmPath = path.join(dir, "payroll.wasm");
  const zkeyPath = path.join(dir, "payroll.zkey");
  fs.writeFileSync(wasmPath, Buffer.alloc(128, 0xab));
  fs.writeFileSync(zkeyPath, Buffer.alloc(256, 0xcd));
  return { wasmPath, zkeyPath };
}

function localConfig(): ProofGeneratorConfig {
  const { wasmPath, zkeyPath } = writeValidArtifacts();
  return { wasmUrl: wasmPath, zkeyUrl: zkeyPath };
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("checkProofReadiness", () => {
  describe("fully-ready state", () => {
    it("reports ready when artifacts, input, config, and mode are all valid", () => {
      const result = checkProofReadiness(
        {
          proofConfig: localConfig(),
          input: { amount: 1000n, recipient: "G...", nullifier: "abc" },
          mode: "groth16",
        },
        {
          requiredInputFields: [
            { name: "amount", type: "bigint" },
            { name: "recipient", type: "string" },
          ],
        }
      );

      expect(result.ready).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every((c) => c.status === "pass")).toBe(true);
    });

    it("accepts remote HTTP(S) artifact URLs without hitting the network", () => {
      const result = checkProofReadiness({
        proofConfig: {
          wasmUrl: "https://cdn.example.com/payroll.wasm",
          zkeyUrl: "https://cdn.example.com/payroll.zkey",
        },
        input: {},
      });

      const artifact = result.checks.find((c) => c.id === "artifact-availability");
      expect(artifact?.status).toBe("pass");
    });

    it("defaults the proof mode to groth16 when none is supplied", () => {
      const result = checkProofReadiness({ proofConfig: localConfig(), input: {} });
      const mode = result.checks.find((c) => c.id === "proof-mode");
      expect(mode?.status).toBe("pass");
      expect(mode?.message).toContain(SUPPORTED_PROOF_MODES[0]);
    });
  });

  describe("missing artifacts", () => {
    it("fails when a local artifact file does not exist", () => {
      const dir = makeTempDir();
      const result = checkProofReadiness({
        proofConfig: {
          wasmUrl: path.join(dir, "does-not-exist.wasm"),
          zkeyUrl: path.join(dir, "missing.zkey"),
        },
        input: {},
      });

      expect(result.ready).toBe(false);
      const artifact = result.failures.find((c) => c.id === "artifact-availability");
      expect(artifact).toBeDefined();
      expect(artifact?.message).toContain("was not found");
      expect(artifact?.remediation).toBeDefined();
    });

    it("fails when a local artifact file is empty (0 bytes)", () => {
      const dir = makeTempDir();
      const wasmPath = path.join(dir, "empty.wasm");
      const zkeyPath = path.join(dir, "ok.zkey");
      fs.writeFileSync(wasmPath, Buffer.alloc(0));
      fs.writeFileSync(zkeyPath, Buffer.alloc(64, 1));

      const result = checkProofReadiness({
        proofConfig: { wasmUrl: wasmPath, zkeyUrl: zkeyPath },
        input: {},
      });

      const artifact = result.checks.find((c) => c.id === "artifact-availability");
      expect(artifact?.status).toBe("fail");
      expect(artifact?.message).toContain("empty");
    });

    it("fails when artifact locations are not configured", () => {
      const result = checkProofReadiness({
        proofConfig: { wasmUrl: "", zkeyUrl: "" },
        input: {},
      });
      expect(result.ready).toBe(false);
      expect(result.failures.some((c) => c.id === "artifact-availability")).toBe(true);
    });

    it("can skip local filesystem probing via checkArtifactFiles: false", () => {
      const dir = makeTempDir();
      const result = checkProofReadiness(
        {
          proofConfig: {
            wasmUrl: path.join(dir, "absent.wasm"),
            zkeyUrl: path.join(dir, "absent.zkey"),
          },
          input: {},
        },
        { checkArtifactFiles: false }
      );

      const artifact = result.checks.find((c) => c.id === "artifact-availability");
      expect(artifact?.status).toBe("pass");
    });
  });

  describe("invalid input", () => {
    it("fails when no proof input is provided", () => {
      const result = checkProofReadiness({ proofConfig: localConfig() });
      const input = result.failures.find((c) => c.id === "input-shape");
      expect(input?.status).toBe("fail");
      expect(input?.message).toContain("No proof input");
    });

    it("fails on missing required fields", () => {
      const result = checkProofReadiness(
        { proofConfig: localConfig(), input: { amount: 1000n } },
        { requiredInputFields: [{ name: "amount" }, { name: "nullifier" }] }
      );
      const input = result.failures.find((c) => c.id === "input-shape");
      expect(input?.status).toBe("fail");
      expect(input?.message).toContain("nullifier");
      expect(input?.message).not.toContain("amount, "); // amount was present
    });

    it("fails on type mismatch and reports expected/actual types only", () => {
      const result = checkProofReadiness(
        { proofConfig: localConfig(), input: { amount: "1000" } },
        { requiredInputFields: [{ name: "amount", type: "bigint" }] }
      );
      const input = result.failures.find((c) => c.id === "input-shape");
      expect(input?.status).toBe("fail");
      expect(input?.message).toContain("expected bigint, got string");
    });

    it("fails when the proof input is an array", () => {
      const result = checkProofReadiness({
        proofConfig: localConfig(),
        input: [1, 2, 3] as unknown as Record<string, unknown>,
      });
      const input = result.failures.find((c) => c.id === "input-shape");
      expect(input?.status).toBe("fail");
      expect(input?.message).toContain("must be an object");
    });
  });

  describe("unsupported proof mode", () => {
    it("fails when the requested mode is not supported", () => {
      const result = checkProofReadiness({
        proofConfig: localConfig(),
        input: {},
        mode: "plonk",
      });
      const mode = result.failures.find((c) => c.id === "proof-mode");
      expect(mode?.status).toBe("fail");
      expect(mode?.message).toContain("plonk");
      expect(mode?.message).toContain("groth16");
    });

    it("honours a custom supportedModes list", () => {
      const result = checkProofReadiness(
        { proofConfig: localConfig(), input: {}, mode: "plonk" },
        { supportedModes: ["groth16", "plonk"] }
      );
      const mode = result.checks.find((c) => c.id === "proof-mode");
      expect(mode?.status).toBe("pass");
    });
  });

  describe("environment settings", () => {
    it("fails on a non-positive maxConcurrency", () => {
      const result = checkProofReadiness({
        proofConfig: { ...localConfig(), maxConcurrency: 0 },
        input: {},
      });
      const env = result.failures.find((c) => c.id === "environment-settings");
      expect(env?.status).toBe("fail");
      expect(env?.message).toContain("maxConcurrency");
    });

    it("fails on a malformed expected hash", () => {
      const result = checkProofReadiness({
        proofConfig: { ...localConfig(), expectedWasmHash: "nothex" },
        input: {},
      });
      const env = result.failures.find((c) => c.id === "environment-settings");
      expect(env?.status).toBe("fail");
      expect(env?.message).toContain("expectedWasmHash");
    });
  });

  describe("security — secret redaction", () => {
    it("never leaks raw proof input values into any result message", () => {
      const secret = "SUPER_SECRET_SALARY_9999";
      const nullifierSecret = "0xdeadbeefsecretnullifier";
      const result = checkProofReadiness(
        {
          proofConfig: localConfig(),
          input: {
            amount: secret,
            recipient: "G_PRIVATE_ADDRESS",
            nullifier: nullifierSecret,
          },
          mode: "groth16",
        },
        {
          requiredInputFields: [
            { name: "amount", type: "bigint" }, // will mismatch: string vs bigint
            { name: "missingSecretField" }, // will be reported missing
          ],
        }
      );

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(nullifierSecret);
      expect(serialized).not.toContain("G_PRIVATE_ADDRESS");

      // But field names / types are still reported for debuggability.
      expect(serialized).toContain("amount");
      expect(serialized).toContain("missingSecretField");
    });
  });
});
