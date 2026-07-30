import type { ClientConfig } from "../config";
import type { EnvironmentCapabilities } from "../env";
import type { ProofReadinessInput, ProofReadinessOptions } from "../proof-readiness";
import type { IWalletAdapter } from "../wallets";

/** Stable section order used by every integration health report. */
export const INTEGRATION_HEALTH_SECTIONS = [
  "config",
  "network",
  "contracts",
  "proofs",
  "wallet",
] as const;

/** A diagnostic area covered by the integration health report. */
export type IntegrationHealthSection = (typeof INTEGRATION_HEALTH_SECTIONS)[number];

/** Supported outcomes for an individual section and the aggregate report. */
export const IntegrationHealthStatus = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  FAILED: "failed",
} as const;

/** Health status derived from the fixed {@link IntegrationHealthStatus} values. */
export type IntegrationHealthStatus =
  (typeof IntegrationHealthStatus)[keyof typeof IntegrationHealthStatus];

/**
 * Proof data inspected by the health report.
 *
 * Artifact files are never opened by the health report, even if a caller tries
 * to enable file probing through an untyped runtime value.
 */
export type IntegrationHealthProofInput = Omit<ProofReadinessInput, "proofConfig"> & {
  options?: Omit<ProofReadinessOptions, "checkArtifactFiles">;
};

/** The only wallet observations the SDK-owned health check may perform. */
export type IntegrationHealthWallet = Pick<IWalletAdapter, "isAvailable" | "isConnected">;

/** Typed, data-oriented inputs for the SDK-owned integration diagnostics. */
export interface IntegrationHealthReportInput {
  /** SDK configuration, including network, contract, and proof-artifact settings. */
  config?: Partial<ClientConfig>;
  /** Pre-detected capabilities; defaults to SDK environment detection when omitted. */
  environment?: EnvironmentCapabilities;
  /** Proof input shape and mode. The proof configuration comes from `config.proofConfig`. */
  proof?: IntegrationHealthProofInput;
  /** Optional passive wallet capability view. */
  wallet?: IntegrationHealthWallet;
}

/** Safe-to-log result for one integration area. */
export interface IntegrationHealthSectionResult {
  /** The integration area that was checked. */
  section: IntegrationHealthSection;
  /** The SDK-derived outcome of the check. */
  status: IntegrationHealthStatus;
  /** Fixed, non-sensitive description supplied by the SDK. */
  message: string;
  /** Fixed guidance for resolving a degraded or failed result. */
  remediation?: string;
}

/** Aggregate, deterministic health report returned to SDK consumers. */
export interface IntegrationHealthReport {
  /** Worst status across all sections: failed, then degraded, then healthy. */
  status: IntegrationHealthStatus;
  /** Results in the stable config/network/contracts/proofs/wallet order. */
  sections: ReadonlyArray<IntegrationHealthSectionResult>;
}
