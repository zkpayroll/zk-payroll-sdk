/**
 * Proof readiness checker — verifies proof inputs, artifact paths, environment
 * settings, and supported proof modes before generation.
 *
 * @module
 */

export { checkProofReadiness } from "./checker";
export { ProofReadinessCheckId, SUPPORTED_PROOF_MODES } from "./types";
export type {
  ProofReadinessInput,
  ProofReadinessOptions,
  ProofReadinessResult,
  ProofReadinessCheck,
  ProofReadinessStatus,
  RequiredInputField,
  ExpectedFieldType,
  SupportedProofMode,
} from "./types";
