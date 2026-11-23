/**
 * Employer Execution Key Rotation Event Decoder
 *
 * Decodes `execution_key_rotated` contract events into a typed
 * `ExecutionKeyRotatedEvent`. The employer's execution key authorizes
 * automated/relayer-submitted payroll runs; rotating it (e.g. after a
 * suspected compromise) must be decodable so audit timelines and
 * signer-validity checks can tell exactly when an old key stopped being
 * authoritative. #828
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeBytes, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";

/** Emitted when an employer rotates their payroll execution key on the contract. */
export interface ExecutionKeyRotatedEvent {
  type: "execution_key_rotated";
  /** Stellar address of the employer whose execution key was rotated. */
  employer: string;
  /** Hex-encoded previous execution key, if recorded on-chain. */
  oldExecutionKey?: string;
  /** Hex-encoded new execution key that is now authoritative. */
  newExecutionKey: string;
  /** Address of the admin/operator who performed the rotation, if recorded. */
  rotatedBy?: string;
  /** Unix seconds when the rotation completed, as recorded on-chain. */
  rotatedAt: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const EVENT_NAME = "execution_key_rotated";

/**
 * Decode a single raw `execution_key_rotated` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `ExecutionKeyRotatedEvent`
 * @throws EventDecodingError if the event is not an `execution_key_rotated`
 * event, or is missing the required employer topic or new key
 */
export function decodeExecutionKeyRotatedEvent(event: RawContractEvent): ExecutionKeyRotatedEvent {
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
      "Missing required employer topic in execution_key_rotated event",
      event
    );
  }

  const data = decodeDataMap(event.data);

  const newExecutionKey = data.new_key ? decodeBytes(data.new_key) : "";
  if (!newExecutionKey) {
    throw new EventDecodingError(
      "Missing required new_key in execution_key_rotated event data",
      event
    );
  }

  return {
    type: "execution_key_rotated",
    employer,
    oldExecutionKey: data.old_key ? decodeBytes(data.old_key) || undefined : undefined,
    newExecutionKey,
    rotatedBy: data.rotated_by ? decodeAddress(data.rotated_by) || undefined : undefined,
    rotatedAt: data.rotated_at ? decodeU64AsNumber(data.rotated_at) : 0,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Decode multiple raw `execution_key_rotated` events.
 *
 * @param events - Array of raw events
 * @returns Array of decoded `ExecutionKeyRotatedEvent` objects
 * @throws EventDecodingError if any event fails to decode
 */
export function decodeExecutionKeyRotatedEvents(
  events: RawContractEvent[]
): ExecutionKeyRotatedEvent[] {
  return events.map(decodeExecutionKeyRotatedEvent);
}

/**
 * Check whether a raw event is an `execution_key_rotated` event, without
 * throwing. Useful for filtering a mixed event stream before decoding.
 */
export function isExecutionKeyRotatedEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === EVENT_NAME;
}
