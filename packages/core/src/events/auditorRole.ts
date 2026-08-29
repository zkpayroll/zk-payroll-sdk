/**
 * Auditor Role Event Parser
 *
 * Decodes `auditor_assigned` and `auditor_removed` contract events into
 * typed event objects. Provides consistent event handling for audit
 * settings and timelines.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";

/** Emitted when an auditor is assigned a role on the contract. */
export interface AuditorAssignedEvent {
  type: "auditor_assigned";
  /** Stellar address of the auditor being assigned. */
  auditor: string;
  /** Stellar address of the admin who assigned the role. */
  assignedBy: string;
  /** Scope of the auditor's access (e.g. "read-only", "full-audit"). */
  scope?: string;
  /** Unix seconds when the assignment occurred, as recorded on-chain. */
  assignedAt: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/** Emitted when an auditor's role is removed on the contract. */
export interface AuditorRemovedEvent {
  type: "auditor_removed";
  /** Stellar address of the auditor that was removed. */
  auditor: string;
  /** Stellar address of the admin who removed the role. */
  removedBy?: string;
  /** Optional reason code for the removal (e.g. "revoked", "voluntary"). */
  reason?: string;
  /** Unix seconds when the removal occurred, as recorded on-chain. */
  removedAt: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/**
 * Parse a single raw `auditor_assigned` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `AuditorAssignedEvent`
 * @throws EventDecodingError if the event is not an `auditor_assigned`
 * event, or is missing required fields
 */
export function parseAuditorAssignedEvent(event: RawContractEvent): AuditorAssignedEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new EventDecodingError("Event has no topics", event);
  }

  const eventName = decodeEventName(event.topics[0]);
  if (eventName !== "auditor_assigned") {
    throw new EventDecodingError(
      `Expected "auditor_assigned" event, got "${eventName || "unknown"}"`,
      event
    );
  }

  const auditor = decodeAddress(event.topics[1]);
  if (!auditor) {
    throw new EventDecodingError(
      "Missing required auditor topic in auditor_assigned event",
      event
    );
  }

  const data = decodeDataMap(event.data);

  return {
    type: "auditor_assigned",
    auditor,
    assignedBy: decodeAddress(data.assigned_by),
    scope: data.scope?.str()?.toString(),
    assignedAt: decodeU64AsNumber(data.assigned_at),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Parse a single raw `auditor_removed` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `AuditorRemovedEvent`
 * @throws EventDecodingError if the event is not an `auditor_removed`
 * event, or is missing required fields
 */
export function parseAuditorRemovedEvent(event: RawContractEvent): AuditorRemovedEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new EventDecodingError("Event has no topics", event);
  }

  const eventName = decodeEventName(event.topics[0]);
  if (eventName !== "auditor_removed") {
    throw new EventDecodingError(
      `Expected "auditor_removed" event, got "${eventName || "unknown"}"`,
      event
    );
  }

  const auditor = decodeAddress(event.topics[1]);
  if (!auditor) {
    throw new EventDecodingError(
      "Missing required auditor topic in auditor_removed event",
      event
    );
  }

  const data = decodeDataMap(event.data);

  return {
    type: "auditor_removed",
    auditor,
    removedBy: data.removed_by ? decodeAddress(data.removed_by) || undefined : undefined,
    reason: data.reason?.str()?.toString(),
    removedAt: decodeU64AsNumber(data.removed_at),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Parse multiple raw auditor role events, skipping non-matching events
 * rather than throwing.
 *
 * @param events - Array of raw events
 * @returns Array of decoded auditor role event objects
 */
export function parseAuditorRoleEvents(
  events: RawContractEvent[]
): (AuditorAssignedEvent | AuditorRemovedEvent)[] {
  const results: (AuditorAssignedEvent | AuditorRemovedEvent)[] = [];
  for (const event of events) {
    const name = event.topics?.[0] ? decodeEventName(event.topics[0]) : "";
    if (name === "auditor_assigned") {
      results.push(parseAuditorAssignedEvent(event));
    } else if (name === "auditor_removed") {
      results.push(parseAuditorRemovedEvent(event));
    }
  }
  return results;
}

/**
 * Check whether a raw event is an `auditor_assigned` event, without
 * throwing. Useful for filtering a mixed event stream before parsing.
 */
export function isAuditorAssignedEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === "auditor_assigned";
}

/**
 * Check whether a raw event is an `auditor_removed` event, without
 * throwing. Useful for filtering a mixed event stream before parsing.
 */
export function isAuditorRemovedEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === "auditor_removed";
}
