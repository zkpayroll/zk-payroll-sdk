/**
 * Treasury Reservation Client
 *
 * Provides SDK methods for reserving, releasing, finalizing, and checking
 * the status of funding reservations in the payroll contract.
 *
 * This client handles the full lifecycle of a reservation: from initial
 * creation to release/finalization, with support for expiration detection
 * and duplicate release prevention.
 */

import { rpc, xdr, nativeToScVal, Address, Keypair, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import { ClientOptions, ExecutePaymentRequest, SchedulePaymentRequest } from "../clients/types";
import {
  FundingReservation,
  ReservationEvent,
  ReserveRequest,
  ReserveResponse,
  ReleaseReservationRequest,
  ReleaseReservationResponse,
  FinalizeReservationRequest,
  FinalizeReservationResponse,
  ReservationStatusCheck,
  ReservationStateSnapshot,
} from "./types";

/**
 * TreasuryReservationClient provides contract methods for managing
 * funding reservations throughout their lifecycle.
 *
 * ## Contract Integration
 *
 * This client assumes the contract exposes the following methods:
 * - `reserve(employer, amount, asset, expires_at, memo?)` → reservation_id
 * - `release(reservation_id, amount, reason?)` → ✓
 * - `finalize(reservation_id, used_amount, execution_summary?)` → ✓
 * - `check_reservation(reservation_id)` → ReservationData
 * - `get_events(reservation_id, start?, limit?)` → Event[]
 */
export class TreasuryReservationClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  /**
   * Reserve funds for a payroll execution.
   *
   * This creates a new on-chain reservation, locking the specified amount
   * of funds until the reservation is finalized or released.
   *
   * @param request — Reservation parameters (employer, amount, asset, expiration)
   * @param signer — Keypair or ISigner to sign the contract invocation
   * @param network — Optional network passphrase override
   * @returns Reservation ID and transaction hash
   *
   * @throws {ContractExecutionError} If the contract call fails
   * @throws {ValidationError} If request parameters are invalid
   *
   * ## State Transition
   * ```
   * (no prior state) → reserved
   * ```
   */
  async reserve(
    request: ReserveRequest,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<ReserveResponse> {
    const args: xdr.ScVal[] = [
      new Address(request.employer).toScVal(),
      nativeToScVal(request.amount, { type: "i128" }),
      new Address(request.asset).toScVal(),
      nativeToScVal(request.expirationUnixSeconds, { type: "u64" }),
    ];

    if (request.memo) {
      args.push(nativeToScVal(request.memo, { type: "string" }));
    }

    const result = await this.invoke(
      "reserve",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    const reservationId = this.scValToString(result);
    const txHash = this.getTxHashFromInvoke();

    // Build the FundingReservation from the response
    const reservation: FundingReservation = {
      reservationId,
      employer: request.employer,
      reservedAmount: request.amount,
      asset: request.asset,
      status: "reserved",
      createdAt: Date.now(),
      expiresAt: request.expirationUnixSeconds * 1000, // Convert to ms
      creationTxHash: txHash,
      memo: request.memo,
    };

    return {
      reservationId,
      txHash,
      reservation,
    };
  }

  /**
   * Release a reservation, returning unused funds.
   *
   * Can be called to return funds when payroll execution is cancelled
   * or when only a portion of reserved funds are needed.
   *
   * @param request — Reservation ID and amount to release
   * @param signer — Keypair or ISigner to sign the contract invocation
   * @param network — Optional network passphrase override
   * @returns Updated reservation state and transaction hash
   *
   * @throws {ContractExecutionError} If reservation not found or already terminal
   * @throws {ValidationError} If release amount exceeds reserved amount
   *
   * ## State Transition
   * ```
   * reserved → released
   * ```
   *
   * ## Error Cases
   * - Reservation already finalized → error
   * - Reservation already released → duplicate release attempt (classified)
   * - Amount exceeds reserved → validation error
   */
  async release(
    request: ReleaseReservationRequest,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<ReleaseReservationResponse> {
    const args: xdr.ScVal[] = [
      nativeToScVal(request.reservationId, { type: "string" }),
      nativeToScVal(request.amount, { type: "i128" }),
    ];

    if (request.reason) {
      args.push(nativeToScVal(request.reason, { type: "string" }));
    }

    const result = await this.invoke(
      "release",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    const txHash = this.getTxHashFromInvoke();

    // Decode the result which contains the updated reservation
    const updatedReservation = this.decodeReservation(result);

    return {
      reservationId: request.reservationId,
      txHash,
      releasedAmount: request.amount,
      reservation: updatedReservation,
    };
  }

  /**
   * Finalize a reservation after payroll execution.
   *
   * Records how much of the reserved funds were actually used,
   * and returns any unused portion.
   *
   * @param request — Reservation ID and amount used
   * @param signer — Keypair or ISigner to sign the contract invocation
   * @param network — Optional network passphrase override
   * @returns Updated reservation state with finalization details
   *
   * @throws {ContractExecutionError} If reservation not found or not in reserved state
   * @throws {ValidationError} If used amount exceeds reserved amount
   *
   * ## State Transition
   * ```
   * reserved → finalized
   * ```
   */
  async finalize(
    request: FinalizeReservationRequest,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<FinalizeReservationResponse> {
    const args: xdr.ScVal[] = [
      nativeToScVal(request.reservationId, { type: "string" }),
      nativeToScVal(request.usedAmount, { type: "i128" }),
    ];

    // Include execution summary if provided
    if (request.executionSummary) {
      const summaryMap = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal("total_payments", { type: "string" }),
          val: nativeToScVal(request.executionSummary.totalPayments, { type: "u32" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("successful_payments", { type: "string" }),
          val: nativeToScVal(request.executionSummary.successfulPayments, { type: "u32" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("failed_payments", { type: "string" }),
          val: nativeToScVal(request.executionSummary.failedPayments, { type: "u32" }),
        }),
      ]);
      args.push(summaryMap);
    }

    const result = await this.invoke(
      "finalize",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    const txHash = this.getTxHashFromInvoke();
    const updatedReservation = this.decodeReservation(result);

    const remainingAmount = updatedReservation.reservedAmount - request.usedAmount;

    return {
      reservationId: request.reservationId,
      txHash,
      usedAmount: request.usedAmount,
      remainingAmount: remainingAmount < 0n ? 0n : remainingAmount,
      reservation: updatedReservation,
    };
  }

  /**
   * Check the current status of a reservation.
   *
   * Retrieves detailed information about a reservation, including its
   * current status, expiration time, and all recorded events.
   *
   * @param reservationId — ID of the reservation to check
   * @param signer — Keypair or ISigner to sign the contract query
   * @param network — Optional network passphrase override
   * @returns Comprehensive reservation status and event history
   *
   * @throws {ContractExecutionError} If reservation not found
   */
  async checkStatus(
    reservationId: string,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<ReservationStatusCheck> {
    const args: xdr.ScVal[] = [nativeToScVal(reservationId, { type: "string" })];

    const result = await this.invoke(
      "check_reservation",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    const reservation = this.decodeReservation(result);
    const events = await this.getReservationEvents(reservationId, signer, network);

    const now = Date.now();
    const secondsUntilExpiry = Math.floor((reservation.expiresAt - now) / 1000);
    const isExpired = secondsUntilExpiry < 0;
    const isTerminal =
      reservation.status === "finalized" ||
      reservation.status === "released" ||
      reservation.status === "expired" ||
      reservation.status === "cancelled";

    return {
      reservation,
      events,
      isExpired,
      secondsUntilExpiry,
      isTerminal,
      terminalReason: isTerminal ? `Reservation is in ${reservation.status} state` : undefined,
      checkedAt: now,
    };
  }

  /**
   * Get all events for a reservation.
   *
   * Retrieves the event log for a specific reservation, useful for
   * auditing and reconciliation.
   *
   * @param reservationId — ID of the reservation
   * @param signer — Keypair or ISigner to sign the contract query
   * @param network — Optional network passphrase override
   * @param startIndex — Optional starting index for pagination (default 0)
   * @param limit — Optional limit on number of events (default 100)
   * @returns Array of ReservationEvent objects
   *
   * @throws {ContractExecutionError} If contract call fails
   */
  async getReservationEvents(
    reservationId: string,
    signer: Keypair | ISigner,
    network?: string,
    startIndex: number = 0,
    limit: number = 100
  ): Promise<ReservationEvent[]> {
    const args: xdr.ScVal[] = [
      nativeToScVal(reservationId, { type: "string" }),
      nativeToScVal(startIndex, { type: "u32" }),
      nativeToScVal(limit, { type: "u32" }),
    ];

    const result = await this.invoke(
      "get_events",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    return this.decodeReservationEvents(result);
  }

  /**
   * Get a snapshot of a reservation's complete state at a point in time.
   *
   * Combines the reservation object with its full event history,
   * useful for reconciliation and forensic analysis.
   *
   * @param reservationId — ID of the reservation
   * @param signer — Keypair or ISigner to sign the contract queries
   * @param network — Optional network passphrase override
   * @returns ReservationStateSnapshot with reservation and events
   */
  async getReservationSnapshot(
    reservationId: string,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<ReservationStateSnapshot> {
    const statusCheck = await this.checkStatus(reservationId, signer, network);

    return {
      reservation: statusCheck.reservation,
      events: statusCheck.events,
      snapshotAt: statusCheck.checkedAt,
      isTerminal: statusCheck.isTerminal,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private helper methods
  // ──────────────────────────────────────────────────────────────────────

  private decodeReservation(scVal: xdr.ScVal): FundingReservation {
    const map = scVal.map();
    if (!map) {
      throw new Error("Expected scvMap for FundingReservation");
    }

    const entries: Record<string, xdr.ScVal> = {};
    for (const entry of map) {
      const key = entry.key().sym()?.toString() ?? "";
      entries[key] = entry.val();
    }

    return {
      reservationId: entries.id?.str()?.toString() ?? "",
      employer: Address.fromScVal(entries.employer).toString(),
      reservedAmount: this.scValToBigInt(entries.amount),
      asset: Address.fromScVal(entries.asset).toString(),
      status: (entries.status?.sym()?.toString() ?? "reserved") as any,
      createdAt: Number(this.scValToBigInt(entries.created_at)) * 1000,
      expiresAt: Number(this.scValToBigInt(entries.expires_at)) * 1000,
      concludedAt: entries.concluded_at
        ? Number(this.scValToBigInt(entries.concluded_at)) * 1000
        : undefined,
      usedAmount: entries.used_amount ? this.scValToBigInt(entries.used_amount) : undefined,
      creationTxHash: entries.creation_tx?.str()?.toString(),
      conclusionTxHash: entries.conclusion_tx?.str()?.toString(),
      memo: entries.memo?.str()?.toString(),
    };
  }

  private decodeReservationEvents(scVal: xdr.ScVal): ReservationEvent[] {
    const vec = scVal.vec();
    if (!vec) return [];

    return vec.map((v) => {
      const map = v.map();
      if (!map) throw new Error("Expected scvMap for ReservationEvent");

      const entries: Record<string, xdr.ScVal> = {};
      for (const entry of map) {
        const key = entry.key().sym()?.toString() ?? "";
        entries[key] = entry.val();
      }

      return {
        eventId: entries.id?.str()?.toString() ?? "",
        reservationId: entries.reservation_id?.str()?.toString() ?? "",
        eventType: (entries.event_type?.sym()?.toString() ?? "reserved") as any,
        employer: Address.fromScVal(entries.employer).toString(),
        amount: this.scValToBigInt(entries.amount),
        asset: Address.fromScVal(entries.asset).toString(),
        timestamp: Number(this.scValToBigInt(entries.timestamp)) * 1000,
        txHash: entries.tx_hash?.str()?.toString() ?? "",
        reason: entries.reason?.str()?.toString(),
        conflictingEventId: entries.conflicting_event_id?.str()?.toString(),
      };
    });
  }

  private scValToString(scVal: xdr.ScVal): string {
    const str = scVal.str();
    if (str) return str.toString();
    return "";
  }

  private scValToBigInt(scVal: xdr.ScVal): bigint {
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

  private getTxHashFromInvoke(): string {
    // In a real implementation, this would be captured from the invoke result
    // For now, we return a placeholder that would be filled by the contract response
    return "pending";
  }
}
