import { validateConfig } from "../config";
import type { ClientConfig, ConfigValidationResult } from "../config";
import { detectEnvironment, NetworkCapabilityGuard } from "../env";
import type { Capability, EnvironmentCapabilities, RuntimeEnvironment } from "../env";
import { checkProofReadiness } from "../proof-readiness";
import {
  INTEGRATION_HEALTH_SECTIONS,
  IntegrationHealthReport,
  IntegrationHealthReportInput,
  IntegrationHealthSection,
  IntegrationHealthSectionResult,
  IntegrationHealthStatus,
  IntegrationHealthWallet,
} from "./types";

interface SafeHealthCopy {
  message: string;
  remediation?: string;
}

interface ConfigInspection {
  usable: boolean;
  result: ConfigValidationResult;
}

interface EnvironmentInspection {
  usable: boolean;
  value?: EnvironmentCapabilities;
}

const SAFE_HEALTH_COPY: Record<
  IntegrationHealthSection,
  Record<IntegrationHealthStatus, SafeHealthCopy>
> = {
  config: {
    healthy: { message: "SDK configuration is ready." },
    degraded: {
      message: "SDK configuration has a non-blocking concern.",
      remediation: "Review optional configuration values before payroll execution.",
    },
    failed: {
      message: "SDK configuration is not ready.",
      remediation: "Correct missing or invalid required SDK configuration values.",
    },
  },
  network: {
    healthy: { message: "Network readiness check passed." },
    degraded: {
      message: "Network readiness is degraded.",
      remediation: "Review the selected network and RPC capability before execution.",
    },
    failed: {
      message: "Network readiness check failed.",
      remediation: "Select a valid RPC URL and a runtime with RPC capability.",
    },
  },
  contracts: {
    healthy: { message: "Contract configuration is ready." },
    degraded: {
      message: "Contract configuration has a non-blocking concern.",
      remediation: "Review optional contract configuration for the selected network.",
    },
    failed: {
      message: "Contract configuration is not ready.",
      remediation: "Provide valid required Soroban contract identifiers.",
    },
  },
  proofs: {
    healthy: { message: "Proof generation prerequisites are ready." },
    degraded: {
      message: "Proof readiness has a non-blocking concern.",
      remediation: "Use a proof-capable runtime before generating a proof.",
    },
    failed: {
      message: "Proof generation prerequisites are not ready.",
      remediation: "Correct proof settings, input shape, mode, and artifact locations.",
    },
  },
  wallet: {
    healthy: { message: "Wallet capability check passed." },
    degraded: {
      message: "Wallet capability is limited.",
      remediation: "Use an available wallet adapter and connect it before wallet operations.",
    },
    failed: {
      message: "Wallet capability check failed.",
      remediation: "Provide a valid passive wallet capability view.",
    },
  },
};

const NETWORK_FIELDS = ["networkUrl", "network"] as const;
const CONTRACT_FIELDS = ["contractId", "contractIds"] as const;
const PROOF_FIELDS = ["proofConfig"] as const;
const RUNTIME_ENVIRONMENTS = new Set<RuntimeEnvironment>(["browser", "worker", "node", "unknown"]);
const CAPABILITIES = new Set<Capability>([
  "wallet_connection",
  "proof_generation",
  "rpc_call",
  "file_system",
  "web_worker",
  "localStorage",
  "indexedDB",
  "crypto.getRandomValues",
  "wasm",
  "fetch",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failedValidation(field: string): ConfigValidationResult {
  return { isValid: false, errors: [{ field, message: "Invalid health report input." }] };
}

function inspectConfig(value: unknown): ConfigInspection {
  if (!isRecord(value)) {
    return { usable: false, result: failedValidation("config") };
  }

  try {
    return { usable: true, result: validateConfig(value as Partial<ClientConfig>) };
  } catch {
    return { usable: false, result: failedValidation("config") };
  }
}

function hasValidationError(inspection: ConfigInspection, fields: ReadonlyArray<string>): boolean {
  if (!inspection.usable) return true;
  return inspection.result.errors.some((error) =>
    fields.some((field) => error.field === field || error.field.startsWith(`${field}.`))
  );
}

function hasGeneralConfigError(inspection: ConfigInspection): boolean {
  if (!inspection.usable) return true;
  const sectionFields = [...NETWORK_FIELDS, ...CONTRACT_FIELDS, ...PROOF_FIELDS];
  return inspection.result.errors.some(
    (error) =>
      !sectionFields.some((field) => error.field === field || error.field.startsWith(`${field}.`))
  );
}

function isEnvironmentCapabilities(value: unknown): value is EnvironmentCapabilities {
  if (!isRecord(value)) return false;
  if (!RUNTIME_ENVIRONMENTS.has(value.environment as RuntimeEnvironment)) return false;
  if (!(value.capabilities instanceof Set)) return false;
  if (
    typeof value.hasWalletSupport !== "boolean" ||
    typeof value.hasWasm !== "boolean" ||
    typeof value.hasCrypto !== "boolean"
  ) {
    return false;
  }

  try {
    return Array.from(value.capabilities).every((capability) =>
      CAPABILITIES.has(capability as Capability)
    );
  } catch {
    return false;
  }
}

function inspectEnvironment(value: unknown): EnvironmentInspection {
  try {
    const environment = value === undefined ? detectEnvironment() : value;
    return isEnvironmentCapabilities(environment)
      ? { usable: true, value: environment }
      : { usable: false };
  } catch {
    return { usable: false };
  }
}

function checkConfig(inspection: ConfigInspection): IntegrationHealthStatus {
  return hasGeneralConfigError(inspection)
    ? IntegrationHealthStatus.FAILED
    : IntegrationHealthStatus.HEALTHY;
}

function checkNetwork(
  config: ConfigInspection,
  environment: EnvironmentInspection
): IntegrationHealthStatus {
  if (hasValidationError(config, NETWORK_FIELDS) || !environment.usable || !environment.value) {
    return IntegrationHealthStatus.FAILED;
  }

  try {
    const guard = new NetworkCapabilityGuard({ environment: environment.value });
    return guard.canFetch().supported && guard.canPoll().supported
      ? IntegrationHealthStatus.HEALTHY
      : IntegrationHealthStatus.FAILED;
  } catch {
    return IntegrationHealthStatus.FAILED;
  }
}

function checkContracts(config: ConfigInspection): IntegrationHealthStatus {
  return hasValidationError(config, CONTRACT_FIELDS)
    ? IntegrationHealthStatus.FAILED
    : IntegrationHealthStatus.HEALTHY;
}

function checkProofs(
  input: IntegrationHealthReportInput,
  environment: EnvironmentInspection
): IntegrationHealthStatus {
  const proofConfig = input.config?.proofConfig;
  if (!environment.usable || !environment.value || !isRecord(proofConfig)) {
    return IntegrationHealthStatus.FAILED;
  }
  if (!isRecord(input.proof)) return IntegrationHealthStatus.FAILED;

  try {
    const readiness = checkProofReadiness(
      {
        proofConfig,
        input: input.proof.input,
        mode: input.proof.mode,
      },
      {
        ...(input.proof.options ?? {}),
        checkArtifactFiles: false,
      }
    );
    if (!readiness.ready) return IntegrationHealthStatus.FAILED;

    const hasWarning = readiness.checks.some((check) => check.status === "warn");
    const guard = new NetworkCapabilityGuard({ environment: environment.value });
    return hasWarning || !guard.canGenerateProof().supported
      ? IntegrationHealthStatus.DEGRADED
      : IntegrationHealthStatus.HEALTHY;
  } catch {
    return IntegrationHealthStatus.FAILED;
  }
}

function checkWallet(
  wallet: IntegrationHealthWallet | undefined,
  environment: EnvironmentInspection
): IntegrationHealthStatus {
  if (!environment.usable || !environment.value) return IntegrationHealthStatus.FAILED;
  if (wallet === undefined) return IntegrationHealthStatus.DEGRADED;

  try {
    if (typeof wallet.isAvailable !== "function" || typeof wallet.isConnected !== "boolean") {
      return IntegrationHealthStatus.FAILED;
    }
    const available = wallet.isAvailable();
    if (typeof available !== "boolean") return IntegrationHealthStatus.FAILED;
    if (
      !available ||
      !environment.value.hasWalletSupport ||
      !environment.value.capabilities.has("wallet_connection")
    ) {
      return IntegrationHealthStatus.DEGRADED;
    }
    return wallet.isConnected ? IntegrationHealthStatus.HEALTHY : IntegrationHealthStatus.DEGRADED;
  } catch {
    return IntegrationHealthStatus.FAILED;
  }
}

function buildSection(
  section: IntegrationHealthSection,
  status: IntegrationHealthStatus
): IntegrationHealthSectionResult {
  const copy = SAFE_HEALTH_COPY[section][status];
  return copy.remediation
    ? { section, status, message: copy.message, remediation: copy.remediation }
    : { section, status, message: copy.message };
}

function aggregateHealthStatus(
  sections: ReadonlyArray<IntegrationHealthSectionResult>
): IntegrationHealthStatus {
  if (sections.some((section) => section.status === IntegrationHealthStatus.FAILED)) {
    return IntegrationHealthStatus.FAILED;
  }
  if (sections.some((section) => section.status === IntegrationHealthStatus.DEGRADED)) {
    return IntegrationHealthStatus.DEGRADED;
  }
  return IntegrationHealthStatus.HEALTHY;
}

/**
 * Generates a deterministic, safe-to-log integration report from SDK-owned checks.
 *
 * The SDK only parses data, inspects runtime capabilities, runs proof readiness
 * with local file probing disabled, calls `wallet.isAvailable()`, and reads
 * `wallet.isConnected`. It never connects a wallet, signs or submits a
 * transaction, calls a contract, generates a proof, opens an artifact, or makes
 * a network request. The supplied wallet owns the behavior of its two permitted
 * observations; consumers must keep those observations passive as required by
 * {@link IntegrationHealthWallet}.
 *
 * Raw validation details, proof diagnostics, runtime values, wallet data, and
 * thrown errors are discarded. Only fixed SDK copy enters the report.
 */
export function generateIntegrationHealthReport(
  input: IntegrationHealthReportInput
): IntegrationHealthReport {
  const safeInput = isRecord(input) ? input : {};
  const typedInput = safeInput as IntegrationHealthReportInput;
  const config = inspectConfig(typedInput.config);
  const environment = inspectEnvironment(typedInput.environment);
  const statuses: Record<IntegrationHealthSection, IntegrationHealthStatus> = {
    config: checkConfig(config),
    network: checkNetwork(config, environment),
    contracts: checkContracts(config),
    proofs: checkProofs(typedInput, environment),
    wallet: checkWallet(typedInput.wallet, environment),
  };
  const sections = INTEGRATION_HEALTH_SECTIONS.map((section) =>
    buildSection(section, statuses[section])
  );

  return { status: aggregateHealthStatus(sections), sections };
}
