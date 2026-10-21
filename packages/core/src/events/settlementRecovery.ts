/**
 * Interrupted settlement recovery event decoder.
 *
 * Decodes `interrupted_settlement_recovery` raw Soroban contract events into
 * a typed {@link InterruptedSettlementRecoveryEvent}. Settlement recovery
 * tooling, receipt reconciliation, and payroll audit timelines rely on this
 * to surface settlements that were interrupted mid-flight and are eligible
 * for recovery.
 *
 * Follows the same topics/data ScVal decoding conventions as
 * `../event-parser.ts` and the other decoders in this folder.
 *
 * ## Privacy & Redaction
 * Messages never contain salary or payout amounts; only aggregate
 * identifiers and recovery status are surfaced.
 *
 * @module
 */

import type { xdr } from "@stellar/stellar-sdk";
import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeBigInt, decodeDataMap } from "../event-parser";
import { EventDecodingError } from "./types";
import {
  decodePayrollLifecycleEventSchemaVersion,
  type PayrollLifecycleEventSchemaVersion,
} from "./versioning";

/** The canonical event name emitted for interrupted settlement recovery. */
export const INTERRUPTED_SETTLEMENT_RECOVERY_EVENT_NAME = "interrupted_settlement_recovery";

/**
 * Why a settlement was interrupted. Values align with the reasons the
 * contract emits on-chain; unknown reasons are preserved verbatim so
 * operators can still diagnose novel failure modes.
 */
export type SettlementInterruptionReason =
  | "timeout"
  | "contract_paused"
  | "insufficient_fee"
  | "network_failure"
  | "proof_verification_failed"
  | (string & {});

/** Recovery lifecycle status reported by the contract. */
export type SettlementRecoveryStatus = "pending" | "initiated" | "completed" | "failed";

/**
 * Emitted when a settlement is interrupted and becomes eligible for
 * (or has completed) recovery.
 */
export interface InterruptedSettlementRecoveryEvent {
  type: typeof INTERRUPTED_SETTLEMENT_RECOVERY_EVENT_NAME;
  schemaVersion: PayrollLifecycleEventSchemaVersion;
  /** Identifier of the interrupted settlement / receipt. */
  settlementId: string;
  /** Payroll run the settlement belonged to. */
  payrollId: string;
  /** Employer address that owns the payroll run. */
  employer: string;
  /** Why the settlement was interrupted. */
  interruptionReason: SettlementInterruptionReason;
  /** Current recovery lifecycle status. */
  recoveryStatus: SettlementRecoveryStatus;
  /** Amount left recoverable, in smallest base units. `0n` when unknown. */
  recoverableAmount: bigint;
  /** Asset identifier for the recoverable amount, when supplied. */
  asset?: string;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const VALID_RECOVERY_STATUSES: readonly SettlementRecoveryStatus[] = [
  "pending",
  "initiated",
  "completed",
  "failed",
];

/**
 * Parse a raw contract event into a typed
 * {@link InterruptedSettlementRecoveryEvent}.
 *
 * @param event - Raw contract event from RPC or an indexer.
 * @returns Parsed and validated event.
 * @throws EventDecodingError if the event is malformed or not an
 *   `interrupted_settlement_recovery` event.
 */
export function parseInterruptedSettlementRecoveryEvent(
  event: RawContractEvent
): InterruptedSettlementRecoveryEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new EventDecodingError("Event has no topics", event);
  }

  const eventName = decodeEventName(event.topics[0]);
  if (eventName !== INTERRUPTED_SETTLEMENT_RECOVERY_EVENT_NAME) {
    throw new EventDecodingError(
      `Expected "${INTERRUPTED_SETTLEMENT_RECOVERY_EVENT_NAME}" event, got "${eventName || "unknown"}"`,
      event
    );
  }

  const employer = decodeAddress(event.topics[1]);
  if (!employer) {
    throw new EventDecodingError(
      "Missing or invalid employer topic in interrupted_settlement_recovery event",
      event
    );
  }

  const data = event.data ? decodeDataMap(event.data) : {};
  const schemaVersion = decodePayrollLifecycleEventSchemaVersion(
    data,
    INTERRUPTED_SETTLEMENT_RECOVERY_EVENT_NAME,
    event
  );

  const settlementId = decodeString(data.settlement_id);
  if (!settlementId) {
    throw new EventDecodingError(
      "Missing settlement_id in interrupted_settlement_recovery event data",
      event
    );
  }

  const payrollId = decodeString(data.payroll_id);
  if (!payrollId) {
    throw new EventDecodingError(
      "Missing payroll_id in interrupted_settlement_recovery event data",
      event
    );
  }

  const rawReason = decodeString(data.interruption_reason);
  if (!rawReason) {
    throw new EventDecodingError(
      "Missing interruption_reason in interrupted_settlement_recovery event data",
      event
    );
  }

  const recoveryStatus = decodeString(data.recovery_status) as SettlementRecoveryStatus;
  if (!VALID_RECOVERY_STATUSES.includes(recoveryStatus)) {
    throw new EventDecodingError(
      `Invalid recovery_status "${recoveryStatus || "<missing>"}" in interrupted_settlement_recovery event`,
      event
    );
  }

  const recoverableAmount = decodeBigInt(data.recoverable_amount);
  if (recoverableAmount < 0n) {
    throw new EventDecodingError(
      "recoverable_amount in interrupted_settlement_recovery event must not be negative",
      event
    );
  }

  const asset = decodeString(data.asset) || undefined;

  return {
    type: INTERRUPTED_SETTLEMENT_RECOVERY_EVENT_NAME,
    schemaVersion,
    settlementId,
    payrollId,
    employer,
    interruptionReason: rawReason as SettlementInterruptionReason,
    recoveryStatus,
    recoverableAmount,
    asset,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Parse a batch of raw events, skipping (rather than throwing on) any that
 * are not `interrupted_settlement_recovery` events. Malformed recovery
 * events still throw, since a corrupt event of the type we're looking for is
 * a data-integrity problem, not noise.
 */
export function parseInterruptedSettlementRecoveryEvents(
  events: RawContractEvent[]
): InterruptedSettlementRecoveryEvent[] {
  const results: InterruptedSettlementRecoveryEvent[] = [];
  for (const event of events) {
    const name = event.topics?.[0] ? decodeEventName(event.topics[0]) : "";
    if (name !== INTERRUPTED_SETTLEMENT_RECOVERY_EVENT_NAME) continue;
    results.push(parseInterruptedSettlementRecoveryEvent(event));
  }
  return results;
}

// ── ScVal Decoding Helpers ───────────────────────────────────────────────────

function decodeString(scVal: xdr.ScVal | undefined): string {
  if (!scVal) return "";
  try {
    const swName = scVal.switch()?.name;
    if (swName === "scvString") {
      return scVal.str()?.toString() ?? "";
    }
    if (swName === "scvSymbol") {
      return scVal.sym()?.toString() ?? "";
    }
  } catch {
    // fall through
  }
  return "";
}
