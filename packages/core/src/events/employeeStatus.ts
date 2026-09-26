/**
 * Employee Status Updated Event Decoder (#475)
 *
 * Decodes contract employee status-change events into typed SDK records.
 * Event decoders like this allow indexers, audit dashboards, and payroll clients
 * to consume employee lifecycle events safely without exposing private payroll data.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";
import type { EmployeeStatus } from "../employees/lifecycle";

/** Supported contract event names for employee status transitions. */
export const EMPLOYEE_STATUS_EVENT_NAMES = [
  "employee_status_updated",
  "employee_status_changed",
  "employee_suspended",
  "employee_reactivated",
  "employee_offboarded",
  "employee_created",
] as const;

export type EmployeeStatusEventName = (typeof EMPLOYEE_STATUS_EVENT_NAMES)[number];

/** Emitted when an employee's status changes on the contract. */
export interface EmployeeStatusUpdatedEvent {
  type: "employee_status_updated";
  /** Stellar address of the employee whose status was updated. */
  employee: string;
  /** Stellar address of the employer organization, if recorded. */
  employer?: string;
  /** New employee status (e.g. "active", "suspended", "offboarded"). */
  newStatus: EmployeeStatus | string;
  /** Previous employee status before this transition, if recorded. */
  previousStatus?: EmployeeStatus | string;
  /** Stellar address of the admin or operator who authorized the change. */
  updatedBy?: string;
  /** Optional reason code or description for the status update. */
  reason?: string;
  /** Unix seconds when the status transition was recorded on-chain. */
  updatedAt: number;
  /** Optional effective unix timestamp for the status change. */
  effectiveDate?: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/**
 * Normalizes an ScVal status value into a string.
 */
function extractStatusString(val: unknown): string {
  if (!val) return "";
  try {
    if (typeof val === "object" && val !== null && "switch" in val) {
      const swName = (val as { switch: () => { name?: string } }).switch()?.name;
      if (swName === "scvSymbol") {
        return (
          (val as unknown as { sym: () => { toString: () => string } }).sym()?.toString() ?? ""
        );
      }
      if (swName === "scvString") {
        return (
          (val as unknown as { str: () => { toString: () => string } }).str()?.toString() ?? ""
        );
      }
    }
  } catch {
    // fallback
  }
  return typeof val === "string" ? val : String(val);
}

/**
 * Decode a single raw contract event for employee status updates.
 *
 * @param event - A raw event from Soroban RPC or indexed data provider.
 * @returns The typed `EmployeeStatusUpdatedEvent`.
 * @throws EventDecodingError if the event has no topics, is not an employee status
 * event, or is missing the required employee address.
 */
export function decodeEmployeeStatusUpdatedEvent(
  event: RawContractEvent
): EmployeeStatusUpdatedEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new EventDecodingError("Event has no topics", event);
  }

  const eventName = decodeEventName(event.topics[0]);
  if (!EMPLOYEE_STATUS_EVENT_NAMES.includes(eventName as EmployeeStatusEventName)) {
    throw new EventDecodingError(
      `Expected employee status event (${EMPLOYEE_STATUS_EVENT_NAMES.join(", ")}), got "${eventName || "unknown"}"`,
      event
    );
  }

  const employee = decodeAddress(event.topics[1]);
  if (!employee) {
    throw new EventDecodingError(
      "Missing required employee address topic in employee status event",
      event
    );
  }

  const employer = event.topics[2] ? decodeAddress(event.topics[2]) : undefined;
  const data = event.data ? decodeDataMap(event.data) : {};

  // Infer new status: from data payload or specific event name
  let newStatus: string = "";
  if (data.new_status || data.status) {
    newStatus = extractStatusString(data.new_status ?? data.status);
  } else if (eventName === "employee_suspended") {
    newStatus = "suspended";
  } else if (eventName === "employee_reactivated" || eventName === "employee_created") {
    newStatus = "active";
  } else if (eventName === "employee_offboarded") {
    newStatus = "offboarded";
  } else {
    newStatus = "unknown";
  }

  let previousStatus: string | undefined = undefined;
  if (data.previous_status || data.old_status) {
    previousStatus = extractStatusString(data.previous_status ?? data.old_status);
  }

  const updatedBy = data.updated_by
    ? decodeAddress(data.updated_by) || undefined
    : data.admin
      ? decodeAddress(data.admin) || undefined
      : undefined;

  const reason = data.reason ? extractStatusString(data.reason) : undefined;

  const updatedAt = data.updated_at
    ? decodeU64AsNumber(data.updated_at)
    : Math.floor(Date.now() / 1000);

  const effectiveDate = data.effective_date ? decodeU64AsNumber(data.effective_date) : undefined;

  return {
    type: "employee_status_updated",
    employee,
    employer: employer || (data.employer ? decodeAddress(data.employer) || undefined : undefined),
    newStatus,
    previousStatus,
    updatedBy,
    reason,
    updatedAt,
    effectiveDate,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Decode multiple raw employee status update events.
 *
 * @param events - Array of raw contract events.
 * @returns Array of decoded `EmployeeStatusUpdatedEvent` objects.
 */
export function decodeEmployeeStatusUpdatedEvents(
  events: RawContractEvent[]
): EmployeeStatusUpdatedEvent[] {
  return events.map(decodeEmployeeStatusUpdatedEvent);
}

/**
 * Checks whether a raw event is an employee status update event without throwing.
 *
 * @param event - Raw contract event.
 * @returns True if the event matches any recognized employee status event name.
 */
export function isEmployeeStatusUpdatedEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  const name = decodeEventName(event.topics[0]);
  return EMPLOYEE_STATUS_EVENT_NAMES.includes(name as EmployeeStatusEventName);
}
