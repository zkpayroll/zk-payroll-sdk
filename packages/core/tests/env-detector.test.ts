import { detectEnvironment, canRunOperation, listOperations } from "../src/env";

describe("Environment Capability Detector", () => {
  describe("detectEnvironment", () => {
    it("returns a valid RuntimeEnvironment", () => {
      const env = detectEnvironment();
      expect(["browser", "worker", "node", "unknown"]).toContain(env.environment);
    });

    it("returns a Set of capabilities", () => {
      const env = detectEnvironment();
      expect(env.capabilities).toBeInstanceOf(Set);
    });

    it("returns boolean flags for key capabilities", () => {
      const env = detectEnvironment();
      expect(typeof env.hasWalletSupport).toBe("boolean");
      expect(typeof env.hasWasm).toBe("boolean");
      expect(typeof env.hasCrypto).toBe("boolean");
    });

    it("detects the current runtime environment in the test runner", () => {
      const env = detectEnvironment();
      // Node's jest reports "node"; the jsdom-based browser config reports "browser".
      const inBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
      expect(env.environment).toBe(inBrowser ? "browser" : "node");
    });

    it("Node.js has rpc_call capability", () => {
      const env = detectEnvironment();
      if (env.environment === "node") {
        expect(env.capabilities.has("rpc_call")).toBe(true);
      }
    });

    it("Node.js has file_system capability", () => {
      const env = detectEnvironment();
      if (env.environment === "node") {
        expect(env.capabilities.has("file_system")).toBe(true);
      }
    });

    it("Node.js does not have wallet_connection", () => {
      const env = detectEnvironment();
      if (env.environment === "node") {
        expect(env.capabilities.has("wallet_connection")).toBe(false);
      }
    });

    it("Node.js does not have localStorage", () => {
      const env = detectEnvironment();
      if (env.environment === "node") {
        expect(env.capabilities.has("localStorage")).toBe(false);
      }
    });
  });

  describe("canRunOperation", () => {
    it("returns supported=true for operations available in current env", () => {
      const result = canRunOperation("submitPayment");
      expect(result.supported).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it("returns supported=false with missing capabilities", () => {
      // Deterministic regardless of the test environment: the jsdom browser
      // config advertises wallet_connection, so a Node-like environment is
      // supplied to assert the missing-capability path.
      const result = canRunOperation("connectWallet", {
        environment: "node",
        capabilities: new Set(["rpc_call", "file_system"]),
        hasWalletSupport: false,
        hasWasm: false,
        hasCrypto: false,
      });
      expect(result.supported).toBe(false);
      expect(result.missing).toContain("wallet_connection");
    });

    it("returns supported=false for unknown operations", () => {
      const result = canRunOperation("nonExistentOperation");
      expect(result.supported).toBe(false);
    });

    it("reports requiresBackend correctly", () => {
      const submitResult = canRunOperation("submitPayment");
      expect(submitResult.requiresBackend).toBe(true);

      const summarizeResult = canRunOperation("summarizeTransaction");
      expect(summarizeResult.requiresBackend).toBe(false);
    });

    it("accepts pre-detected environment", () => {
      const env = detectEnvironment();
      const result = canRunOperation("submitPayment", env);
      expect(result.supported).toBe(true);
    });
  });

  describe("listOperations", () => {
    it("returns an array of operations", () => {
      const ops = listOperations();
      expect(Array.isArray(ops)).toBe(true);
      expect(ops.length).toBeGreaterThan(0);
    });

    it("each operation has required fields", () => {
      const ops = listOperations();
      for (const op of ops) {
        expect(typeof op.operation).toBe("string");
        expect(Array.isArray(op.requiredCapabilities)).toBe(true);
        expect(typeof op.requiresBackend).toBe("boolean");
      }
    });
  });
});
