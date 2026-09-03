/**
 * Treasury Summary Response Types
 *
 * Defines the normalized response shape for treasury summary views returned
 * by the contract (aggregate balances, reservations, and per-asset
 * breakdowns). Strong response types make treasury UI integrations safer
 * and easier to review, mirroring the pattern used by
 * `payroll/periodSummary.ts`.
 */

import { xdr, Address, Keypair, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import { scValToBigInt, scValToNumber, scValToString } from "../payroll/periodSummary";

/**
 * Summary of a single asset's balance within the treasury.
 */
export interface AssetTreasurySummary {
  /** Asset identifier (e.g., "native" or token contract address) */
  asset: string;
  /** Total on-chain balance for this asset (stroops) */
  balance: bigint;
  /** Amount currently locked in active funding reservations (stroops) */
  reservedAmount: bigint;
  /** Balance minus reserved amount — funds free to reserve or withdraw (stroops) */
  availableAmount: bigint;
}

/**
 * Normalized treasury summary response.
 *
 * Returned by `fetchTreasurySummary` and safe for direct UI consumption.
 * All fields have stable defaults — no optional chaining required.
 */
export interface TreasurySummary {
  /** Employer/company address the treasury belongs to */
  employer: string;
  /** Total balance across all assets (stroops, native asset equivalent) */
  totalBalance: bigint;
  /** Total amount reserved across all assets (stroops) */
  totalReserved: bigint;
  /** Total available (unreserved) amount across all assets (stroops) */
  totalAvailable: bigint;
  /** Per-asset breakdown */
  assets: AssetTreasurySummary[];
  /** Ledger sequence the summary was computed as of, if reported by the contract */
  asOfLedger?: number;
  /** Unix timestamp when the summary was fetched (ms) */
  fetchedAt: number;
}

/**
 * Configuration options for fetching a treasury summary.
 */
export interface FetchTreasurySummaryOptions {
  /** Signer for the query transaction */
  signer: Keypair | ISigner;
  /** Network passphrase (defaults to TESTNET) */
  network?: string;
  /** Optional request ID for correlation tracing */
  requestId?: string;
}

/**
 * Default empty treasury summary for normalization.
 */
export function createEmptyTreasurySummary(employer: string): TreasurySummary {
  return {
    employer,
    totalBalance: 0n,
    totalReserved: 0n,
    totalAvailable: 0n,
    assets: [],
    fetchedAt: Date.now(),
  };
}

/**
 * Decode a single asset's treasury summary entry from a contract response.
 */
export function decodeAssetTreasurySummary(scVal: xdr.ScVal): AssetTreasurySummary | null {
  const map = scVal.map();
  if (!map) return null;

  const entries: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym()?.toString() ?? "";
    entries[key] = entry.val();
  }

  const balance = scValToBigInt(entries.balance);
  const reservedAmount = scValToBigInt(entries.reserved_amount);

  return {
    asset: scValToString(entries.asset),
    balance,
    reservedAmount,
    availableAmount: balance - reservedAmount,
  };
}

/**
 * Normalize a raw contract response into a typed `TreasurySummary`.
 *
 * @param raw - Raw contract response
 * @param employer - Employer address (fallback if missing from the response)
 * @returns Normalized treasury summary with safe defaults
 */
export function normalizeTreasurySummary(raw: xdr.ScVal, employer: string): TreasurySummary {
  const map = raw.map();
  if (!map) {
    return createEmptyTreasurySummary(employer);
  }

  const entries: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym()?.toString() ?? "";
    entries[key] = entry.val();
  }

  const rawEmployer = scValToString(entries.employer);
  const assetsVec = entries.assets?.vec() ?? [];

  const assets: AssetTreasurySummary[] = [];
  let totalBalance = 0n;
  let totalReserved = 0n;
  for (const assetVal of assetsVec) {
    const decoded = decodeAssetTreasurySummary(assetVal);
    if (decoded && decoded.asset) {
      assets.push(decoded);
      totalBalance += decoded.balance;
      totalReserved += decoded.reservedAmount;
    }
  }

  return {
    employer: rawEmployer || employer,
    totalBalance,
    totalReserved,
    totalAvailable: totalBalance - totalReserved,
    assets,
    asOfLedger: entries.as_of_ledger ? scValToNumber(entries.as_of_ledger) : undefined,
    fetchedAt: Date.now(),
  };
}

/**
 * Fetch the treasury summary from the contract.
 *
 * Calls the contract's `get_treasury_summary` method and normalizes the
 * response into a typed, UI-safe `TreasurySummary`.
 *
 * @param contractWrapper - A `BaseContractWrapper` instance (e.g. `TreasuryReservationClient`)
 * @param employer - Employer/company Stellar address
 * @param options - Fetch options including signer and network
 * @returns Normalized treasury summary with safe defaults
 */
export async function fetchTreasurySummary(
  contractWrapper: BaseContractWrapper,
  employer: string,
  options: FetchTreasurySummaryOptions
): Promise<TreasurySummary> {
  const args: xdr.ScVal[] = [new Address(employer).toScVal()];

  try {
    const result = await contractWrapper["invoke"](
      "get_treasury_summary",
      args,
      toISigner(options.signer),
      options.network ?? Networks.TESTNET,
      options.requestId
    );

    return normalizeTreasurySummary(result, employer);
  } catch (error) {
    // Return empty summary with error info instead of throwing, so the UI
    // can show graceful degradation (mirrors `fetchPeriodSummary`).
    const empty = createEmptyTreasurySummary(employer);
    (empty as TreasurySummary & { _error?: unknown })._error = error;
    return empty;
  }
}

/**
 * Create a mock treasury summary for testing and development.
 *
 * @param overrides - Partial summary to override defaults
 * @returns Complete treasury summary with defaults filled in
 */
export function createMockTreasurySummary(
  overrides: Partial<TreasurySummary> = {}
): TreasurySummary {
  const defaults: TreasurySummary = {
    employer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    totalBalance: 5000000000n,
    totalReserved: 1000000000n,
    totalAvailable: 4000000000n,
    assets: [
      {
        asset: "native",
        balance: 5000000000n,
        reservedAmount: 1000000000n,
        availableAmount: 4000000000n,
      },
    ],
    asOfLedger: 100000,
    fetchedAt: Date.now(),
  };

  return { ...defaults, ...overrides };
}
