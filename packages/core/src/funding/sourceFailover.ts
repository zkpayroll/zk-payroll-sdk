/**
 * Funding source failover validation (#718).
 *
 * A payroll asset's funding is often backed by more than one source wallet
 * — a primary treasury account and one or more backup/failover accounts. A
 * naive readiness check against the primary alone reports a deficit even
 * when a configured failover source could cover the shortfall; this module
 * validates a failover *chain* per asset and reports whether the chain
 * (primary plus its failovers, in order) actually covers the requirement,
 * and which source in the chain the shortfall would need to draw from.
 *
 * This complements {@link checkFundingReadiness} rather than replacing it:
 * that function answers "is this asset funded?" against a single balance
 * snapshot; this one answers "if the primary source falls short, is there
 * a configured failover that covers the gap, and is the failover chain
 * itself well-formed?"
 *
 * @module
 */

import { ValidationError } from "../core/errors";
import type { AssetBalanceSnapshot, FundingObligation } from "./types";

/** One funding source in a failover chain for a single asset. */
export interface FundingSource {
  /** Stable identifier for this source (e.g. account/wallet id). Unique within its chain. */
  sourceId: string;
  /** Asset identifier this source holds (`"native"` or a Soroban token contract ID). */
  asset: string;
  /** Spendable balance snapshot for this source. */
  balance: AssetBalanceSnapshot;
}

/** Per-source outcome within a resolved failover chain. */
export interface FundingSourceOutcome {
  /** The source this entry describes. */
  sourceId: string;
  /** This source's unreserved balance (`available - reserved`), in stroops. */
  unreservedBalance: bigint;
  /** Amount of the requirement actually drawn from this source, in stroops. */
  amountDrawn: bigint;
  /** Whether this source was used at all (`amountDrawn > 0`). */
  used: boolean;
  /** Whether this source was exhausted (`amountDrawn === unreservedBalance` and a deficit remains after it). */
  exhausted: boolean;
}

/** Result of validating one asset's failover chain against its requirement. */
export interface FundingFailoverResult {
  /** Asset identifier this result describes. */
  asset: string;
  /** Total required amount for this asset, in stroops. */
  requiredAmount: bigint;
  /** `true` once the combined chain (in order) fully covers `requiredAmount`. */
  covered: boolean;
  /** Remaining shortfall after draining the entire chain, in stroops (0 when covered). */
  remainingDeficit: bigint;
  /** Per-source draw-down detail, in chain order. */
  sources: FundingSourceOutcome[];
  /** The first source, if any, that still had unused capacity when the requirement was fully covered. */
  coveredBySourceId: string | null;
  /** Human-readable diagnostic naming the asset and, on failure, the shortfall. */
  message: string;
}

/** Stable codes for failover-chain input validation failures. */
export type FundingFailoverErrorCode =
  | "FAILOVER_SOURCES_EMPTY"
  | "FAILOVER_SOURCE_INVALID"
  | "FAILOVER_SOURCE_ID_REQUIRED"
  | "FAILOVER_SOURCE_ID_DUPLICATE"
  | "FAILOVER_SOURCE_ASSET_MISMATCH";

/** Error thrown when a failover chain is malformed. */
export class FundingFailoverError extends ValidationError {
  constructor(message: string, field: string, code: FundingFailoverErrorCode) {
    super(message, field, code);
    this.name = "FundingFailoverError";
  }
}

/**
 * Validates a funding source failover chain for a single asset against its
 * required amount, draining sources in the order given.
 *
 * Draw-down order is the order `sources` is given in — callers decide
 * priority (primary first, then failovers) by ordering the array; this
 * function never reorders sources itself, so the result is deterministic
 * and auditable against the configured chain.
 *
 * @param requiredAmount - Total amount needed for this asset, in stroops.
 *   Must be a non-negative bigint.
 * @param sources - Ordered failover chain for one asset. Must contain at
 *   least one source, every source must carry the same asset identifier,
 *   and `sourceId` must be unique within the chain.
 * @returns A deterministic per-source draw-down result.
 * @throws {FundingFailoverError} If `sources` is empty, malformed, contains
 *   a duplicate `sourceId`, or mixes more than one asset.
 * @throws {ValidationError} If `requiredAmount` is not a non-negative bigint.
 */
export function validateFundingFailoverChain(
  requiredAmount: bigint,
  sources: FundingSource[]
): FundingFailoverResult {
  if (typeof requiredAmount !== "bigint" || requiredAmount < 0n) {
    throw new ValidationError(
      "requiredAmount must be a non-negative bigint (stroops)",
      "requiredAmount",
      "FUNDING_AMOUNT_INVALID"
    );
  }

  const asset = validateFailoverSources(sources);

  let remaining = requiredAmount;
  const outcomes: FundingSourceOutcome[] = [];
  let coveredBySourceId: string | null = null;

  for (const source of sources) {
    const unreserved = source.balance.available - (source.balance.reserved ?? 0n);
    const amountDrawn = remaining > 0n ? (remaining < unreserved ? remaining : unreserved) : 0n;
    const usesFullCapacity = amountDrawn === unreserved && unreserved > 0n;

    outcomes.push({
      sourceId: source.sourceId,
      unreservedBalance: unreserved,
      amountDrawn,
      used: amountDrawn > 0n,
      // "Exhausted" means this source's capacity was fully drawn AND the
      // chain still needed more after it — not merely that it was used.
      exhausted: usesFullCapacity && remaining - amountDrawn > 0n,
    });

    remaining -= amountDrawn;

    // Only credit a source with "covering" the chain when it actually drew
    // something — a zero requirement is covered before any source is
    // touched, and must report no covering source at all.
    if (remaining === 0n && amountDrawn > 0n && coveredBySourceId === null) {
      coveredBySourceId = source.sourceId;
    }
  }

  const covered = remaining <= 0n;
  const remainingDeficit = covered ? 0n : remaining;

  const message = covered
    ? requiredAmount === 0n
      ? `Asset "${asset}" has no funding requirement`
      : `Asset "${asset}" is fully covered by its failover chain (required ${requiredAmount} stroops across ${sources.length} source(s))`
    : `Asset "${asset}" failover chain is insufficient: ${sources.length} source(s) cover ${
        requiredAmount - remainingDeficit
      } of ${requiredAmount} stroops required (deficit ${remainingDeficit} stroops after exhausting every configured source)`;

  return {
    asset,
    requiredAmount,
    covered,
    remainingDeficit,
    sources: outcomes,
    coveredBySourceId,
    message,
  };
}

/**
 * Validates failover chains for every asset in a payroll batch in one call.
 *
 * @param obligations - Obligations to fund, grouped internally by asset.
 * @param chains - Map of asset identifier to its ordered failover chain.
 *   An asset with obligations but no entry here is reported with an empty
 *   chain (always a deficit, since there is no source to draw from).
 * @returns One {@link FundingFailoverResult} per asset with obligations,
 *   sorted deterministically by asset identifier.
 */
export function validateBatchFundingFailover(
  obligations: FundingObligation[],
  chains: Map<string, FundingSource[]>
): FundingFailoverResult[] {
  const required = new Map<string, bigint>();
  for (const obligation of obligations) {
    required.set(obligation.asset, (required.get(obligation.asset) ?? 0n) + obligation.amount);
  }

  const results: FundingFailoverResult[] = [];
  for (const [asset, requiredAmount] of required) {
    const chain = chains.get(asset) ?? [];
    if (chain.length === 0) {
      results.push({
        asset,
        requiredAmount,
        covered: requiredAmount === 0n,
        remainingDeficit: requiredAmount,
        sources: [],
        coveredBySourceId: null,
        message:
          requiredAmount === 0n
            ? `Asset "${asset}" has no funding requirement`
            : `Asset "${asset}" has no configured funding source; required ${requiredAmount} stroops but 0 sources available`,
      });
      continue;
    }
    results.push(validateFundingFailoverChain(requiredAmount, chain));
  }

  results.sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));
  return results;
}

/** Validates a failover chain's shape and returns its (shared) asset identifier. */
function validateFailoverSources(sources: FundingSource[]): string {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new FundingFailoverError(
      "Failover chain must contain at least one source",
      "sources",
      "FAILOVER_SOURCES_EMPTY"
    );
  }

  const seenIds = new Set<string>();
  let asset: string | null = null;

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (typeof source !== "object" || source === null) {
      throw new FundingFailoverError(
        `Source at index ${i} must be an object`,
        `sources[${i}]`,
        "FAILOVER_SOURCE_INVALID"
      );
    }
    if (typeof source.sourceId !== "string" || source.sourceId.length === 0) {
      throw new FundingFailoverError(
        `Source at index ${i} has a missing or empty sourceId`,
        `sources[${i}].sourceId`,
        "FAILOVER_SOURCE_ID_REQUIRED"
      );
    }
    if (seenIds.has(source.sourceId)) {
      throw new FundingFailoverError(
        `Duplicate sourceId "${source.sourceId}" in failover chain`,
        `sources[${i}].sourceId`,
        "FAILOVER_SOURCE_ID_DUPLICATE"
      );
    }
    seenIds.add(source.sourceId);

    if (typeof source.asset !== "string" || source.asset.length === 0) {
      throw new FundingFailoverError(
        `Source "${source.sourceId}" has a missing or empty asset identifier`,
        `sources[${i}].asset`,
        "FAILOVER_SOURCE_INVALID"
      );
    }
    if (asset === null) {
      asset = source.asset;
    } else if (source.asset !== asset) {
      throw new FundingFailoverError(
        `Source "${source.sourceId}" carries asset "${source.asset}" but the chain started with "${asset}"; a failover chain must hold one asset only`,
        `sources[${i}].asset`,
        "FAILOVER_SOURCE_ASSET_MISMATCH"
      );
    }

    if (
      typeof source.balance !== "object" ||
      source.balance === null ||
      typeof source.balance.available !== "bigint" ||
      source.balance.available < 0n
    ) {
      throw new FundingFailoverError(
        `Source "${source.sourceId}" must have a non-negative bigint available balance`,
        `sources[${i}].balance.available`,
        "FAILOVER_SOURCE_INVALID"
      );
    }
    const reserved = source.balance.reserved ?? 0n;
    if (typeof reserved !== "bigint" || reserved < 0n) {
      throw new FundingFailoverError(
        `Source "${source.sourceId}" must have a non-negative bigint reserved balance`,
        `sources[${i}].balance.reserved`,
        "FAILOVER_SOURCE_INVALID"
      );
    }
    if (reserved > source.balance.available) {
      throw new FundingFailoverError(
        `Source "${source.sourceId}" reserves ${reserved} stroops but only ${source.balance.available} are available`,
        `sources[${i}].balance.reserved`,
        "FAILOVER_SOURCE_INVALID"
      );
    }
  }

  return asset as string;
}
