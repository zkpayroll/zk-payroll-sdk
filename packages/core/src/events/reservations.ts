/**
 * Funding reservation "created" event decoder (Issue #373).
 *
 * Decodes a raw Soroban contract event into a typed
 * FundingReservationCreatedEvent, supporting both single- and multi-asset
 * reservations. Follows the same topics/data ScVal decoding conventions as
 * ../event-parser.ts.
 */

import { Address, xdr } from "@stellar/stellar-sdk";
import type { RawContractEvent } from "../event-parser";
import {
  ReservationEventParsingError,
  type FundingReservationCreatedEvent,
  type ReservationAssetAmount,
} from "./types";

export { ReservationEventParsingError } from "./types";
export type { FundingReservationCreatedEvent, ReservationAssetAmount } from "./types";

const EVENT_NAME = "funding_reservation_created";

/**
 * Decode a raw contract event into a FundingReservationCreatedEvent.
 *
 * @throws ReservationEventParsingError if the event is malformed or is not
 * a funding_reservation_created event.
 */
export function parseFundingReservationCreatedEvent(
  event: RawContractEvent
): FundingReservationCreatedEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new ReservationEventParsingError("Event has no topics", { event });
  }

  const eventName = decodeSymbol(event.topics[0]);
  if (eventName !== EVENT_NAME) {
    throw new ReservationEventParsingError(
      `Expected event "${EVENT_NAME}", got "${eventName || "<unrecognized>"}"`,
      { event }
    );
  }

  const employer = decodeAddress(event.topics[1]);
  if (!employer) {
    throw new ReservationEventParsingError(
      "Missing or invalid employer topic in funding_reservation_created event",
      { event }
    );
  }

  const data = decodeDataMap(event.data);

  const reservationId = decodeString(data.reservation_id);
  if (!reservationId) {
    throw new ReservationEventParsingError(
      "Missing reservation_id in funding_reservation_created event data",
      { event }
    );
  }

  const assets = decodeAssets(data.assets, event);
  if (assets.length === 0) {
    throw new ReservationEventParsingError(
      "funding_reservation_created event has no reserved assets",
      { event }
    );
  }

  return {
    type: EVENT_NAME,
    reservationId,
    employer,
    assets,
    expirationUnixSeconds: decodeU64AsNumber(data.expiration_unix_seconds),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/** Decode a batch of raw events, skipping (rather than throwing on) any
 * that aren't funding_reservation_created events. Malformed
 * funding_reservation_created events still throw, since a corrupt event of
 * the type we're looking for is a data-integrity problem, not noise. */
export function parseFundingReservationCreatedEvents(
  events: RawContractEvent[]
): FundingReservationCreatedEvent[] {
  const results: FundingReservationCreatedEvent[] = [];
  for (const event of events) {
    const name = event.topics?.[0] ? decodeSymbol(event.topics[0]) : "";
    if (name !== EVENT_NAME) continue;
    results.push(parseFundingReservationCreatedEvent(event));
  }
  return results;
}

// ── ScVal Decoding Helpers ───────────────────────────────────────────────────

function decodeSymbol(scVal: xdr.ScVal | undefined): string {
  if (!scVal) return "";
  try {
    if (scVal.switch()?.name === "scvSymbol") {
      return scVal.sym()?.toString() ?? "";
    }
  } catch {
    // fall through
  }
  return "";
}

function decodeAddress(scVal: xdr.ScVal | undefined): string {
  if (!scVal) return "";
  try {
    return Address.fromScVal(scVal).toString();
  } catch {
    return "";
  }
}

function decodeString(scVal: xdr.ScVal | undefined): string {
  if (!scVal) return "";
  try {
    if (scVal.switch()?.name === "scvString") {
      return scVal.str()?.toString() ?? "";
    }
    if (scVal.switch()?.name === "scvSymbol") {
      return scVal.sym()?.toString() ?? "";
    }
  } catch {
    // fall through
  }
  return "";
}

function decodeBigInt(scVal: xdr.ScVal | undefined): bigint {
  if (!scVal) return 0n;
  try {
    const swName = scVal.switch()?.name;
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
  } catch {
    return 0n;
  }
  return 0n;
}

function decodeU64AsNumber(scVal: xdr.ScVal | undefined): number {
  if (!scVal) return 0;
  try {
    const u64 = scVal.u64();
    if (u64) return Number(u64);
  } catch {
    // fall through
  }
  return 0;
}

function decodeDataMap(scVal: xdr.ScVal): Record<string, xdr.ScVal> {
  const map = scVal.map();
  if (!map) return {};
  const entries: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym()?.toString() ?? "";
    entries[key] = entry.val();
  }
  return entries;
}

/** Decode the `assets` vector — each entry is a map of {asset, amount}. */
function decodeAssets(
  scVal: xdr.ScVal | undefined,
  event: RawContractEvent
): ReservationAssetAmount[] {
  if (!scVal) return [];
  let vec: xdr.ScVal[] | null;
  try {
    vec = scVal.vec();
  } catch {
    throw new ReservationEventParsingError(
      "funding_reservation_created event's assets field is not a vector",
      { event }
    );
  }
  if (!vec) return [];

  return vec.map((entryScVal) => {
    const entry = decodeDataMap(entryScVal);
    const asset = decodeAddress(entry.asset) || decodeString(entry.asset);
    const amount = decodeBigInt(entry.amount);
    if (!asset) {
      throw new ReservationEventParsingError(
        "An asset entry in funding_reservation_created is missing its asset identifier",
        { event }
      );
    }
    return { asset, amount };
  });
}
