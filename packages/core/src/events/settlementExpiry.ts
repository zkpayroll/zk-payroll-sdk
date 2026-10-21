/**
 * Settlement Expiry Event Decoder
 *
 * Decodes `settlement_expired` contract events into a typed
 * `SettlementExpiredEvent` with a normalized reason code. Provides safe
 * fallback behavior for unknown reason codes by mapping them to `UNKNOWN`
 * rather than throwing, while still rejecting structurally invalid events.
 *
 * Privacy guarantee: decoded events and error messages never include
 * private employee identifiers, salary amounts, or recipient addresses.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";
import {
  decodePayrollLifecycleEventSchemaVersion,
  type PayrollLifecycleEventSchemaVersion,
} from "./versioning";
import {
  normalizeSettlementExpiryReason,
  type SettlementExpiryReasonCodeType,
} from "../errors/settlementExpiryReasonCodes";

/** Emitted when a payroll run's settlement window expires before settling. */
export interface SettlementExpiredEvent {
  type: "settlement_expired";
  schemaVersion: PayrollLifecycleEventSchemaVersion;
  /** Stellar address of the employer who owned the expired settlement. */
  employer: string;
  /** Identifier of the payroll run or settlement that expired. */
  settlementId: string;
  /** Normalized machine-readable expiry reason code. */
  reasonCode: SettlementExpiryReasonCodeType;
  /** Raw reason code string as emitted on-chain, if present. */
  rawReasonCode?: string;
  /** Unix timestamp (seconds) when the settlement was originally scheduled to settle. */
  scheduledAt: number;
  /** Unix timestamp (seconds) when the expiry was recorded on-chain. */
  expiredAt: number;
  /** Unix timestamp (seconds) when the settlement window closed. */
  windowClosedAt?: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const EVENT_NAME = "settlement_expired";

/**
 * Parse a single raw `settlement_expired` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `SettlementExpiredEvent` with a normalized reason code
 * @throws EventDecodingError if the event is not a `settlement_expired` event,
 *   or is missing required fields
 *
 * @example
 * ```ts
 * import { parseSettlementExpiredEvent } from "@zk-payroll/core";
 *
 * const event = parseSettlementExpiredEvent(rawEvent);
 * console.log(event.reasonCode); // "SETTLEMENT_WINDOW_ELAPSED"
 * ```
 */
export function parseSettlementExpiredEvent(event: RawContractEvent): SettlementExpiredEvent {
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
      "Missing required employer topic in settlement_expired event",
      event
    );
  }

  const data = decodeDataMap(event.data);
  const schemaVersion = decodePayrollLifecycleEventSchemaVersion(data, EVENT_NAME, event);

  const settlementId = data.settlement_id?.str()?.toString() ?? data.run_id?.str()?.toString();
  if (!settlementId) {
    throw new EventDecodingError(
      "Missing required settlement_id in settlement_expired event data",
      event
    );
  }

  const rawReasonCode = data.reason_code?.str()?.toString();
  const reasonCode = normalizeSettlementExpiryReason(rawReasonCode);

  const scheduledAt = decodeU64AsNumber(data.scheduled_at);
  const expiredAt = decodeU64AsNumber(data.expired_at);
  if (expiredAt === 0) {
    throw new EventDecodingError(
      "Invalid or missing expired_at in settlement_expired event data",
      event
    );
  }

  const windowClosedAtRaw = decodeU64AsNumber(data.window_closed_at);

  return {
    type: "settlement_expired",
    schemaVersion,
    employer,
    settlementId,
    reasonCode,
    rawReasonCode,
    scheduledAt,
    expiredAt,
    windowClosedAt: windowClosedAtRaw || undefined,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Non-throwing variant that returns `null` when the event is not a
 * `settlement_expired` event, making it safe for filtering mixed event streams.
 * Still throws on structurally corrupt events of the expected type.
 */
export function tryParseSettlementExpiredEvent(
  event: RawContractEvent
): SettlementExpiredEvent | null {
  if (!event.topics || event.topics.length === 0) return null;
  const eventName = decodeEventName(event.topics[0]);
  if (eventName !== EVENT_NAME) return null;
  return parseSettlementExpiredEvent(event);
}

/** Predicate for filtering `settlement_expired` events from a stream. */
export function isSettlementExpiredEvent(event: RawContractEvent): boolean {
  return tryParseSettlementExpiredEvent(event) !== null;
}

/**
 * Parse a mixed array of raw events, returning only the typed
 * `settlement_expired` events. Non-matching events are silently skipped;
 * structurally corrupt settlement events still throw.
 */
export function parseSettlementExpiredEvents(events: RawContractEvent[]): SettlementExpiredEvent[] {
  return events
    .map((e) => tryParseSettlementExpiredEvent(e))
    .filter((e): e is SettlementExpiredEvent => e !== null);
}
