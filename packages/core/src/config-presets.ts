import { ValidationError } from "./errors";
import { ClientConfig } from "./config";

/**
 * Full SDK configuration including proof artifact locations.
 */
export interface SdkConfig extends ClientConfig {
  /** URL or path to the circuit .wasm file */
  wasmUrl: string;
  /** URL or path to the proving key .zkey file */
  zkeyUrl: string;
}

// ── Preset factories ─────────────────────────────────────────────────────────

/**
 * Local development preset.
 * Assumes a local Soroban network (e.g. `stellar-quickstart`) on port 8000
 * and circuit artifacts served from localhost.
 */
export function localPreset(overrides: Partial<SdkConfig> = {}): SdkConfig {
  return {
    networkUrl: "http://localhost:8000/soroban/rpc",
    contractId: "",
    wasmUrl: "http://localhost:3000/payroll_circuit.wasm",
    zkeyUrl: "http://localhost:3000/payroll_circuit.zkey",
    ...overrides,
  };
}

/**
 * Stellar Testnet preset.
 * Uses the public Soroban testnet RPC and a CDN for circuit artifacts.
 */
export function testnetPreset(overrides: Partial<SdkConfig> = {}): SdkConfig {
  return {
    networkUrl: "https://soroban-testnet.stellar.org",
    contractId: "",
    wasmUrl: "https://cdn.zkpayroll.dev/testnet/payroll_circuit.wasm",
    zkeyUrl: "https://cdn.zkpayroll.dev/testnet/payroll_circuit.zkey",
    ...overrides,
  };
}

/**
 * Production (Mainnet) preset.
 * Uses the public Soroban mainnet RPC and production CDN artifacts.
 * A `contractId` MUST be supplied via `overrides`.
 */
export function productionPreset(
  overrides: Partial<SdkConfig> = {}
): SdkConfig {
  return {
    networkUrl: "https://soroban.stellar.org",
    contractId: "",
    wasmUrl: "https://cdn.zkpayroll.dev/mainnet/payroll_circuit.wasm",
    zkeyUrl: "https://cdn.zkpayroll.dev/mainnet/payroll_circuit.zkey",
    ...overrides,
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof SdkConfig)[] = [
  "networkUrl",
  "contractId",
  "wasmUrl",
  "zkeyUrl",
];

/**
 * Validate an SdkConfig, throwing a `ValidationError` for the first missing
 * or blank required field.
 *
 * @throws {ValidationError} if any required field is absent or empty.
 */
export function validateConfig(config: SdkConfig): void {
  for (const field of REQUIRED_FIELDS) {
    const value = config[field];
    if (!value || (typeof value === "string" && value.trim() === "")) {
      throw new ValidationError(
        `Config field "${field}" is required and must not be empty`,
        field,
        "INVALID_CONFIG"
      );
    }
  }
}
