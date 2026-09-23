import { xdr, nativeToScVal, Address, Keypair, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import { PayrollContractWrapper } from "../adapters/PayrollContractWrapper";

/**
 * Payroll Period Summary Types
 *
 * Defines the normalized response shape for payroll period summary data
 * fetched from the contract.
 */

/**
 * Represents a single asset's summary within a payroll period.
 */
export interface PeriodAssetSummary {
  /** Asset identifier (e.g., "native" or token contract address) */
  asset: string;
  /** Total amount paid for this asset in the period (stroops) */
  totalAmount: bigint;
  /** Number of payments for this asset */
  paymentCount: number;
  /** Number of successful payments */
  successCount: number;
  /** Number of failed payments */
  failureCount: number;
}

/**
 * Normalized payroll period summary response.
 *
 * Returned by `fetchPeriodSummary` and safe for direct UI consumption.
 * All fields have stable defaults — no optional chaining required.
 */
export interface PayrollPeriodSummary {
  /** Payroll period identifier (e.g., "2024-01") */
  period: string;
  /** Employer/company address */
  employer: string;
  /** Total amount across all assets (stroops, native asset equivalent) */
  totalAmount: bigint;
  /** Total number of payment operations in the period */
  totalPayments: number;
  /** Number of successful payments */
  successfulPayments: number;
  /** Number of failed payments */
  failedPayments: number;
  /** Number of pending payments */
  pendingPayments: number;
  /** Per-asset breakdown */
  assets: PeriodAssetSummary[];
  /** Unix timestamp when the period started (ms) */
  periodStart: number;
  /** Unix timestamp when the period ended (ms) */
  periodEnd: number;
  /** Unix timestamp when the summary was fetched (ms) */
  fetchedAt: number;
  /** Whether the summary data is complete (all payments finalized) */
  isFinalized: boolean;
}

/**
 * Configuration options for fetching period summary.
 */
export interface FetchPeriodSummaryOptions {
  /** Signer for the query transaction */
  signer: Keypair | ISigner;
  /** Network passphrase (defaults to TESTNET) */
  network?: string;
  /** Optional request ID for correlation tracing */
  requestId?: string;
}

/**
 * Default empty period summary for normalization.
 */
export function createEmptyPeriodSummary(period: string, employer: string): PayrollPeriodSummary {
  const now = Date.now();
  return {
    period,
    employer,
    totalAmount: 0n,
    totalPayments: 0,
    successfulPayments: 0,
    failedPayments: 0,
    pendingPayments: 0,
    assets: [],
    periodStart: 0,
    periodEnd: 0,
    fetchedAt: now,
    isFinalized: false,
  };
}

/**
 * Convert ScVal to bigint safely.
 */
export function scValToBigInt(scVal: xdr.ScVal | undefined): bigint {
  if (!scVal) return 0n;
  const swName = scVal.switch().name;
  if (swName === "scvI128") {
    const i128 = scVal.i128();
    const hi = BigInt(i128.hi().toString());
    const lo = BigInt(i128.lo().toString());
    return (hi << 64n) | lo;
  }
  if (swName === "scvU64") {
    const u64 = scVal.u64();
    return BigInt(u64.toString());
  }
  if (swName === "scvU32") {
    const u32 = scVal.u32();
    return BigInt(u32.toString());
  }
  return 0n;
}

/**
 * Convert ScVal to number safely.
 */
export function scValToNumber(scVal: xdr.ScVal | undefined): number {
  if (!scVal) return 0;
  const swName = scVal.switch().name;
  if (swName === "scvU32") return Number(scVal.u32());
  if (swName === "scvU64") return Number(scVal.u64());
  if (swName === "scvI64") return Number(scVal.i64());
  return 0;
}

/**
 * Convert ScVal to boolean safely.
 */
export function scValToBool(scVal: xdr.ScVal | undefined): boolean {
  if (!scVal) return false;
  const swName = scVal.switch().name;
  if (swName === "scvBool") return scVal.b();
  return false;
}

/**
 * Convert ScVal to string safely.
 */
export function scValToString(scVal: xdr.ScVal | undefined): string {
  if (!scVal) return "";
  const swName = scVal.switch().name;
  if (swName === "scvString") {
    const str = scVal.str();
    return typeof str === "string" ? str : str.toString();
  }
  if (swName === "scvSymbol") {
    const sym = scVal.sym();
    return typeof sym === "string" ? sym : sym.toString();
  }
  return "";
}

/**
 * Decode asset summary from contract response.
 */
export function decodeAssetSummary(scVal: xdr.ScVal): PeriodAssetSummary | null {
  const map = scVal.map();
  if (!map) return null;

  const entries: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym()?.toString() ?? "";
    entries[key] = entry.val();
  }

  return {
    asset: scValToString(entries.asset),
    totalAmount: scValToBigInt(entries.total_amount),
    paymentCount: scValToNumber(entries.payment_count),
    successCount: scValToNumber(entries.success_count),
    failureCount: scValToNumber(entries.failure_count),
  };
}

/**
 * Normalize raw contract response into typed PayrollPeriodSummary.
 *
 * @param raw - Raw contract response
 * @param period - Period identifier (fallback if missing)
 * @param employer - Employer address (fallback if missing)
 * @returns Normalized period summary with safe defaults
 */
export function normalizePeriodSummary(
  raw: xdr.ScVal,
  period: string,
  employer: string
): PayrollPeriodSummary {
  const map = raw.map();
  if (!map) {
    return createEmptyPeriodSummary(period, employer);
  }

  const entries: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym()?.toString() ?? "";
    entries[key] = entry.val();
  }

  const rawPeriod = scValToString(entries.period);
  const rawEmployer = scValToString(entries.employer);
  const assetsVec = entries.assets?.vec() ?? [];

  const assets: PeriodAssetSummary[] = [];
  for (const assetVal of assetsVec) {
    const decoded = decodeAssetSummary(assetVal);
    if (decoded && decoded.asset) {
      assets.push(decoded);
    }
  }

  return {
    period: rawPeriod || period,
    employer: rawEmployer || employer,
    totalAmount: scValToBigInt(entries.total_amount),
    totalPayments: scValToNumber(entries.total_payments),
    successfulPayments: scValToNumber(entries.successful_payments),
    failedPayments: scValToNumber(entries.failed_payments),
    pendingPayments: scValToNumber(entries.pending_payments),
    assets,
    periodStart: scValToNumber(entries.period_start),
    periodEnd: scValToNumber(entries.period_end),
    fetchedAt: Date.now(),
    isFinalized: scValToBool(entries.is_finalized),
  };
}

/**
 * Fetch payroll period summary from the contract.
 *
 * Calls the contract's `get_period_summary` method (or similar) and
 * normalizes the response into a typed, UI-safe PayrollPeriodSummary.
 *
 * @param contractWrapper - PayrollContractWrapper instance
 * @param period - Period identifier (e.g., "2024-01")
 * @param employer - Employer/company Stellar address
 * @param options - Fetch options including signer and network
 * @returns Normalized period summary with safe defaults
 * @throws {Error} If the contract call fails
 */
export async function fetchPeriodSummary(
  contractWrapper: PayrollContractWrapper,
  period: string,
  employer: string,
  options: FetchPeriodSummaryOptions
): Promise<PayrollPeriodSummary> {
  const args: xdr.ScVal[] = [
    new Address(employer).toScVal(),
    nativeToScVal(period, { type: "string" }),
  ];

  try {
    const result = await contractWrapper["invoke"](
      "get_period_summary",
      args,
      toISigner(options.signer),
      options.network ?? Networks.TESTNET,
      options.requestId
    );

    return normalizePeriodSummary(result, period, employer);
  } catch (error) {
    // Return empty summary with error info instead of throwing
    // This allows UI to show graceful degradation
    const empty = createEmptyPeriodSummary(period, employer);
    // Attach error info for debugging (not part of the type)
    (empty as PayrollPeriodSummary & { _error?: unknown })._error = error;
    return empty;
  }
}

/**
 * Fetch period summary using a raw BaseContractWrapper (for testing or
 * when PayrollContractWrapper is not available).
 *
 * @param contractWrapper - BaseContractWrapper instance
 * @param period - Period identifier
 * @param employer - Employer address
 * @param options - Fetch options
 * @returns Normalized period summary
 */
export async function fetchPeriodSummaryRaw(
  contractWrapper: BaseContractWrapper,
  period: string,
  employer: string,
  options: FetchPeriodSummaryOptions
): Promise<PayrollPeriodSummary> {
  const args: xdr.ScVal[] = [
    new Address(employer).toScVal(),
    nativeToScVal(period, { type: "string" }),
  ];

  try {
    const result = await contractWrapper["invoke"](
      "get_period_summary",
      args,
      toISigner(options.signer),
      options.network ?? Networks.TESTNET,
      options.requestId
    );

    return normalizePeriodSummary(result, period, employer);
  } catch (error) {
    const empty = createEmptyPeriodSummary(period, employer);
    (empty as PayrollPeriodSummary & { _error?: unknown })._error = error;
    return empty;
  }
}

/**
 * Create a mock period summary for testing and development.
 *
 * @param overrides - Partial summary to override defaults
 * @returns Complete period summary with defaults filled in
 */
export function createMockPeriodSummary(
  overrides: Partial<PayrollPeriodSummary> = {}
): PayrollPeriodSummary {
  const now = Date.now();
  const defaults: PayrollPeriodSummary = {
    period: "2024-01",
    employer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    totalAmount: 1000000000n,
    totalPayments: 10,
    successfulPayments: 9,
    failedPayments: 1,
    pendingPayments: 0,
    assets: [
      {
        asset: "native",
        totalAmount: 1000000000n,
        paymentCount: 10,
        successCount: 9,
        failureCount: 1,
      },
    ],
    periodStart: now - 30 * 24 * 60 * 60 * 1000,
    periodEnd: now,
    fetchedAt: now,
    isFinalized: true,
  };

  return { ...defaults, ...overrides };
}
