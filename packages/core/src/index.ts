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
export { PayrollService } from "./payroll";
export { PayrollContract } from "./contract";
export { ZKProofGenerator } from "./crypto/proofs";
export { SnarkjsProofGenerator } from "./crypto/SnarkjsProofGenerator";
export { WorkerProofGenerator } from "./crypto/WorkerProofGenerator";
export type { WorkerLike, WorkerProofOptions } from "./crypto/WorkerProofGenerator";
export type { WorkerRequest, WorkerResponse, ProofProgressStage } from "./crypto/WorkerMessages";
export {
  ZkPayrollError,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  RpcTimeoutError,
  InvalidResponseError,
  ValidationError,
  ContractErrorCode,
  WalletError,
  WalletRejectionError,
  WalletErrorCode,
  ReconciliationErrorCode,
  toUserFriendlyError,
  formatRedactedError,
  DEFAULT_ERROR_MESSAGES,
  mapRpcError,
  ErrorCategory,
  ERROR_CODE_REGISTRY,
  getErrorCategory,
  isRetryableErrorCode,
  getSuggestedMessage,
  getErrorCodesByCategory,
} from "./errors";
export type {
  ErrorContext,
  ContractErrorCodeType,
  WalletErrorCodeType,
  ReconciliationErrorCodeType,
  UserFriendlyError,
  FormattedError,
  ErrorMessageOverrides,
  ErrorCategoryType,
  ErrorCodeEntry,
} from "./errors";
export type {
  ClientConfig,
  RetryPolicyConfig,
  FeatureFlagsConfig,
  ConfigValidationErrorDetail,
  ConfigValidationResult,
  ConfigMigrationWarning,
  ConfigMigrationResult,
} from "./config";
export {
  DEFAULT_CONFIG,
  ConfigPresets,
  ConfigBuilder,
  validateConfig,
  assertValidConfig,
  migrateConfig,
  detectDeprecatedConfigFields,
} from "./config";
export * from "./cache";
export * from "./amendments";
export * from "./types";
export * from "./progress";
export {
  IdempotencyRegistry,
  createPaymentIdempotencyKey,
  createPayrollIdempotencyKey,
} from "./core/idempotency";
export type { PayrollIdempotencyKeyInput, PaymentIdempotencyKeyInput } from "./core/idempotency";
export { Semaphore } from "./core/concurrency";
export * from "./crypto/IProofGenerator";
export * from "./proofs/freshness";
export { resolveProofConfig, resolveProofConfigFromEnv } from "./crypto/ProofConfigResolver";
export type { ProofConfigResolverOptions } from "./crypto/ProofConfigResolver";
// Keep backward compatibility with existing adapters barrel export
export * from "./adapters";

// ── Polling Helpers ───────────────────────────────────────────────────────────
export * from "./polling";

// ── Contract Error Remediation ───────────────────────────────────────────────
export * from "./remediation";

// ── Logging ─────────────────────────────────────────────────────────────────
export * from "./logging";

// ── Batch Utilities ─────────────────────────────────────────────────────────
export * from "./batch";

// ── Testing Utilities ───────────────────────────────────────────────────────
export * from "./testing";

// ── Events ──────────────────────────────────────────────────────────────────
export { TransactionWatcher } from "./events";
export type { ConfirmationOptions, ConfirmationResult } from "./events";
export * from "./events/index";
export * from "./event-parser";

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
  ProofVerificationError,
  ProofVerificationErrorCode,
} from "./proofs/errors";
export type { ProofVerificationErrorCodeType } from "./proofs/errors";

// ── Proof Verification Adapter ───────────────────────────────────────────────
export * from "./proofs/types";
export * from "./proofs/verifierAdapter";
export { ProofVerificationClient, verifyProofWithAdapter } from "./client";

// ── Typed Contract Clients ───────────────────────────────────────────────────
export * from "./clients";

// ── Environment Sanity Checker ──────────────────────────────────────────────
export * from "./sanity";
export * from "./employer-readiness";

// ── Proof Readiness Checker ─────────────────────────────────────────────────
export * from "./proof-readiness";

// ── Transaction Simulation ──────────────────────────────────────────────────
export * from "./simulation";

// ── Draft Persistence ───────────────────────────────────────────────────────
export * from "./draft";

// ── Payroll Request Builder ─────────────────────────────────────────────────
export {
  PayrollRequestBuilder,
  deriveIdempotencyKey,
  buildDuplicateEmployeeValidationErrors,
  detectDuplicateEmployeeRecords,
  findDuplicateEmployeeIds,
} from "./request";
export type {
  DuplicateEmployeeOptions,
  DuplicateEmployeeRecord,
  DuplicateEmployeeReport,
  EmployeeIdentifiedRecord,
  PayrollRequest,
  PayrollRequestEntry,
  PayrollRequestErrorCode,
  PayrollRequestValidationEntry,
  PayrollRequestValidationReport,
  SubmissionContext,
} from "./request";

// ── Signed Payroll Instruction Builder ──────────────────────────────────────
export * from "./instructions";

// ── SDK / Contract Revision Compatibility ───────────────────────────────────
export * from "./compatibility";

// ── History Filter Builders ─────────────────────────────────────────────────
export * from "./filters";

// ── Archived Payroll History Helpers ────────────────────────────────────────
export * from "./archived";

// ── Redaction Utilities ─────────────────────────────────────────────────────
export * from "./redaction";

// ── Multi-Asset Metadata ────────────────────────────────────────────────────
export * from "./assets";

// ── Settlement & Destination Validation ──────────────────────────────────────
export * from "./settlement";

// ── Compliance Holds ─────────────────────────────────────────────────────────
export * from "./compliance";

// ── Privacy & Safe Credential Handling ─────────────────────────────────────
export * from "./privacy";
