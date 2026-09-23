/**
 * Batch Lock Timestamp Reader
 *
 * Reads and formats payroll batch lock timestamps from the contract, so
 * dashboard components have one reliable source for lock timestamp
 * display instead of re-deriving it from raw contract state.
 */

import { xdr, nativeToScVal, Address, Keypair, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import { scValToBigInt, scValToBool, scValToString } from "./periodSummary";

/**
 * Normalized payroll batch lock timestamp response.
 *
 * Returned by `fetchBatchLockTimestamp` and safe for direct UI consumption.
 */
export interface BatchLockTimestamp {
  /** Payroll batch identifier */
  batchId: string;
  /** Employer/company address */
  employer: string;
  /** Whether the batch is currently locked */
  isLocked: boolean;
  /** Unix timestamp when the batch was locked (ms); 0 if never locked */
  lockedAt: number;
  /** Address of the operator/admin who locked the batch, if recorded */
  lockedBy?: string;
  /** Unix timestamp when the batch was or will be unlocked (ms), if recorded */
  unlockAt?: number;
  /** Unix timestamp when this reading was fetched (ms) */
  fetchedAt: number;
}

/**
 * Configuration options for fetching a batch lock timestamp.
 */
export interface FetchBatchLockTimestampOptions {
  /** Signer for the query transaction */
  signer: Keypair | ISigner;
  /** Network passphrase (defaults to TESTNET) */
  network?: string;
  /** Optional request ID for correlation tracing */
  requestId?: string;
}

/**
 * Default empty/unlocked lock timestamp for normalization.
 */
export function createEmptyLockTimestamp(batchId: string, employer: string): BatchLockTimestamp {
  return {
    batchId,
    employer,
    isLocked: false,
    lockedAt: 0,
    fetchedAt: Date.now(),
  };
}

/**
 * Normalize a raw contract response into a typed `BatchLockTimestamp`.
 *
 * @param raw - Raw contract response
 * @param batchId - Batch identifier (fallback if missing from the response)
 * @param employer - Employer address (fallback if missing from the response)
 * @returns Normalized lock timestamp with safe defaults
 */
export function normalizeLockTimestamp(
  raw: xdr.ScVal,
  batchId: string,
  employer: string
): BatchLockTimestamp {
  const map = raw.map();
  if (!map) {
    return createEmptyLockTimestamp(batchId, employer);
  }

  const entries: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym()?.toString() ?? "";
    entries[key] = entry.val();
  }

  const rawBatchId = scValToString(entries.batch_id);
  const rawEmployer = scValToString(entries.employer);
  const lockedAtSeconds = scValToBigInt(entries.locked_at);
  const unlockAtSeconds = entries.unlock_at ? scValToBigInt(entries.unlock_at) : undefined;

  return {
    batchId: rawBatchId || batchId,
    employer: rawEmployer || employer,
    isLocked: scValToBool(entries.is_locked),
    lockedAt: Number(lockedAtSeconds) * 1000,
    lockedBy: entries.locked_by ? scValToString(entries.locked_by) || undefined : undefined,
    unlockAt: unlockAtSeconds !== undefined ? Number(unlockAtSeconds) * 1000 : undefined,
    fetchedAt: Date.now(),
  };
}

/**
 * Fetch the batch lock timestamp from the contract.
 *
 * Calls the contract's `get_lock_timestamp` method and normalizes the
 * response into a typed, UI-safe `BatchLockTimestamp`.
 *
 * @param contractWrapper - A `BaseContractWrapper` instance
 * @param batchId - Payroll batch identifier
 * @param employer - Employer/company Stellar address
 * @param options - Fetch options including signer and network
 * @returns Normalized lock timestamp with safe defaults
 */
export async function fetchBatchLockTimestamp(
  contractWrapper: BaseContractWrapper,
  batchId: string,
  employer: string,
  options: FetchBatchLockTimestampOptions
): Promise<BatchLockTimestamp> {
  const args: xdr.ScVal[] = [
    new Address(employer).toScVal(),
    nativeToScVal(batchId, { type: "string" }),
  ];

  try {
    const result = await contractWrapper["invoke"](
      "get_lock_timestamp",
      args,
      toISigner(options.signer),
      options.network ?? Networks.TESTNET,
      options.requestId
    );

    return normalizeLockTimestamp(result, batchId, employer);
  } catch (error) {
    // Return an unlocked default with error info instead of throwing, so
    // the UI can show graceful degradation (mirrors `fetchPeriodSummary`).
    const empty = createEmptyLockTimestamp(batchId, employer);
    (empty as BatchLockTimestamp & { _error?: unknown })._error = error;
    return empty;
  }
}

/**
 * Format a `BatchLockTimestamp` into a single, stable, human-readable
 * label for dashboard/UI display.
 *
 * @param lock - A normalized batch lock timestamp
 * @returns e.g. `"Locked since 2024-01-15T10:00:00.000Z"` or `"Not locked"`
 */
export function formatLockTimestamp(lock: BatchLockTimestamp): string {
  if (!lock.isLocked || !lock.lockedAt) {
    return "Not locked";
  }

  const lockedAtIso = new Date(lock.lockedAt).toISOString();
  const suffix = lock.lockedBy ? ` by ${lock.lockedBy}` : "";
  return `Locked since ${lockedAtIso}${suffix}`;
}

/**
 * Create a mock batch lock timestamp for testing and development.
 *
 * @param overrides - Partial lock timestamp to override defaults
 * @returns Complete lock timestamp with defaults filled in
 */
export function createMockLockTimestamp(
  overrides: Partial<BatchLockTimestamp> = {}
): BatchLockTimestamp {
  const now = Date.now();
  const defaults: BatchLockTimestamp = {
    batchId: "batch-2024-01",
    employer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    isLocked: true,
    lockedAt: now - 60 * 60 * 1000,
    lockedBy: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF",
    fetchedAt: now,
  };

  return { ...defaults, ...overrides };
}
