import {
  getProofModeCapabilities,
  getProofModeCapability,
  isProofModeAvailable,
  getAvailableProofModes,
  formatProofModeCapabilities,
  detectEnvironment,
  isWasmSupported,
  isBigIntSupported,
} from "../src/proofs/capabilities";

describe("Proof Mode Capability Map (#285)", () => {
  describe("Environment & Runtime Detection", () => {
    it("detects Node.js runtime environment", () => {
      expect(detectEnvironment()).toBe("node");
    });

    it("detects WebAssembly and BigInt support in current runtime", () => {
      expect(isWasmSupported()).toBe(true);
      expect(isBigIntSupported()).toBe(true);
    });
  });

  describe("Groth16 Capabilities", () => {
    it("reports groth16 as supported and available when prerequisites are met", () => {
      const caps = getProofModeCapabilities({
        network: "testnet",
        hasArtifacts: true,
        hasWasm: true,
      });

      expect(caps.groth16.supported).toBe(true);
      expect(caps.groth16.available).toBe(true);
      expect(caps.groth16.permittedNetworks).toContain("mainnet");
      expect(caps.groth16.permittedNetworks).toContain("testnet");
    });

    it("marks groth16 unavailable with clear remediation when artifacts are missing", () => {
      const caps = getProofModeCapabilities({
        hasArtifacts: false,
      });

      expect(caps.groth16.supported).toBe(true);
      expect(caps.groth16.available).toBe(false);
      expect(caps.groth16.reason).toContain("artifacts");
      expect(caps.groth16.remediation).toContain("artifact downloader");
    });

    it("marks groth16 unavailable when WASM is unsupported", () => {
      const caps = getProofModeCapabilities({
        hasWasm: false,
      });

      expect(caps.groth16.available).toBe(false);
      expect(caps.groth16.reason).toContain("WebAssembly");
    });
  });

  describe("Mock Proving Mode Capabilities", () => {
    it("reports mock mode available on testnet for rapid testing", () => {
      const caps = getProofModeCapabilities({
        network: "testnet",
      });

      expect(caps.mock.supported).toBe(true);
      expect(caps.mock.available).toBe(true);
      expect(caps.mock.performanceTier).toBe("instant");
    });

    it("strictly disallows mock mode on mainnet", () => {
      const caps = getProofModeCapabilities({
        network: "mainnet",
      });

      expect(caps.mock.supported).toBe(true);
      expect(caps.mock.available).toBe(false);
      expect(caps.mock.reason).toContain("Mainnet");
      expect(caps.mock.remediation).toContain("groth16");
    });
  });

  describe("Plonk and Bulletproofs Capabilities", () => {
    it("reports plonk as unsupported in default bundle with adapter remediation", () => {
      const caps = getProofModeCapabilities();
      expect(caps.plonk.supported).toBe(false);
      expect(caps.plonk.available).toBe(false);
      expect(caps.plonk.remediation).toContain("plonk-adapter");
    });

    it("reports bulletproofs as unsupported due to smart contract verifiers", () => {
      const caps = getProofModeCapabilities();
      expect(caps.bulletproofs.supported).toBe(false);
      expect(caps.bulletproofs.available).toBe(false);
      expect(caps.bulletproofs.reason).toContain("Soroban");
    });
  });

  describe("Capability Query Utilities", () => {
    it("fetches single mode capability via getProofModeCapability", () => {
      const cap = getProofModeCapability("groth16", { hasArtifacts: true });
      expect(cap).toBeDefined();
      expect(cap?.mode).toBe("groth16");
    });

    it("queries isProofModeAvailable predicate", () => {
      expect(isProofModeAvailable("groth16", { hasArtifacts: true, hasWasm: true })).toBe(true);
      expect(isProofModeAvailable("mock", { network: "mainnet" })).toBe(false);
      expect(isProofModeAvailable("plonk")).toBe(false);
      expect(isProofModeAvailable("unknown_mode")).toBe(false);
    });

    it("lists available modes via getAvailableProofModes", () => {
      const testnetModes = getAvailableProofModes({
        network: "testnet",
        hasArtifacts: true,
        hasWasm: true,
      });
      expect(testnetModes).toContain("groth16");
      expect(testnetModes).toContain("mock");

      const mainnetModes = getAvailableProofModes({
        network: "mainnet",
        hasArtifacts: true,
        hasWasm: true,
      });
      expect(mainnetModes).toContain("groth16");
      expect(mainnetModes).not.toContain("mock");
    });

    it("formats capability map into readable diagnostic summary", () => {
      const caps = getProofModeCapabilities();
      const output = formatProofModeCapabilities(caps);

      expect(output).toContain("ZkPayroll Proof Mode Capabilities");
      expect(output).toContain("[GROTH16]");
      expect(output).toContain("[MOCK]");
      expect(output).toContain("[PLONK]");
    });
  });
});
