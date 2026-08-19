/**
 * ZK Payroll SDK — Main entry point.
 *
 * Architecture layers:
 *   adapters/ — Low-level blockchain/Soroban wrappers
 *   crypto/   — ZK proof generation
 *   cache/    — Caching providers
 *   testing/  — Mock utilities
 */

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
  PayrollError,
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
export {
  DEFAULT_CONFIG,
  ConfigPresets,
  ConfigBuilder,
  validateConfig,
  assertValidConfig,
} from "./config";
export type {
  ClientConfig,
  RetryPolicyConfig,
  FeatureFlagsConfig,
  ConfigValidationErrorDetail,
  ConfigValidationResult,
} from "./config";
export * from "./cache";
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
export { resolveProofConfig, resolveProofConfigFromEnv } from "./crypto/ProofConfigResolver";
export type { ProofConfigResolverOptions } from "./crypto/ProofConfigResolver";
export * from "./adapters";

// ── Wallet Adapters ─────────────────────────────────────────────────────────
export * from "./wallets";
// ── Logging ─────────────────────────────────────────────────────────────────
export * from "./logging";

// ── Batch Utilities ─────────────────────────────────────────────────────────
export * from "./batch";

// ── Testing Utilities ───────────────────────────────────────────────────────
export * from "./testing";

// ── Events ──────────────────────────────────────────────────────────────────
export { TransactionWatcher } from "./events";
export type { ConfirmationOptions, ConfirmationResult } from "./events";
export * from "./polling";

// ── Pagination Helpers ───────────────────────────────────────────────────────
export * from "./pagination";

// ── Event Stream Parser ──────────────────────────────────────────────────────
export { parseContractEvent, parseContractEvents, EventParsingError } from "./event-parser";
export type {
  RawContractEvent,
  TypedContractEvent,
  RegisteredEvent,
  RegistryUpdatedEvent,
  RegistryDeactivatedEvent,
  CommittedEvent,
  SalaryRevealedEvent,
  PaymentExecutedEvent,
  PaymentScheduledEvent,
  PaymentCancelledEvent,
} from "./event-parser";

// ── Typed Contract Clients ───────────────────────────────────────────────────
export * from "./clients";

// ── Environment Sanity Checker ──────────────────────────────────────────────
export * from "./sanity";

// ── Proof Readiness Checker ─────────────────────────────────────────────────
export * from "./proof-readiness";

// ── Transaction Simulation ──────────────────────────────────────────────────
export * from "./simulation";

// ── Draft Persistence ───────────────────────────────────────────────────────
export * from "./draft";

// ── History Filter Builders ─────────────────────────────────────────────────
export * from "./filters";

// ── Archived Payroll History Helpers ────────────────────────────────────────
export * from "./archived";

// ── Redaction Utilities ─────────────────────────────────────────────────────
export * from "./redaction";

// ── Multi-Asset Metadata ────────────────────────────────────────────────────
export * from "./assets";

// ── Transaction Status Mapping ──────────────────────────────────────────────
export * from "./transactions";
// ── Payload Normalization ───────────────────────────────────────────────────
export * from "./normalization";

// ── Execution Summary ────────────────────────────────────────────────────────
export * from "./summary";

// ── Reconciliation Diff ─────────────────────────────────────────────────────
export * from "./reconciliation";

// ── Audit View-Key Helpers ──────────────────────────────────────────────────
export * from "./audit";

// ── Webhook Verification ────────────────────────────────────────────────────
export * from "./webhooks";

// ── Payroll Lifecycle Event Aggregator ──────────────────────────────────────
export * from "./lifecycle";

// ── Environment Capability Detector ─────────────────────────────────────────
export * from "./env";

// ── Fee Estimation Helper ───────────────────────────────────────────────────
export * from "./fee-estimation";

// ── Transaction Envelope Summarizer ─────────────────────────────────────────
export * from "./transaction-envelope";
// ── Transaction Inspection ──────────────────────────────────────────────────
export * from "./inspector";

// ── Transaction Failure Classification ──────────────────────────────────────
export * from "./classification";

// Contract State Indexer
export * from "./indexer";

// Proof Artifact Lifecycle
export * from "./artifacts";

// Payroll Setup Checklist Generator
export * from "./setup";
