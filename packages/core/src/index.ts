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
  toUserFriendlyError,
  DEFAULT_ERROR_MESSAGES,
  mapRpcError,
  PayrollError,
} from "./errors";
export type {
  ErrorContext,
  ContractErrorCodeType,
  WalletErrorCodeType,
  UserFriendlyError,
  ErrorMessageOverrides,
} from "./errors";
export { DEFAULT_CONFIG } from "./config";
export * from "./cache";
export * from "./types";
export * from "./progress";
export { IdempotencyRegistry, createPaymentIdempotencyKey } from "./core/idempotency";
export { Semaphore } from "./core/concurrency";
export * from "./crypto/IProofGenerator";
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
export {
  parseContractEvent,
  parseContractEvents,
  EventParsingError,
} from "./event-parser";
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

// ── Transaction Simulation ──────────────────────────────────────────────────
export * from "./simulation";

// ── Draft Persistence ───────────────────────────────────────────────────────
export * from "./draft";

// ── History Filter Builders ─────────────────────────────────────────────────
export * from "./filters";

// ── Redaction Utilities ─────────────────────────────────────────────────────
export * from "./redaction";

// ── Multi-Asset Metadata ────────────────────────────────────────────────────
export * from "./assets";

// ── Payload Normalization ───────────────────────────────────────────────────
export * from "./normalization";

// ── Execution Summary ────────────────────────────────────────────────────────
export * from "./summary";

// ── Audit View-Key Helpers ──────────────────────────────────────────────────
export * from "./audit";

// ── Idempotent Payroll Request Builder ─────────────────────────────────────
export * from "./request";
