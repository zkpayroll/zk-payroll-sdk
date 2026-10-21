/**
 * Payroll Cancellation Event Decoder
 *
 * Decodes `payroll_cancelled` contract events into a typed
 * `PayrollCancelledEvent`. The decoded event carries only the run
 * identifier, a reason code, who cancelled and when. Amounts, salaries,
 * recipients and any free-form notes the contract may attach are never
 * read, so decoded events and decoding errors are safe to log and display.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import {
  isSupportedCancellationReason,
  type CancellationReasonCode,
} from "../payroll/cancellation";
import { EventDecodingError } from "./types";
import {
  decodePayrollLifecycleEventSchemaVersion,
  type PayrollLifecycleEventSchemaVersion,
} from "./versioning";

/** Emitted when a payroll run is cancelled on the contract. */
export interface PayrollCancelledEvent {
  type: "payroll_cancelled";
  schemaVersion: PayrollLifecycleEventSchemaVersion;
  /** Stellar address of the employer whose run was cancelled. */
  employer: string;
  /** Identifier of the cancelled payroll run. */
  runId: string;
  /**
   * Supported cancellation reason. Reason codes this SDK does not know are
   * reported as `"other"`, with the original code in {@link rawReason}.
   */
  reason: CancellationReasonCode;
  /** Reason code exactly as emitted on-chain, when present. */
  rawReason?: string;
  /** Whether {@link rawReason} is one of the SDK's supported reason codes. */
  reasonRecognized: boolean;
  /** Stellar address that cancelled the run, when the contract records it. */
  cancelledBy?: string;
  /** Unix timestamp (seconds) when the run was cancelled on-chain. */
  cancelledAt: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const EVENT_NAME = "payroll_cancelled";

/**
 * Parse a single raw `payroll_cancelled` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `PayrollCancelledEvent`
 * @throws EventDecodingError if the event is not a `payroll_cancelled`
 * event, or is missing required fields. Messages name the field only and
 * never include event values.
 */
export function parsePayrollCancelledEvent(event: RawContractEvent): PayrollCancelledEvent {
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
      "Missing required employer topic in payroll_cancelled event",
      event
    );
  }

  const data = decodeDataMap(event.data);
  const schemaVersion = decodePayrollLifecycleEventSchemaVersion(data, EVENT_NAME, event);

  const runId = data.run_id?.str()?.toString();
  if (!runId) {
    throw new EventDecodingError("Missing required run_id in payroll_cancelled event data", event);
  }

  const cancelledAt = decodeU64AsNumber(data.cancelled_at);
  if (cancelledAt === 0) {
    throw new EventDecodingError(
      "Invalid or missing cancelled_at in payroll_cancelled event data",
      event
    );
  }

  const rawReason = decodeReason(data.reason);
  const reasonRecognized = rawReason !== undefined && isSupportedCancellationReason(rawReason);
  const reason: CancellationReasonCode = reasonRecognized
    ? (rawReason as CancellationReasonCode)
    : "other";

  const cancelledBy = data.cancelled_by ? decodeAddress(data.cancelled_by) || undefined : undefined;

  return {
    type: "payroll_cancelled",
    schemaVersion,
    employer,
    runId,
    reason,
    rawReason,
    reasonRecognized,
    cancelledBy,
    cancelledAt,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Parse multiple raw events, skipping non-`payroll_cancelled` events rather
 * than throwing. Corrupt `payroll_cancelled` events still throw.
 */
export function parsePayrollCancelledEvents(events: RawContractEvent[]): PayrollCancelledEvent[] {
  return events.filter(isPayrollCancelledEvent).map(parsePayrollCancelledEvent);
}

/** Whether a raw event is a `payroll_cancelled` event. Never throws. */
export function isPayrollCancelledEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === EVENT_NAME;
}

/** Reads a reason emitted as either a symbol or a string; `undefined` if absent or other type. */
function decodeReason(
  value: import("@stellar/stellar-sdk").xdr.ScVal | undefined
): string | undefined {
  if (!value) return undefined;
  try {
    const kind = value.switch()?.name;
    if (kind === "scvSymbol") return value.sym().toString() || undefined;
    if (kind === "scvString") return value.str().toString() || undefined;
  } catch {
    // fall through: unreadable reason is treated as absent
  }
  return undefined;
}
