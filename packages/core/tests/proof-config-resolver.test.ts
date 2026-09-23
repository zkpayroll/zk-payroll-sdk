import { resolveProofConfig, resolveProofConfigFromEnv } from "../src/crypto/ProofConfigResolver";
import { ValidationError } from "../src/errors";

describe("ProofConfigResolver (Issue #229)", () => {
  it("resolves config from explicit options when provided", () => {
    const config = resolveProofConfig({
      wasmUrl: "https://cdn.example.com/payroll.wasm",
      zkeyUrl: "https://cdn.example.com/payroll.zkey",
      expectedWasmHash: "hash123",
    });

    expect(config.wasmUrl).toBe("https://cdn.example.com/payroll.wasm");
    expect(config.zkeyUrl).toBe("https://cdn.example.com/payroll.zkey");
    expect(config.expectedWasmHash).toBe("hash123");
  });

  it("resolves config from environment variables", () => {
    const customEnv = {
      ZK_PAYROLL_WASM_PATH: "./custom/path.wasm",
      ZK_PAYROLL_ZKEY_PATH: "./custom/path.zkey",
      ZK_PAYROLL_EXPECTED_WASM_HASH: "envwasmhash",
      ZK_PAYROLL_EXPECTED_ZKEY_HASH: "envzkeyhash",
    };

    const config = resolveProofConfigFromEnv(customEnv);

    expect(config.wasmUrl).toBe("./custom/path.wasm");
    expect(config.zkeyUrl).toBe("./custom/path.zkey");
    expect(config.expectedWasmHash).toBe("envwasmhash");
    expect(config.expectedZkeyHash).toBe("envzkeyhash");
  });

  it("falls back to default artifact directory when env/options are omitted", () => {
    const config = resolveProofConfig({}, {});

    expect(config.wasmUrl).toBe("./circuits/payroll.wasm");
    expect(config.zkeyUrl).toBe("./circuits/payroll.zkey");
  });

  it("throws ValidationError if resolved config is malformed or invalid", () => {
    expect(() =>
      resolveProofConfig({
        wasmUrl: "http://malformed url with spaces",
        zkeyUrl: "https://example.com/payroll.zkey",
      })
    ).toThrow(ValidationError);
  });
});
