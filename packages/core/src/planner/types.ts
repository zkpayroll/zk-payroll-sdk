/**
 * Type definitions for the payroll execution planner.
 *
 * {@link planPayrollExecution} produces a {@link PayrollExecutionPlan} — a
 * preflight report covering contract version compatibility, treasury
 * readiness, proof provider readiness, settlement window status, batch
 * commitment consistency, and outstanding signatures — *before* a payroll
 * transaction is submitted.
 *
 * Security: the planner never echoes salary amounts or other private payroll
 * values. Only public identifiers (contract versions, asset codes, roles,
 * commitment hashes) and presence/shape details are reported, so the result
 * is safe to log or display in a UI.
 *
 * @module
 */

import type { SignerRole } from "../authorization/types";
import type { ProofReadinessInput, ProofReadinessOptions } from "../proof-readiness/types";

/** Categories covered by the execution plan. */
export type PlanCheckCategory =
  "contract" | "treasury" | "proof" | "settlement" | "batch" | "authorization";

/** Outcome of a single planner check. */
export type PlanCheckStatus = "pass" | "warn" | "fail";

/** Stable identifiers for each individual planner check. */
export const PlanCheckId = {
  CONTRACT_VERSION_SUPPORTED: "contract-version-supported",
  CONTRACT_FEATURES_AVAILABLE: "contract-features-available",
  TREASURY_SUFFICIENT: "treasury-sufficient",
  PROOF_PROVIDER_READY: "proof-provider-ready",
  SETTLEMENT_WINDOW_STATUS: "settlement-window-status",
  BATCH_COMMITMENT_CONSISTENCY: "batch-commitment-consistency",
  AUTHORIZATION_SIGNATURES: "authorization-signatures",
} as const;

export type PlanCheckId = (typeof PlanCheckId)[keyof typeof PlanCheckId];

/** A single planner check result — the unit blockers and warnings are built from. */
export interface PlanCheck {
  /** Stable identifier — one of {@link PlanCheckId}. */
  id: PlanCheckId;
  /** Category this check belongs to. */
  category: PlanCheckCategory;
  /** Human-readable label for display in logs and UIs. */
  label: string;
  /** Outcome of the check. */
  status: PlanCheckStatus;
  /** Clear, actionable explanation of the outcome. Never contains salary values. */
  message: string;
  /** Guidance describing how to resolve a `warn`/`fail` outcome. */
  remediation?: string;
}

/** A single outstanding or satisfied signature required before submission. */
export interface RequiredSignature {
  /** Role that must sign (e.g. `"treasury_operator"`). */
  role: SignerRole;
  /** Whether this role has already signed. */
  satisfied: boolean;
  /** Address that satisfied the requirement, when known. */
  address?: string;
}

/** A single estimated on-chain transaction step in the execution plan. */
export interface ExecutionStep {
  /** Stable identifier for this step. */
  id: string;
  /** Human-readable label for display in logs and UIs. */
  label: string;
  /** Description of what the step does. */
  description: string;
  /** Number of on-chain transactions this step is expected to require. */
  transactionCount: number;
}

/** The result produced by {@link planPayrollExecution}. */
export interface PayrollExecutionPlan {
  /** UTC timestamp (ms) when the plan was generated. */
  generatedAt: number;
  /** `true` only when no check has a `fail` status. */
  ready: boolean;
  /** Every check that was run, in a stable category order. */
  checks: PlanCheck[];
  /** Convenience view of checks whose status is `fail`. Safe to render in a UI. */
  blockers: PlanCheck[];
  /** Convenience view of checks whose status is `warn`. Safe to render in a UI. */
  warnings: PlanCheck[];
  /** Signatures required before the plan can be submitted, satisfied or not. */
  requiredSignatures: RequiredSignature[];
  /** Estimated on-chain transaction steps, in submission order. */
  steps: ExecutionStep[];
}

/** A semantic-version compatibility range, inclusive on both ends. */
export interface ContractVersionRange {
  minVersion: string;
  maxVersion: string;
}

/** Contract capability information used by the contract category. */
export interface ContractReadinessInput {
  /** Version reported by the deployed contract (e.g. `"1.4.0"`). */
  currentVersion: string;
  /** Inclusive version range the SDK/integration supports. */
  supportedRange: ContractVersionRange;
  /**
   * The latest version the integrator recommends running. When set and
   * `currentVersion` is within `supportedRange` but below this value, the
   * contract check reports a non-blocking "stale contract" warning.
   */
  recommendedVersion?: string;
  /** Feature flags the deployed contract reports as available. */
  availableFeatures?: string[];
  /** Feature flags the payroll operation being planned requires. */
  requiredFeatures?: string[];
}

/** Treasury balance information used by the treasury category. */
export interface TreasuryReadinessInput {
  /** Current treasury balance, in the asset's smallest unit (e.g. stroops). */
  balance: bigint;
  /** Asset identifier the treasury balance is denominated in. */
  asset: string;
  /** Total amount required to cover this payroll run, in the same asset. */
  requiredAmount: bigint;
  /** Asset identifier the payroll run is expected to pay out in. */
  requiredAsset: string;
  /**
   * Minimum balance that must remain after this run (e.g. a reserve floor).
   * When the post-run balance would fall below this, the check warns
   * without blocking.
   */
  minReserve?: bigint;
}

/** Proof provider readiness input, forwarded to {@link checkProofReadiness}. */
export interface ProofProviderReadinessInput {
  /** The proof subject to evaluate. Omit entirely to signal no provider is configured. */
  subject?: ProofReadinessInput;
  /** Options forwarded to {@link checkProofReadiness}. */
  options?: ProofReadinessOptions;
}

/** Settlement window information used by the settlement category. */
export interface SettlementWindowInput {
  /** UTC timestamp (ms) the settlement window opens. */
  opensAt: number;
  /** UTC timestamp (ms) the settlement window closes. */
  closesAt: number;
  /** UTC timestamp (ms) to evaluate against. Defaults to `Date.now()`. */
  now?: number;
  /**
   * Fraction (0-1) of the window's remaining time under which the check
   * warns that the window is closing soon. Defaults to `0.1` (10%).
   */
  closingSoonThreshold?: number;
}

/** A single salary commitment entry in the payroll batch. */
export interface BatchCommitmentEntry {
  /** Employee identifier the commitment belongs to. */
  employeeId: string;
  /** Deterministic commitment hash (never the underlying salary value). */
  commitmentHash: string;
}

/** Batch commitment information used by the batch category. */
export interface BatchCommitmentInput {
  /** Commitments generated for this payroll run. */
  commitments: BatchCommitmentEntry[];
  /** Expected number of employees in the batch, when known. */
  expectedEmployeeCount?: number;
}

/** Multi-signer authorization state used by the authorization category. */
export interface AuthorizationReadinessInput {
  /** Roles that must sign before submission. */
  requiredRoles: SignerRole[];
  /** Roles that have already signed, with the signing address when known. */
  signedRoles: Array<{ role: SignerRole; address?: string }>;
}

/** Full input to {@link planPayrollExecution}. Every field is optional; an
 * omitted section is reported as a non-blocking warning so the plan can still
 * be produced from partial information. */
export interface PayrollExecutionPlanInput {
  /** Number of employees included in this payroll run, used to estimate steps. */
  employeeCount: number;
  contract?: ContractReadinessInput;
  treasury?: TreasuryReadinessInput;
  proof?: ProofProviderReadinessInput;
  settlementWindow?: SettlementWindowInput;
  batch?: BatchCommitmentInput;
  authorization?: AuthorizationReadinessInput;
}

/** Options controlling plan generation. */
export interface PayrollExecutionPlanOptions {
  /** Maximum batch entries per on-chain transaction. Defaults to `50`. */
  maxEntriesPerTransaction?: number;
}
