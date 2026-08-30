/**
 * Types for the funding reservation "created" event decoder (Issue #373),
 * and shared types for the admin/lifecycle event decoders in this folder
 * (`employerOnboarding.ts`, `operatorRemoval.ts`).
 *
 * `ReservationAssetAmount`/`FundingReservationCreatedEvent` are kept
 * distinct from `../treasury/types.ts`'s `ReservationEvent` (a normalized,
 * already-decoded lifecycle event used by `../reservations/helpers.ts` for
 * timeline/audit analysis) — this module decodes the *raw* contract event
 * topics/data into a typed object in the first place.
 */

import type { RawContractEvent } from "../event-parser";

export type { RawContractEvent };

/** A single reserved amount for one asset within a (possibly multi-asset)
 * funding reservation. */
export interface ReservationAssetAmount {
  asset: string;
  amount: bigint;
}

/** Emitted when a funding reservation is created. May cover more than one
 * asset if the employer reserved funds across several tokens in one call. */
export interface FundingReservationCreatedEvent {
  type: "funding_reservation_created";
  reservationId: string;
  employer: string;
  assets: ReservationAssetAmount[];
  expirationUnixSeconds: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

export class ReservationEventParsingError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ReservationEventParsingError";
  }
}

/**
 * Thrown when an admin/lifecycle event cannot be decoded — e.g. missing
 * required topics or an unrecognized event name.
 */
export class EventDecodingError extends Error {
  constructor(
    message: string,
    public readonly rawEvent?: RawContractEvent
  ) {
    super(message);
    this.name = "EventDecodingError";
  }
}
