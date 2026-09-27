/**
 * Payroll Draft Expiry Event Decoder
 *
 * Decodes `payroll_draft_expiry` contract events into a typed
 * `PayrollDraftExpiryEvent`. Provides safe fallback behavior for
 * malformed payloads by returning a `null` result instead of throwing
 * on non-matching events, while still throwing on corrupt data of the
 * expected event type.
 *
 * This decoder enables indexers, dashboards, and payroll clients to
 * consume draft expiry events safely without exposing sensitive payroll
 * values (amounts, salaries, keys) in error messages or logs.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";

/** Emitted when a payroll draft expires on the contract. */
export interface PayrollDraftExpiryEvent {
  type: "payroll_draft_expiry";
  /** Stellar address of the employer who owns the expired draft. */
  employer: string;
  /** Identifier of the draft that expired. */
  draftId: string;
  /** Unix timestamp (seconds) when the draft was set to expire. */
  expiryTimestamp: number;
  /** Unix timestamp (seconds) when the expiry event was recorded on-chain. */
  expiredAt: number;
  /** Whether the draft was automatically cleaned up or marked as expired. */
  autoCleaned: boolean;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const EVENT_NAME = "payroll_draft_expiry";

/**
 * Parse a single raw `payroll_draft_expiry` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `PayrollDraftExpiryEvent`
 * @throws EventDecodingError if the event is not a `payroll_draft_expiry`
 * event, or is missing required fields
 */
export function parseDraftExpiryEvent(event: RawContractEvent): PayrollDraftExpiryEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new EventDecodingError("Event has no topics", event);
  }

  const eventName = decodeEventName(event.topics[0]);
  if (eventName !== EVENT_NAME) {
    throw new EventDecodingError(
      `Expected "${EVENT_NAME}" event, got "${eventName || "unknown"}"`,
      event
    );
  }

  const employer = decodeAddress(event.topics[1]);
  if (!employer) {
    throw new EventDecodingError(
      "Missing required employer topic in payroll_draft_expiry event",
      event
    );
  }

  const data = decodeDataMap(event.data);

  const draftId = data.draft_id?.str()?.toString();
  if (!draftId) {
    throw new EventDecodingError(
      "Missing required draft_id in payroll_draft_expiry event data",
      event
    );
  }

  const expiryTimestamp = decodeU64AsNumber(data.expiry_timestamp);
  if (expiryTimestamp === 0) {
    throw new EventDecodingError(
      "Invalid or missing expiry_timestamp in payroll_draft_expiry event data",
      event
    );
  }

  const expiredAt = decodeU64AsNumber(data.expired_at);
  if (expiredAt === 0) {
    throw new EventDecodingError(
      "Invalid or missing expired_at in payroll_draft_expiry event data",
      event
    );
  }

  const autoCleaned =
    data.auto_cleaned?.switch()?.name === "scvBool" ? data.auto_cleaned.b() : false;

  return {
    type: "payroll_draft_expiry",
    employer,
    draftId,
    expiryTimestamp,
    expiredAt,
    autoCleaned,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Parse multiple raw `payroll_draft_expiry` events, skipping
 * non-matching events rather than throwing.
 *
 * @param events - Array of raw events
 * @returns Array of decoded `PayrollDraftExpiryEvent` objects
 */
export function parseDraftExpiryEvents(events: RawContractEvent[]): PayrollDraftExpiryEvent[] {
  const results: PayrollDraftExpiryEvent[] = [];
  for (const event of events) {
    const name = event.topics?.[0] ? decodeEventName(event.topics[0]) : "";
    if (name !== EVENT_NAME) continue;
    results.push(parseDraftExpiryEvent(event));
  }
  return results;
}

/**
 * Check whether a raw event is a `payroll_draft_expiry` event, without
 * throwing. Useful for filtering a mixed event stream before parsing.
 */
export function isDraftExpiryEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === EVENT_NAME;
}
