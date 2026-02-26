/**
 * Core Layer — Business logic for ZK proofs, payroll, and error handling.
 *
 * This layer contains domain logic that is independent of any specific
 * blockchain adapter or external service. It defines interfaces that
 * adapters must implement.
 */
export { ZKProofGenerator } from "../crypto/proofs";
export { SnarkjsProofGenerator } from "../crypto/SnarkjsProofGenerator";
export type {
  IProofGenerator,
  ProofPayload,
  ProofGeneratorConfig,
} from "../crypto/IProofGenerator";
export { PayrollError } from "../errors";
export { listenToEvents } from "../events";
export * from "../cache";
