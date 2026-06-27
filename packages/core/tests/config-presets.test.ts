import {
  localPreset,
  testnetPreset,
  productionPreset,
  validateConfig,
  SdkConfig,
} from "../src/config-presets";
import { ValidationError } from "../src/errors";

const VALID_CONFIG: SdkConfig = {
  networkUrl: "https://soroban-testnet.stellar.org",
  contractId: "CABC123",
  wasmUrl: "https://cdn.example.com/payroll_circuit.wasm",
  zkeyUrl: "https://cdn.example.com/payroll_circuit.zkey",
};

describe("localPreset", () => {
  it("returns a config with localhost networkUrl", () => {
    expect(localPreset().networkUrl).toMatch(/^http:\/\/localhost/);
  });

  it("returns localhost wasmUrl and zkeyUrl", () => {
    const cfg = localPreset();
    expect(cfg.wasmUrl).toMatch(/^http:\/\/localhost/);
    expect(cfg.zkeyUrl).toMatch(/^http:\/\/localhost/);
  });

  it("applies overrides", () => {
    const cfg = localPreset({ contractId: "CLOCAL123" });
    expect(cfg.contractId).toBe("CLOCAL123");
  });

  it("override does not mutate other fields", () => {
    const cfg = localPreset({ contractId: "CLOCAL123" });
    expect(cfg.networkUrl).toMatch(/^http:\/\/localhost/);
  });
});

describe("testnetPreset", () => {
  it("returns the public testnet RPC URL", () => {
    expect(testnetPreset().networkUrl).toBe(
      "https://soroban-testnet.stellar.org"
    );
  });

  it("returns testnet CDN URLs for artifacts", () => {
    const cfg = testnetPreset();
    expect(cfg.wasmUrl).toContain("testnet");
    expect(cfg.zkeyUrl).toContain("testnet");
  });

  it("applies overrides", () => {
    const cfg = testnetPreset({ contractId: "CTESTNET456" });
    expect(cfg.contractId).toBe("CTESTNET456");
    expect(cfg.networkUrl).toBe("https://soroban-testnet.stellar.org");
  });
});

describe("productionPreset", () => {
  it("returns the public mainnet RPC URL", () => {
    expect(productionPreset().networkUrl).toBe("https://soroban.stellar.org");
  });

  it("returns mainnet CDN URLs for artifacts", () => {
    const cfg = productionPreset();
    expect(cfg.wasmUrl).toContain("mainnet");
    expect(cfg.zkeyUrl).toContain("mainnet");
  });

  it("applies overrides including contractId", () => {
    const cfg = productionPreset({ contractId: "CPROD789" });
    expect(cfg.contractId).toBe("CPROD789");
    expect(cfg.networkUrl).toBe("https://soroban.stellar.org");
  });
});

describe("validateConfig", () => {
  it("passes a fully populated config without throwing", () => {
    expect(() => validateConfig(VALID_CONFIG)).not.toThrow();
  });

  it.each(["networkUrl", "contractId", "wasmUrl", "zkeyUrl"] as const)(
    'throws ValidationError when "%s" is empty string',
    (field) => {
      const cfg = { ...VALID_CONFIG, [field]: "" };
      expect(() => validateConfig(cfg)).toThrow(ValidationError);
    }
  );

  it.each(["networkUrl", "contractId", "wasmUrl", "zkeyUrl"] as const)(
    'throws ValidationError when "%s" is whitespace',
    (field) => {
      const cfg = { ...VALID_CONFIG, [field]: "   " };
      expect(() => validateConfig(cfg)).toThrow(ValidationError);
    }
  );

  it("error message identifies the missing field", () => {
    const cfg = { ...VALID_CONFIG, contractId: "" };
    expect(() => validateConfig(cfg)).toThrow(/contractId/);
  });

  it("error has code INVALID_CONFIG", () => {
    const cfg = { ...VALID_CONFIG, wasmUrl: "" };
    try {
      validateConfig(cfg);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("INVALID_CONFIG");
    }
  });

  it("error exposes the field name", () => {
    const cfg = { ...VALID_CONFIG, zkeyUrl: "" };
    try {
      validateConfig(cfg);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe("zkeyUrl");
    }
  });

  it("is compatible with preset output after adding required fields", () => {
    const cfg = testnetPreset({ contractId: "CABC123" });
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it("preset without contractId fails validation", () => {
    const cfg = productionPreset(); // contractId is ""
    expect(() => validateConfig(cfg)).toThrow(ValidationError);
  });
});
