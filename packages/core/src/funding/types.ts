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
  /** Asset identifier (``native`` or a Soroban token contract ID). */
  asset: string;
  /** Required amount in stroops. Must be a non-negative bigint. */
  amount: bigint;
}

/** A spendable-balance snapshot for one asset. */
export interface AssetBalanceSnapshot {
  /** Asset identifier (``native` or a Soroban token contract ID). */
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

/** Options controlling how a funding readiness check is evaluated. */
export interface FundingReadinessOptions {
  /**
   * When `true`, assets that appear in `balances` but have no obligations
   * are still reported (as `"ready"` with a zero requirement). Defaults to
   * `false`, in which case only assets with obligations are included.
   */
  includeUnobligatedAssets?: boolean;
  /**
   * When `true`, an asset with a zero requirement and zero available
   * balance is reported as `"deficit"` rather than `"ready"`. Defaults to
   * `false`, so a requirement of 0 is always considered covered.
   */
  requirePositiveBalance?: boolean;
}

/** Coded error thrown when funding readiness inputs are invalid. */
export class FundingReadinessError extends Error {
  /** Stable machine-readable error code. */
  readonly code: FundingReadinessErrorCode;
  /** Optional asset identifier the error relates to. */
  readonly asset?: string;

  constructor(code: FundingReadinessErrorCode, message: string, asset?: string) {
    super(message);
    this.name = "FundingReadinessError";
    this.code = code;
    if (asset !== undefined) {
      this.asset = asset;
    }
    // Restore prototype chain when transpiled to ES5 targets.
    Object.setPrototypeOf(this, new.target);
  }
}

/** Stable codes for funding readiness input validation failures. */
export type FundingReadinessErrorCode =
  | "EMPTY_ASSET_IDENTIFIER"
  | "DUPLICATE_ASSET_BALANCE"
  | "DUPLICATE_OBLIGATION_ID"
  | "NEGATIVE_OBLIGATION_AMOUNT"
  | "NEGATIVE_AVAILABLE_BALANCE"
  | "NEGATIVE_RESERVED_BALANCE"
  | "RESERVED_EXCEEDES_AVAILABLE";

/** A single projected liquidity point for one asset at a future horizon. */
export interface TreasuryLiquidityForecastPoint {
  /** Asset identifier (``native` or a Soroban token contract ID). */
  asset: string;
  /** Horizon label (e.g. `"immediate"`, `"weekly-forecast`). */
  horizon: string;
  /** Projected unreserved balance at this horizon, in stroops. */
  projectedBalance: bigint;
  /** Required funding at this horizon, in stroops. */
  requiredAmount: bigint;
  /** Positive surplus after covering the requirement, in stroops (0 when deficit). */
  surplus: bigint;
  /** Missing funds at this horizon, in stroops (0 when ready). */
  deficit: bigint;
  /** Per-horizon readiness state. */
  state: AssetFundingState;
  /** Human-readable diagnostic; deficit messages always name the asset. */
  message: string;
}

/** Per-asset liquidity forecast across all configured horizons. */
export interface TreasuryLiquidityAssetForecast {
  /** Asset identifier this entry describes. */
  asset: string;
  /** Horizon points, deterministically ordered as configured. */
  points: TreasuryLiquidityForecastPoint[];
  /** True only when every horizon for this asset is ready. */
  ready: boolean;
  /** Horizons with a deficit, represented as the minimum projected balance. */
  worstHorizon?: string;
  /** Largest deficit across horizons, in stroops (0 when ready). */
  maxDeficit: bigint;
}

/** Full treasury liquidity forecast report across all assets and horizons. */
export interface TreasuryLiquidityForecastReport {
  /** True only when **every** asset is ready at **every** horizon. */
  ready: boolean;
  /** Per-asset forecasts, deterministically sorted by asset identifier. */
  assets: TreasuryLiquidityAssetForecast[];
  /** Asset identifiers that fall into deficit at any horizon. */
  deficitAssetIds: string[];
  /** Asset identifiers that remain ready at every horizon. */
  surplusAssetIds: string[];
  /** Human-readable summary; names every asset with a deficit. */
  message: string;
}

/** Options controlling how a treasury liquidity forecast is evaluated. */
export interface TreasuryLiquidityForecastOptions extends FundingReadinessOptions {
  /**
   * Optional per-horizon multipliers applied to the immediate requirement.
   * The first horizon is always `"immediate"` with a multiplier of 1.
   * Defaults to the immediate horizon only.
   */
  horizons?: Array<{ label: string; multiplier: bigint }>;
  /**
   * Optional safety buffer added to each horizon's requirement, in
   * stroops. Defaults to 0. Must be a non-negative bigint.
   */
  safetyBuffer?: bigint;
}

/** Stable codes for treasury liquidity forecast input validation failures. */
export type TreasuryLiquidityForecastErrorCode =
  | FundingReadinessErrorCode
  | "EMPTY_HORIZON_LABEL"
  | "DUPLICATE_HORIZON_LABEL"
  | "NEGATIVE_HORIZON_MULTIPLIER"
  | "NEGATIVE_SAFETY_BUFFER";

/** Coded error thrown when treasury liquidity forecast inputs are invalid. */
export class TreasuryLiquidityForecastError extends FundingReadinessError {
  constructor(code: TreasuryLiquidityForecastErrorCode, message: string, asset?: string) {
    super(code, message, asset);
    this.name = "TreasuryLiquidityForecastError";
    Object.setPrototypeOf(this, new.target);
  }
}
