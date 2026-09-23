/**
 * Operator Removal Event Parser
 *
 * Decodes `operator_removed` contract events into a typed
 * `OperatorRemovedEvent`. Role audit timelines rely on this for reliable
 * event parsing of operator removal actions; see `admin/operators.ts` for
 * the stable UI helper labels that pair with these events.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";

/** Emitted when a treasury/payroll operator role is removed on the contract. */
export interface OperatorRemovedEvent {
  type: "operator_removed";
  /** Stellar address of the operator that was removed. */
  operator: string;
  /** Address of the admin who performed the removal, if recorded. */
  removedBy?: string;
  /** Optional reason code for the removal (e.g. "revoked", "voluntary"). */
  reason?: string;
  /** Unix seconds when the removal occurred, as recorded on-chain. */
  removedAt: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const EVENT_NAME = "operator_removed";

/**
 * Parse a single raw `operator_removed` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `OperatorRemovedEvent`
 * @throws EventDecodingError if the event is not an `operator_removed`
 * event, or is missing the required operator topic
 *
 * @example
 * ```ts
 * import { parseOperatorRemovalEvent } from "@zk-payroll/core";
 *
 * const event = parseOperatorRemovalEvent(rawEvent);
 * console.log(event.operator, event.reason);
 * ```
 */
export function parseOperatorRemovalEvent(event: RawContractEvent): OperatorRemovedEvent {
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

  const operator = decodeAddress(event.topics[1]);
  if (!operator) {
    throw new EventDecodingError(
      "Missing required operator topic in operator_removed event",
      event
    );
  }

  const data = decodeDataMap(event.data);

  return {
    type: "operator_removed",
    operator,
    removedBy: data.removed_by ? decodeAddress(data.removed_by) || undefined : undefined,
    reason: data.reason?.str()?.toString(),
    removedAt: decodeU64AsNumber(data.removed_at),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Parse multiple raw `operator_removed` events.
 *
 * @param events - Array of raw events
 * @returns Array of decoded `OperatorRemovedEvent` objects
 * @throws EventDecodingError if any event fails to parse
 */
export function parseOperatorRemovalEvents(events: RawContractEvent[]): OperatorRemovedEvent[] {
  return events.map(parseOperatorRemovalEvent);
}

/**
 * Check whether a raw event is an `operator_removed` event, without
 * throwing. Useful for filtering a mixed event stream before parsing.
 */
export function isOperatorRemovalEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === EVENT_NAME;
}
