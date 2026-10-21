/**
 * Funding Module
 *
 * Multi-asset payroll funding readiness: group obligations by asset, compare
 * against available/reserved balances, and report per-asset surplus, deficit,
 * and ready states with asset-named diagnostics.
 */

export type {
  AssetBalanceSnapshot,
  AssetFundingReadiness,
  AssetFundingState,
  FundingObligation,
  FundingReadinessReport,
} from "./types";
export { checkFundingReadiness, groupObligationsByAsset } from "./readiness";
export type {
  FundingFailoverErrorCode,
  FundingFailoverResult,
  FundingSource,
  FundingSourceOutcome,
} from "./sourceFailover";
export {
  FundingFailoverError,
  validateBatchFundingFailover,
  validateFundingFailoverChain,
} from "./sourceFailover";
export type {
  TreasuryAssetForecast,
  TreasuryFlow,
  TreasuryForecastErrorCode,
  TreasuryForecastInput,
  TreasuryForecastSafety,
  TreasuryLiquidityForecastReport,
} from "./liquidityForecast";
export {
  TreasuryForecastError,
  assertTreasuryLiquiditySafe,
  forecastTreasuryLiquidity,
} from "./liquidityForecast";
