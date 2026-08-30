/**
 * ZK Payroll SDK — Main entry point.
 *
 * Architecture layers:
 *   api/      — Public-facing classes and interfaces
 *   core/     — Business logic (ZK proofs, payroll, caching)
 *   adapters/ — Low-level blockchain/Soroban wrappers
 */

// ── API Layer ───────────────────────────────────────────────────────────────
export * from "./api";

// ── Core Layer ──────────────────────────────────────────────────────────────
export * from "./core";

// ── Backward-compat error aliases (not in the core layer) ───────────────────
export { PayrollError, PayrollServiceErrorCode, handleApiError } from "./errors";

// ── Adapters Layer ──────────────────────────────────────────────────────────
export * from "./adapters";

// ── Logging ─────────────────────────────────────────────────────────────────
export * from "./logging";

// ── Batch Utilities ─────────────────────────────────────────────────────────
export * from "./batch";

// ── Testing Utilities ───────────────────────────────────────────────────────
export * from "./testing";

// ── Events ──────────────────────────────────────────────────────────────────
export { TransactionWatcher } from "./events";
export type { ConfirmationOptions, ConfirmationResult } from "./events";

// ── Assets ────────────────────────────────────────────────────────────────────
export * from "./assets";

// ── Proofs ────────────────────────────────────────────────────────────────────
export {
  MissingProofError,
  isMissingProofError,
  isProofError,
  getMissingProofRemediation,
  getProofRemediation,
  getMissingProofErrorRemediation,
  formatMissingProofError,
  formatProofError,
  MISSING_PROOF_REMEDIATION,
  GENERIC_PROOF_REMEDIATION,
} from "./proofs/errors";

// ── Typed Contract Clients ───────────────────────────────────────────────────
export * from "./clients";

// ── Client Helpers ────────────────────────────────────────────────────────────
export {
  SupportedAssetsClient,
  getSupportedAssetsForClient,
  getEnabledSupportedAssetsForClient,
  type SupportedAssetProvider,
} from "./client";
export type { SupportedAsset, RawSupportedAsset } from "./assets/supportedAssets";
export { normalizeSupportedAsset, normalizeSupportedAssets } from "./assets/supportedAssets";

// ── Errors (contract-level helpers) ─────────────────────────────────────────
// Re-export contract error helpers under distinct names to avoid collision with proofs/errors
export {
  isContractMissingProofError,
  isMissingProofContractError,
  isHostMissingProofError,
  getContractProofErrorRemediation,
  formatContractProofError,
  mapContractProofError,
} from "./errors/contractErrors";

// ── Proof Artifacts ─────────────────────────────────────────────────────────
export * from "./artifacts";

// ── Backward-Compatibility Exports ──────────────────────────────────────────
export * from "./compat-exports";
