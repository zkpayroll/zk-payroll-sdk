import type { EnvironmentCapabilities } from "../src/env";
import {
  generateIntegrationHealthReport,
  INTEGRATION_HEALTH_SECTIONS,
  IntegrationHealthReportInput,
  IntegrationHealthStatus,
} from "../src/health";

const VALID_CONTRACT_ID = "CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC";

function healthyEnvironment(): EnvironmentCapabilities {
  return {
    environment: "browser",
    capabilities: new Set([
      "fetch",
      "rpc_call",
      "wallet_connection",
      "proof_generation",
      "wasm",
      "crypto.getRandomValues",
    ]),
    hasWalletSupport: true,
    hasWasm: true,
    hasCrypto: true,
  };
}

function healthyInput(
  overrides: Partial<IntegrationHealthReportInput> = {}
): IntegrationHealthReportInput {
  return {
    config: {
      networkUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      contractId: VALID_CONTRACT_ID,
      proofConfig: {
        wasmUrl: "https://artifacts.example/circuit.wasm",
        zkeyUrl: "https://artifacts.example/circuit.zkey",
      },
    },
    environment: healthyEnvironment(),
    proof: { input: {}, mode: "groth16" },
    wallet: { isAvailable: jest.fn(() => true), isConnected: true },
    ...overrides,
  };
}

function statusFor(
  report: ReturnType<typeof generateIntegrationHealthReport>,
  section: (typeof INTEGRATION_HEALTH_SECTIONS)[number]
): string | undefined {
  return report.sections.find((result) => result.section === section)?.status;
}

describe("generateIntegrationHealthReport", () => {
  it("runs all five SDK-owned checks and reports a healthy integration", () => {
    const report = generateIntegrationHealthReport(healthyInput());

    expect(report.status).toBe(IntegrationHealthStatus.HEALTHY);
    expect(report.sections.map((section) => section.section)).toEqual(INTEGRATION_HEALTH_SECTIONS);
    expect(report.sections.every((section) => section.status === "healthy")).toBe(true);
  });

  it("reports degraded when a supported wallet is available but disconnected", () => {
    const wallet = { isAvailable: jest.fn(() => true), isConnected: false };
    const report = generateIntegrationHealthReport(healthyInput({ wallet }));

    expect(report.status).toBe(IntegrationHealthStatus.DEGRADED);
    expect(statusFor(report, "wallet")).toBe(IntegrationHealthStatus.DEGRADED);
    expect(wallet.isAvailable).toHaveBeenCalledTimes(1);
  });

  it("maps unavailable runtime capabilities to fixed section outcomes", () => {
    const environment: EnvironmentCapabilities = {
      environment: "worker",
      capabilities: new Set(["wasm", "crypto.getRandomValues"]),
      hasWalletSupport: false,
      hasWasm: true,
      hasCrypto: true,
    };
    const report = generateIntegrationHealthReport(healthyInput({ environment }));

    expect(report.status).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "network")).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "proofs")).toBe(IntegrationHealthStatus.DEGRADED);
    expect(statusFor(report, "wallet")).toBe(IntegrationHealthStatus.DEGRADED);
  });

  it("maps malformed config, URL, contract, and proof inputs to safe failures", () => {
    const report = generateIntegrationHealthReport({
      ...healthyInput(),
      config: {
        networkUrl: "credential-secret invalid-url",
        contractId: "private-contract-secret",
        proofConfig: { wasmUrl: "proof-secret" } as never,
        featureFlags: { "private-feature-secret": "yes" as never },
      },
      proof: { input: { salary: "private-payroll-secret" }, mode: "unknown-secret-mode" },
    });

    expect(report.status).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "config")).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "network")).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "contracts")).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "proofs")).toBe(IntegrationHealthStatus.FAILED);
    expect(report.sections.filter((section) => section.status === "failed")).toHaveLength(4);
    expect(report.sections.find((section) => section.section === "contracts")?.remediation).toBe(
      "Provide valid required Soroban contract identifiers."
    );
  });

  it("never exposes comprehensive sentinels from any high-level input", () => {
    const sentinels = [
      "URL_USER_SECRET",
      "URL_TOKEN_SECRET",
      "ADMIN_KEY_SECRET",
      "CONTRACT_KEY_SECRET",
      "CONTRACT_VALUE_SECRET",
      "ARTIFACT_SECRET",
      "PAYROLL_INPUT_SECRET",
      "PROOF_FIELD_SECRET",
      "WALLET_THROW_SECRET",
    ];
    const report = generateIntegrationHealthReport({
      config: {
        networkUrl: "https://URL_USER_SECRET@rpc.example/?token=URL_TOKEN_SECRET",
        contractIds: { CONTRACT_KEY_SECRET: "CONTRACT_VALUE_SECRET" },
        adminKey: "ADMIN_KEY_SECRET",
        proofConfig: {
          wasmUrl: "https://ARTIFACT_SECRET@artifacts.example/circuit.wasm",
          zkeyUrl: "https://artifacts.example/circuit.zkey?token=ARTIFACT_SECRET",
        },
      },
      environment: healthyEnvironment(),
      proof: {
        input: {
          salary: "PAYROLL_INPUT_SECRET",
          recipient: "PROOF_FIELD_SECRET",
        },
        options: {
          requiredInputFields: [{ name: "PROOF_FIELD_SECRET", type: "bigint" }],
        },
      },
      wallet: {
        isAvailable: () => {
          throw new Error("WALLET_THROW_SECRET");
        },
        isConnected: false,
      },
    });

    const serialized = JSON.stringify(report);
    for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain("Error");
  });

  it("maps invalid runtime inputs to generic failures without leaking values", () => {
    const runtimeSecret = "INVALID_RUNTIME_SECRET";
    const input = healthyInput({
      environment: {
        environment: runtimeSecret,
        capabilities: ["rpc_call", runtimeSecret],
        hasWalletSupport: runtimeSecret,
        hasWasm: true,
        hasCrypto: true,
      } as never,
    });
    const report = generateIntegrationHealthReport(input);

    expect(report.status).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "network")).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "proofs")).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "wallet")).toBe(IntegrationHealthStatus.FAILED);
    expect(JSON.stringify(report)).not.toContain(runtimeSecret);
  });

  it("only observes wallet availability and connection state", () => {
    const wallet = {
      isAvailable: jest.fn(() => true),
      isConnected: true,
      connect: jest.fn(),
      signTransaction: jest.fn(),
      signAndSubmitTransaction: jest.fn(),
      disconnect: jest.fn(),
    };
    const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    const fetchDouble = jest.fn();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchDouble,
    });

    try {
      const report = generateIntegrationHealthReport(healthyInput({ wallet }));

      expect(report.status).toBe(IntegrationHealthStatus.HEALTHY);
      expect(wallet.isAvailable).toHaveBeenCalledTimes(1);
      expect(wallet.connect).not.toHaveBeenCalled();
      expect(wallet.signTransaction).not.toHaveBeenCalled();
      expect(wallet.signAndSubmitTransaction).not.toHaveBeenCalled();
      expect(wallet.disconnect).not.toHaveBeenCalled();
      expect(fetchDouble).not.toHaveBeenCalled();
    } finally {
      if (originalFetchDescriptor) {
        Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
      } else {
        delete (globalThis as { fetch?: typeof fetch }).fetch;
      }
    }
  });

  it("uses fixed failures for invalid wallet runtime values", () => {
    const report = generateIntegrationHealthReport(
      healthyInput({
        wallet: {
          isAvailable: () => "yes",
          isConnected: "connected",
        } as never,
      })
    );

    expect(report.status).toBe(IntegrationHealthStatus.FAILED);
    expect(statusFor(report, "wallet")).toBe(IntegrationHealthStatus.FAILED);
  });
});
