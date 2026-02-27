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

// ── Adapters Layer ──────────────────────────────────────────────────────────
export { PayrollService } from "./payroll";
export { PayrollContract } from "./contract";
export { ZKProofGenerator } from "./crypto/proofs";
export { SnarkjsProofGenerator } from "./crypto/SnarkjsProofGenerator";
export {
  ZkPayrollError,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  ValidationError,
  ContractErrorCode,
  mapRpcError,
  PayrollError,
} from "./errors";
export type { ErrorContext, ContractErrorCodeType } from "./errors";
export { DEFAULT_CONFIG } from "./config";
export * from "./cache";
export * from "./types";
export * from "./crypto/IProofGenerator";
export * from "./adapters";

// ── Testing Utilities ───────────────────────────────────────────────────────
export * from "./testing";
export { TransactionWatcher } from "./events";
export type { ConfirmationOptions, ConfirmationResult } from "./events";
