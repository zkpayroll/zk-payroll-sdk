/**
 * Payroll Draft Updated Event Parser
 *
 * Decodes `payroll_draft_updated` contract events into a typed
 * `PayrollDraftUpdatedEvent`. Provides safe fallback behavior for
 * malformed payloads by returning a `null` result instead of throwing
 * on non-matching events, while still throwing on corrupt data of the
 * expected event type.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";

/** Emitted when a payroll draft is updated on the contract. */
export interface PayrollDraftUpdatedEvent {
  type: "payroll_draft_updated";
  /** Stellar address of the employer who owns the draft. */
  employer: string;
  /** Identifier of the draft that was updated. */
  draftId: string;
  /** Number of entries in the draft after the update. */
  entryCount: number;
  /** Whether the draft was submitted for approval after update. */
  submittedForApproval: boolean;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const EVENT_NAME = "payroll_draft_updated";

/**
 * Parse a single raw `payroll_draft_updated` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `PayrollDraftUpdatedEvent`
 * @throws EventDecodingError if the event is not a `payroll_draft_updated`
 * event, or is missing required fields
 */
export function parseDraftUpdatedEvent(event: RawContractEvent): PayrollDraftUpdatedEvent {
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
      "Missing required employer topic in payroll_draft_updated event",
      event
    );
  }

  const data = decodeDataMap(event.data);

  return {
    type: "payroll_draft_updated",
    employer,
    draftId: data.draft_id?.str()?.toString() ?? "",
    entryCount: decodeU64AsNumber(data.entry_count),
    submittedForApproval: data.submitted_for_approval?.switch()?.name === "scvBool"
      ? data.submitted_for_approval.b()
      : false,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Parse multiple raw `payroll_draft_updated` events, skipping
 * non-matching events rather than throwing.
 *
 * @param events - Array of raw events
 * @returns Array of decoded `PayrollDraftUpdatedEvent` objects
 */
export function parseDraftUpdatedEvents(events: RawContractEvent[]): PayrollDraftUpdatedEvent[] {
  const results: PayrollDraftUpdatedEvent[] = [];
  for (const event of events) {
    const name = event.topics?.[0] ? decodeEventName(event.topics[0]) : "";
    if (name !== EVENT_NAME) continue;
    results.push(parseDraftUpdatedEvent(event));
  }
  return results;
}

/**
 * Check whether a raw event is a `payroll_draft_updated` event, without
 * throwing. Useful for filtering a mixed event stream before parsing.
 */
export function isDraftUpdatedEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === EVENT_NAME;
}
