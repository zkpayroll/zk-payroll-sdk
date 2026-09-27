/**
 * Employer Updated Event Decoder
 *
 * Decodes `employer_updated` contract events into a typed
 * `EmployerUpdatedEvent`. This is used to track configuration or
 * metadata changes to an employer's payroll setup.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";

/** Emitted when an employer updates their configuration on the contract. */
export interface EmployerUpdatedEvent {
  type: "employer_updated";
  /** Stellar address of the employer whose config was updated. */
  employer: string;
  /** Address of the admin/operator who performed the update, if recorded. */
  updatedBy?: string;
  /** Unix seconds when the update completed, as recorded on-chain. */
  updatedAt: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const EVENT_NAME = "employer_updated";

/**
 * Decode a single raw `employer_updated` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `EmployerUpdatedEvent`
 * @throws EventDecodingError if the event is not an `employer_updated`
 * event, or is missing the required employer topic
 */
export function decodeEmployerUpdatedEvent(event: RawContractEvent): EmployerUpdatedEvent {
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
      "Missing required employer topic in employer_updated event",
      event
    );
  }

  const data = decodeDataMap(event.data);

  return {
    type: "employer_updated",
    employer,
    updatedBy: data.updated_by ? decodeAddress(data.updated_by) || undefined : undefined,
    updatedAt: data.updated_at ? decodeU64AsNumber(data.updated_at) : Date.now() / 1000,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Decode multiple raw `employer_updated` events.
 *
 * @param events - Array of raw events
 * @returns Array of decoded `EmployerUpdatedEvent` objects
 * @throws EventDecodingError if any event fails to decode
 */
export function decodeEmployerUpdatedEvents(events: RawContractEvent[]): EmployerUpdatedEvent[] {
  return events.map(decodeEmployerUpdatedEvent);
}

/**
 * Check whether a raw event is an `employer_updated` event, without
 * throwing. Useful for filtering a mixed event stream before decoding.
 */
export function isEmployerUpdatedEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === EVENT_NAME;
}
