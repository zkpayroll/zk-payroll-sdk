/**
 * Settlement Retention Guard (#854)
 *
 * Blocks retention purge helpers while a payroll settlement is currently pending
 * or in-flight in the SDK layer, preventing premature destruction of data required
 * for reconciliation, dispute handling, or settlement finalization.
 */

import { SafePayrollError } from "../errors/safeErrors";

export type SettlementStatus =
  | "pending"
  | "processing"
  | "in_flight"
  | "settling"
  | "settled"
  | "finalized"
  | "failed"
  | "cancelled";

export interface RetentionPurgeRecord {
  readonly id: string;
  readonly expiresAt?: number;
  readonly settlementId?: string;
  readonly cycleId?: string;
  readonly [key: string]: unknown;
}

export interface RetentionPurgeOptions {
  /** The current status of settlement in the active context */
  readonly settlementStatus?: SettlementStatus | string;
  /** Active settlement IDs currently pending */
  readonly activeSettlementIds?: readonly string[];
  /** Reference timestamp in ms for expiry checks (defaults to Date.now()) */
  readonly referenceTimeMs?: number;
  /** Override flag for emergency administrative workflows */
  readonly force?: boolean;
}

export interface RetentionPurgeResult<T extends RetentionPurgeRecord> {
  readonly purgedCount: number;
  readonly retainedCount: number;
  readonly remainingRecords: readonly T[];
  readonly purgedRecords: readonly T[];
  readonly settlementStatus: string;
  readonly timestamp: number;
}

/**
 * Thrown when an attempt is made to purge retention records while settlement is pending.
 * Redacts any sensitive internal IDs or payroll amounts.
 */
export class RetentionPurgeBlockedError extends SafePayrollError {
  public readonly settlementStatus: string;

  constructor(status: string) {
    const sanitizedStatus = status ? status.toLowerCase() : "unknown";
    super(
      `Retention purge operations are blocked while payroll settlement is pending (status: ${sanitizedStatus}).`,
      "ERR_RETENTION_PURGE_BLOCKED_PENDING_SETTLEMENT",
      "Wait for in-flight settlement batches to transition to 'settled', 'failed', or 'cancelled' before executing retention purge."
    );
    this.name = "RetentionPurgeBlockedError";
    this.settlementStatus = sanitizedStatus;
  }
}

/**
 * Determines whether a given settlement status indicates active/pending settlement.
 */
export function isSettlementPending(status?: string | null): boolean {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "pending" ||
    normalized === "processing" ||
    normalized === "in_flight" ||
    normalized === "settling"
  );
}

/**
 * Asserts that retention purge is allowed given the provided options.
 * Throws RetentionPurgeBlockedError if settlement is currently pending.
 */
export function assertRetentionPurgeAllowed(options?: RetentionPurgeOptions): void {
  if (options?.force) {
    return;
  }

  const hasPendingStatus = isSettlementPending(options?.settlementStatus);
  const hasActiveSettlements = Boolean(
    options?.activeSettlementIds && options.activeSettlementIds.length > 0
  );

  if (hasPendingStatus || hasActiveSettlements) {
    throw new RetentionPurgeBlockedError(options?.settlementStatus ?? "pending");
  }
}

/**
 * Safely purges retention records that have expired past their retention window,
 * strictly verifying that no pending settlement is in flight.
 */
export function purgeRetentionRecords<T extends RetentionPurgeRecord>(
  records: readonly T[],
  options?: RetentionPurgeOptions
): RetentionPurgeResult<T> {
  assertRetentionPurgeAllowed(options);

  const referenceTime = options?.referenceTimeMs ?? Date.now();
  const purged: T[] = [];
  const remaining: T[] = [];

  for (const record of records) {
    if (typeof record.expiresAt === "number" && record.expiresAt <= referenceTime) {
      purged.push(record);
    } else {
      remaining.push(record);
    }
  }

  return {
    purgedCount: purged.length,
    retainedCount: remaining.length,
    remainingRecords: remaining,
    purgedRecords: purged,
    settlementStatus: options?.settlementStatus ?? "idle",
    timestamp: referenceTime,
  };
}
