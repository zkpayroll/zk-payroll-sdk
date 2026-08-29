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
// ── Payroll Status Label Helpers ────────────────────────────────────────────
export * from "./status";
// ── Payroll Period Summary ──────────────────────────────────────────────────
export * from "./payroll";
// ── Payload Normalization ───────────────────────────────────────────────────
export * from "./normalization";

// ── Execution Summary ────────────────────────────────────────────────────────
export * from "./summary";

// ── Reconciliation Diff ─────────────────────────────────────────────────────
export * from "./reconciliation";

// ── Audit View-Key Helpers ──────────────────────────────────────────────────
export * from "./audit";

// ── Audit-Safe Debug Snapshot ───────────────────────────────────────────────
export * from "./debug";

// ── Privacy Utilities ───────────────────────────────────────────────────────
export * from "./privacy";

// ── Capability Management ───────────────────────────────────────────────────
export * from "./capabilities";

// ── Contract Upgrade Analysis ───────────────────────────────────────────────
export * from "./upgrades";

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

// ── Payroll Signing Payload Inspector ───────────────────────────────────────
export * from "./signing";

// ── Error Code Documentation Generation ─────────────────────────────────────
export * from "./error-docs";

// Proof Artifact Lifecycle
export * from "./artifacts";

// Multi-Signer Authorization
export * from "./authorization";

// ── Local Payload Validation ─────────────────────────────────────────────────
export { PayrollValidation } from "./core/validation";
export type { ValidationResult } from "./core/validation";

// ── Payroll Receipts & Verification ─────────────────────────────────────────
export * from "./receipts";
export * from "./verification";
// Payroll Setup Checklist Generator
export * from "./setup";

// Network Request Timing Metadata
export * from "./network";

// ── Employee Eligibility & Reason Codes ─────────────────────────────────────
export * from "./eligibility";
export * from "./employees";

// ── Contract Error Remediation Mapper ───────────────────────────────────────
export * from "./remediation";

// ── Payroll Policy Compiler ──────────────────────────────────────────────────
export * from "./policy";

// ── Treasury Reservation Lifecycle ──────────────────────────────────────────
export * from "./treasury";

// ── Reservation Helpers ─────────────────────────────────────────────────────
export * from "./reservations";

// ── Payroll Dispute Status Decoder ──────────────────────────────────────────
export * from "./disputes";

// ── Offline Payroll Draft Validation ────────────────────────────────────────
export * from "./validation";

// ── Network Environment Profile Resolver ────────────────────────────────────
export * from "./metadata";
