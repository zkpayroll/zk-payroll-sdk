/**
 * Multi-asset funding readiness checker.
 *
 * Payroll batches can span multiple assets, so funding is evaluated
 * **independently per asset**: obligations are grouped by asset, compared
 * against that asset's available (minus reserved) balance, and reported with
 * per-asset surplus, deficit, and ready states. A surplus in one asset never
 * masks a deficit in another.
 *
 * @example
 * ```typescript
 * const report = checkFundingReadiness(
 *   [
 *     { asset: "native", amount: 1_000n },
 *     { asset: "CUSDC...", amount: 2_500n },
 *   ],
 *   [
 *     { asset: "native", available: 5_000n, reserved: 500n },
 *     { asset: "CUSDC...", available: 2_000n },
 *   ]
 * );
 * report.ready;                  // false — USDC is short
 * report.deficits[0].asset;      // "CUSDC..." — the deficit names its asset
 * ```
 *
 * @module
 */

import { ValidationError } from "../core/errors";
import type {
  AssetBalanceSnapshot,
  AssetFundingReadiness,
  AssetFundingState,
  FundingObligation,
  FundingReadinessReport,
} from "./types";

/**
 * Groups payroll obligations by asset, summing required amounts.
 *
 * @param obligations - Obligations to group. Validated before grouping.
 * @returns A map of asset identifier → total required stroops.
 * @throws {ValidationError} If any obligation is malformed (empty asset id,
 *   non-bigint or negative amount).
 */
export function groupObligationsByAsset(obligations: FundingObligation[]): Map<string, bigint> {
  validateObligations(obligations);

  const grouped = new Map<string, bigint>();
  for (const obligation of obligations) {
    grouped.set(obligation.asset, (grouped.get(obligation.asset) ?? 0n) + obligation.amount);
  }
  return grouped;
}

/**
 * Calculates per-asset funding readiness for a payroll batch.
 *
 * For every asset involved (on either the obligation or the balance side):
 * - `required`   = sum of that asset's obligations,
 * - `unreserved` = `available - reserved`,
 * - `deficit`    = `max(0, required - unreserved)`,
 * - `surplus`    = `max(0, unreserved - required)`,
 * - `state`      = `"ready"` iff `deficit === 0`.
 *
 * Assets present only in the balance snapshot are reported with a zero
 * requirement (pure surplus); assets with obligations but no reported
 * balance are treated as having zero available funds.
 *
 * @param obligations - Payroll obligations to fund. Validated before use.
 * @param balances - Spendable-balance snapshots, at most one per asset.
 * @returns A deterministic, per-asset readiness report.
 * @throws {ValidationError} If inputs are malformed — including duplicate
 *   balance entries for the same asset or `reserved > available`.
 */
export function checkFundingReadiness(
  obligations: FundingObligation[],
  balances: AssetBalanceSnapshot[]
): FundingReadinessReport {
  const grouped = groupObligationsByAsset(obligations);
  const balanceByAsset = buildBalanceMap(balances);

  const assetIds = new Set<string>([...grouped.keys(), ...balanceByAsset.keys()]);
  const assets: AssetFundingReadiness[] = [];

  for (const asset of assetIds) {
    const required = grouped.get(asset) ?? 0n;
    const snapshot = balanceByAsset.get(asset);
    const available = snapshot?.available ?? 0n;
    const reserved = snapshot?.reserved ?? 0n;
    const unreserved = available - reserved;

    const deficit = required > unreserved ? required - unreserved : 0n;
    const surplus = unreserved > required ? unreserved - required : 0n;
    const state: AssetFundingState = deficit === 0n ? "ready" : "deficit";
    const obligationCount = obligations.filter((o) => o.asset === asset).length;

    const message =
      state === "ready"
        ? `Asset "${asset}" is fully funded: required ${required} stroops, unreserved available ${unreserved} stroops` +
          (surplus > 0n ? ` (surplus ${surplus} stroops)` : "")
        : `Insufficient funding for asset "${asset}": required ${required} stroops but only ${unreserved} unreserved stroops available` +
          (reserved > 0n ? ` (${reserved} stroops reserved)` : "") +
          ` (deficit ${deficit} stroops)`;

    assets.push({
      asset,
      requiredAmount: required,
      availableBalance: available,
      reservedBalance: reserved,
      unreservedBalance: unreserved,
      surplus,
      deficit,
      state,
      obligationCount,
      message,
    });
  }

  // Deterministic ordering: plain codepoint comparison, independent of input order.
  assets.sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));

  const deficits = assets.filter((entry) => entry.state === "deficit");
  const surplusAssetIds = assets.filter((entry) => entry.surplus > 0n).map((entry) => entry.asset);

  const message =
    deficits.length === 0
      ? assets.length === 0
        ? "No payroll obligations to fund"
        : `All ${assets.length} asset(s) fully funded`
      : `Funding required for ${deficits.length} of ${assets.length} asset(s): ` +
        deficits.map((entry) => entry.asset).join(", ");

  return {
    ready: deficits.length === 0,
    assets,
    deficits,
    surplusAssetIds,
    message,
  };
}

/** Validates obligations, failing early on malformed entries. */
function validateObligations(obligations: FundingObligation[]): void {
  if (!Array.isArray(obligations)) {
    throw new ValidationError("Obligations must be an array", "obligations", "FUNDING_OBLIGATIONS_INVALID");
  }
  for (let i = 0; i < obligations.length; i++) {
    const obligation = obligations[i];
    if (typeof obligation !== "object" || obligation === null) {
      throw new ValidationError(
        `Obligation at index ${i} must be an object`,
        `obligations[${i}]`,
        "FUNDING_OBLIGATION_INVALID"
      );
    }
    if (typeof obligation.asset !== "string" || obligation.asset.length === 0) {
      throw new ValidationError(
        `Obligation at index ${i} has a missing or empty asset identifier`,
        `obligations[${i}].asset`,
        "FUNDING_ASSET_REQUIRED"
      );
    }
    if (typeof obligation.amount !== "bigint") {
      throw new ValidationError(
        `Obligation at index ${i} amount must be a bigint (stroops)`,
        `obligations[${i}].amount`,
        "FUNDING_AMOUNT_INVALID"
      );
    }
    if (obligation.amount < 0n) {
      throw new ValidationError(
        `Obligation at index ${i} amount must not be negative`,
        `obligations[${i}].amount`,
        "FUNDING_AMOUNT_NEGATIVE"
      );
    }
  }
}

/** Validates and indexes balance snapshots by asset (duplicates rejected). */
function buildBalanceMap(balances: AssetBalanceSnapshot[]): Map<string, AssetBalanceSnapshot> {
  if (!Array.isArray(balances)) {
    throw new ValidationError("Balances must be an array", "balances", "FUNDING_BALANCES_INVALID");
  }

  const byAsset = new Map<string, AssetBalanceSnapshot>();
  for (let i = 0; i < balances.length; i++) {
    const snapshot = balances[i];
    if (typeof snapshot !== "object" || snapshot === null) {
      throw new ValidationError(
        `Balance snapshot at index ${i} must be an object`,
        `balances[${i}]`,
        "FUNDING_BALANCE_INVALID"
      );
    }
    if (typeof snapshot.asset !== "string" || snapshot.asset.length === 0) {
      throw new ValidationError(
        `Balance snapshot at index ${i} has a missing or empty asset identifier`,
        `balances[${i}].asset`,
        "FUNDING_ASSET_REQUIRED"
      );
    }
    if (byAsset.has(snapshot.asset)) {
      throw new ValidationError(
        `Duplicate balance snapshot for asset "${snapshot.asset}"; provide at most one snapshot per asset`,
        `balances[${i}].asset`,
        "FUNDING_BALANCE_DUPLICATE"
      );
    }
    if (typeof snapshot.available !== "bigint" || snapshot.available < 0n) {
      throw new ValidationError(
        `Balance snapshot for asset "${snapshot.asset}" must have a non-negative bigint available amount`,
        `balances[${i}].available`,
        "FUNDING_BALANCE_INVALID"
      );
    }
    const reserved = snapshot.reserved ?? 0n;
    if (typeof reserved !== "bigint" || reserved < 0n) {
      throw new ValidationError(
        `Balance snapshot for asset "${snapshot.asset}" must have a non-negative bigint reserved amount`,
        `balances[${i}].reserved`,
        "FUNDING_BALANCE_INVALID"
      );
    }
    if (reserved > snapshot.available) {
      throw new ValidationError(
        `Balance snapshot for asset "${snapshot.asset}" reserves ${reserved} stroops but only ${snapshot.available} are available; reserved cannot exceed available`,
        `balances[${i}].reserved`,
        "FUNDING_BALANCE_OVERRESERVED"
      );
    }
    byAsset.set(snapshot.asset, snapshot);
  }
  return byAsset;
}