/**
 * Type definitions for the proof readiness checker.
 *
 * The readiness checker verifies that everything required for zero-knowledge
 * proof generation is in place *before* the expensive `groth16.fullProve` call
 * runs, so failures surface early with actionable remediation guidance rather
 * than deep inside snarkjs.
 *
 * @module
 */

import type { ProofGeneratorConfig } from "../crypto/IProofGenerator";

/** Proof modes (snarkjs protocols) the SDK knows how to generate. */
export const SUPPORTED_PROOF_MODES = ["groth16"] as const;

/** A proof mode string the SDK supports out of the box. */
export type SupportedProofMode = (typeof SUPPORTED_PROOF_MODES)[number];

/** Stable identifiers for each individual readiness check. */
export const ProofReadinessCheckId = {
  /** Circuit artifact paths/URLs are configured and (locally) present. */
  ARTIFACT_AVAILABILITY: "artifact-availability",
  /** The proof input (witness) has the required fields with correct types. */
  INPUT_SHAPE: "input-shape",
  /** Environment / configuration settings required for generation are sane. */
  ENVIRONMENT_SETTINGS: "environment-settings",
  /** The requested proof mode is one the SDK supports. */
  PROOF_MODE: "proof-mode",
} as const;

export type ProofReadinessCheckId =
  (typeof ProofReadinessCheckId)[keyof typeof ProofReadinessCheckId];

/**
 * Outcome of a single readiness check.
 *
 * - `pass` — the check succeeded, nothing to do.
 * - `warn` — non-blocking; readiness is not affected but the caller should know.
 * - `fail` — blocking; proof generation is not expected to succeed.
 */
export type ProofReadinessStatus = "pass" | "warn" | "fail";

/** The JavaScript-level type a required proof input field is expected to hold. */
export type ExpectedFieldType = "string" | "number" | "bigint" | "boolean" | "object" | "array";

/** Describes a single required field on the proof input (witness). */
export interface RequiredInputField {
  /** The field name expected on the proof input object. */
  name: string;
  /**
   * Optional expected type. When omitted, only presence (not `undefined`/`null`)
   * is checked.
   */
  type?: ExpectedFieldType;
}

/** Result of one individual readiness check. */
export interface ProofReadinessCheck {
  /** Stable identifier — one of {@link ProofReadinessCheckId}. */
  id: ProofReadinessCheckId;
  /** Human-readable label for display in logs and UIs. */
  label: string;
  /** Outcome of the check. */
  status: ProofReadinessStatus;
  /**
   * Human-readable explanation of the outcome.
   *
   * For failures this never contains raw proof input *values* — only field
   * names, types, and shapes — so secrets are not leaked into logs.
   */
  message: string;
  /** Actionable guidance describing how to fix a `warn`/`fail` outcome. */
  remediation?: string;
}

/** Aggregate result returned by {@link checkProofReadiness}. */
export interface ProofReadinessResult {
  /** `true` only when no check has a `fail` status. */
  ready: boolean;
  /** Every check that was run, in a stable order. */
  checks: ProofReadinessCheck[];
  /** Convenience view of the checks whose status is `fail`. */
  failures: ProofReadinessCheck[];
}

/** The subject being evaluated for proof readiness. */
export interface ProofReadinessInput {
  /** The proof artifact configuration (wasm/zkey sources or URLs). */
  proofConfig: ProofGeneratorConfig;
  /**
   * The proof input (witness) that will be fed to the prover. Values are never
   * echoed into result messages — only names/types are reported.
   */
  input?: Record<string, unknown>;
  /** The requested proof mode. Defaults to `"groth16"` when omitted. */
  mode?: string;
}

/** Options controlling which checks run and what they consider valid. */
export interface ProofReadinessOptions {
  /**
   * Fields the proof input must contain. When omitted, the input-shape check
   * only verifies that an input object was supplied.
   */
  requiredInputFields?: ReadonlyArray<RequiredInputField>;
  /**
   * Proof modes to accept. Defaults to {@link SUPPORTED_PROOF_MODES}.
   */
  supportedModes?: ReadonlyArray<string>;
  /**
   * Whether to probe the local filesystem for artifacts configured as local
   * paths. Defaults to `true`. Remote (HTTP) artifacts are only format-checked;
   * no network request is made.
   */
  checkArtifactFiles?: boolean;
}
