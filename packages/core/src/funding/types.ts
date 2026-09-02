/**
 * Multi-asset funding readiness types.
 *
 * Funding readiness is always evaluated **independently per asset**: a
 * surplus of XLM must never hide a USDC deficit. All amounts are bigint
 * stroops (smallest on-chain unit).
 *
 * @module
 */

/** A single payroll funding obligation (one payment line, per asset). */
export interface FundingObligation {
  /** Optional caller-facing label (e.g. employee or invoice reference). */
  obligationId?: string;
  /** Asset identifier (`"native"` or a Soroban token contract ID). */
  asset: string;
  /** Required amount in stroops. Must be a non-negative bigint. */
  amount: bigint;
}

/** A spendable-balance snapshot for one asset. */
export interface AssetBalanceSnapshot {
  /** Asset identifier (`"native"` or a Soroban token contract ID). */
  asset: string;
  /** Total spendable balance in stroops. */
  available: bigint;
  /** Portion of `available` already reserved for other commitments. Defaults to 0. */
  reserved?: bigint;
}

/** Per-asset readiness state. */
export type AssetFundingState = "ready" | "deficit";

/** Readiness evaluation for a single asset. */
export interface AssetFundingReadiness {
  /** Asset identifier this entry describes. */
  asset: string;
  /** Total required funding for this asset, in stroops. */
  requiredAmount: bigint;
  /** Total available balance reported for this asset, in stroops. */
  availableBalance: bigint;
  /** Portion of `availableBalance` reserved for other commitments, in stroops. */
  reservedBalance: bigint;
  /** `availableBalance - reservedBalance` — what is actually usable, in stroops. */
  unreservedBalance: bigint;
  /** Excess usable funds after covering the requirement, in stroops (0 when deficit). */
  surplus: bigint;
  /** Missing funds to cover the requirement, in stroops (0 when ready). */
  deficit: bigint;
  /** `"ready"` when the requirement is fully covered, otherwise `"deficit"`. */
  state: AssetFundingState;
  /** Number of obligations grouped under this asset. */
  obligationCount: number;
  /** Human-readable diagnostic; deficit messages always name the asset. */
  message: string;
}

/** Full funding readiness report across all assets. */
export interface FundingReadinessReport {
  /** True only when **every** asset is ready (no asset hides another's deficit). */
  ready: boolean;
  /** Per-asset entries, deterministically sorted by asset identifier. */
  assets: AssetFundingReadiness[];
  /** Subset of `assets` whose state is `"deficit"`, same deterministic order. */
  deficits: AssetFundingReadiness[];
  /** Asset identifiers holding a surplus (including fully-funded assets). */
  surplusAssetIds: string[];
  /** Human-readable summary; names every asset with a deficit. */
  message: string;
}