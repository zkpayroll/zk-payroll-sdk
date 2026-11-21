/**
 * Hardened State Handling for Treasury Reservations (#883).
 *
 * Implements an immutable, versioned, tamper-evident state manager for
 * treasury reservations. Guarantees idempotency, prevents double-spending
 * of reserved liquidity, and maintains SHA-256 integrity hash chaining.
 *
 * @module
 */

import { createHash } from "crypto";
import {
  SafeTreasuryReservationError,
  formatSafeTreasuryReservationIssue,
} from "./reservationErrors";

export type TreasuryReservationStatus =
  | "PENDING"
  | "ACTIVE"
  | "COMMITTED"
  | "RELEASED"
  | "EXPIRED";

export interface TreasuryReservationRecord {
  readonly reservationId: string;
  readonly amount: bigint;
  readonly asset: string;
  readonly status: TreasuryReservationStatus;
  readonly version: number;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly committedAt?: number;
  readonly releasedAt?: number;
  readonly previousHash?: string;
  readonly stateHash: string;
}

/**
 * Computes a deterministic SHA-256 state integrity hash for a reservation record.
 */
export function computeReservationStateHash(
  reservationId: string,
  amount: bigint,
  asset: string,
  status: TreasuryReservationStatus,
  version: number,
  createdAt: number,
  previousHash: string = "GENESIS"
): string {
  const payload = `${reservationId}:${amount.toString()}:${asset}:${status}:${version}:${createdAt}:${previousHash}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export class TreasuryReservationStateManager {
  private readonly records: Map<string, TreasuryReservationRecord> = new Map();
  private totalActiveReserved: bigint = 0n;

  /**
   * Registers a new reservation in ACTIVE state.
   */
  public createReservation(
    reservationId: string,
    amount: bigint,
    asset: string = "XLM",
    expiresAt?: number,
    now: number = Date.now()
  ): TreasuryReservationRecord {
    const trimmedId = reservationId ? reservationId.trim() : "";
    if (!trimmedId) {
      const issue = formatSafeTreasuryReservationIssue("EMPTY_RESERVATION_ID", "reservationId");
      throw new SafeTreasuryReservationError(issue.message, issue.code, [issue]);
    }

    if (this.records.has(trimmedId)) {
      const issue = formatSafeTreasuryReservationIssue("DUPLICATE_RESERVATION_ID", "reservationId");
      throw new SafeTreasuryReservationError(issue.message, issue.code, [issue]);
    }

    if (amount < 0n) {
      const issue = formatSafeTreasuryReservationIssue("NEGATIVE_AMOUNT", "amount");
      throw new SafeTreasuryReservationError(issue.message, issue.code, [issue]);
    }

    const stateHash = computeReservationStateHash(
      trimmedId,
      amount,
      asset,
      "ACTIVE",
      1,
      now,
      "GENESIS"
    );

    const record: TreasuryReservationRecord = Object.freeze({
      reservationId: trimmedId,
      amount,
      asset,
      status: "ACTIVE",
      version: 1,
      createdAt: now,
      expiresAt,
      stateHash,
    });

    this.records.set(trimmedId, record);
    this.totalActiveReserved += amount;
    return record;
  }

  /**
   * Commits an active reservation to finalized disbursement (terminal state).
   */
  public commitReservation(
    reservationId: string,
    now: number = Date.now()
  ): TreasuryReservationRecord {
    const record = this.getReservation(reservationId);

    // Idempotent commit: if already committed, return existing record
    if (record.status === "COMMITTED") {
      return record;
    }

    if (record.status === "RELEASED" || record.status === "EXPIRED") {
      const issue = formatSafeTreasuryReservationIssue("INVALID_RESERVATION_STATE", "status");
      throw new SafeTreasuryReservationError(issue.message, issue.code, [issue]);
    }

    // Check expiration
    if (record.expiresAt && now > record.expiresAt) {
      this.markExpiredInternal(record, now);
      const issue = formatSafeTreasuryReservationIssue("RESERVATION_EXPIRED", "expiresAt");
      throw new SafeTreasuryReservationError(issue.message, issue.code, [issue]);
    }

    const newVersion = record.version + 1;
    const newStateHash = computeReservationStateHash(
      record.reservationId,
      record.amount,
      record.asset,
      "COMMITTED",
      newVersion,
      record.createdAt,
      record.stateHash
    );

    const updated: TreasuryReservationRecord = Object.freeze({
      ...record,
      status: "COMMITTED",
      version: newVersion,
      committedAt: now,
      previousHash: record.stateHash,
      stateHash: newStateHash,
    });

    this.records.set(record.reservationId, updated);
    this.totalActiveReserved -= record.amount;
    return updated;
  }

  /**
   * Releases an active reservation back to unreserved treasury liquidity.
   */
  public releaseReservation(
    reservationId: string,
    now: number = Date.now()
  ): TreasuryReservationRecord {
    const record = this.getReservation(reservationId);

    // Idempotent release
    if (record.status === "RELEASED") {
      return record;
    }

    if (record.status === "COMMITTED") {
      const issue = formatSafeTreasuryReservationIssue("RESERVATION_ALREADY_COMMITTED", "status");
      throw new SafeTreasuryReservationError(issue.message, issue.code, [issue]);
    }

    const newVersion = record.version + 1;
    const newStateHash = computeReservationStateHash(
      record.reservationId,
      record.amount,
      record.asset,
      "RELEASED",
      newVersion,
      record.createdAt,
      record.stateHash
    );

    const updated: TreasuryReservationRecord = Object.freeze({
      ...record,
      status: "RELEASED",
      version: newVersion,
      releasedAt: now,
      previousHash: record.stateHash,
      stateHash: newStateHash,
    });

    this.records.set(record.reservationId, updated);
    if (record.status === "ACTIVE") {
      this.totalActiveReserved -= record.amount;
    }
    return updated;
  }

  /**
   * Checks whether the current record's SHA-256 state hash matches its content.
   */
  public verifyIntegrity(reservationId: string): boolean {
    const record = this.getReservation(reservationId);
    const expectedHash = computeReservationStateHash(
      record.reservationId,
      record.amount,
      record.asset,
      record.status,
      record.version,
      record.createdAt,
      record.previousHash ?? "GENESIS"
    );
    return record.stateHash === expectedHash;
  }

  public getReservation(reservationId: string): TreasuryReservationRecord {
    const record = this.records.get(reservationId ? reservationId.trim() : "");
    if (!record) {
      const issue = formatSafeTreasuryReservationIssue("RESERVATION_NOT_FOUND", "reservationId");
      throw new SafeTreasuryReservationError(issue.message, issue.code, [issue]);
    }
    return record;
  }

  public getTotalActiveReserved(): bigint {
    return this.totalActiveReserved;
  }

  private markExpiredInternal(record: TreasuryReservationRecord, now: number): void {
    const newVersion = record.version + 1;
    const newStateHash = computeReservationStateHash(
      record.reservationId,
      record.amount,
      record.asset,
      "EXPIRED",
      newVersion,
      record.createdAt,
      record.stateHash
    );

    const updated: TreasuryReservationRecord = Object.freeze({
      ...record,
      status: "EXPIRED",
      version: newVersion,
      previousHash: record.stateHash,
      stateHash: newStateHash,
    });

    this.records.set(record.reservationId, updated);
    this.totalActiveReserved -= record.amount;
  }
}
