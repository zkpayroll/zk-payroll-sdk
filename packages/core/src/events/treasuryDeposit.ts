/**
 * Treasury Deposit Event Parser
 *
 * Decodes `treasury_deposited` (and `treasury_deposit`) contract events into a typed
 * `TreasuryDepositEvent`. Treasury timelines, financial indexers, and balance reconciliation
 * rely on this for reliable event decoding of deposits.
 *
 * ## Privacy & Redaction
 * Provides helpers for logging deposit events while masking sensitive employer or depositor
 * addresses to ensure compliance with privacy guidelines.
 */

import type { RawContractEvent } from "../event-parser";
import {
  decodeEventName,
  decodeAddress,
  decodeBigInt,
  decodeDataMap,
  decodeU64AsNumber,
} from "../event-parser";
import { EventDecodingError } from "./types";

/**
 * Emitted when funds are deposited into the treasury contract.
 */
export interface TreasuryDepositEvent {
  type: "treasury_deposit";
  /** Stellar address of the depositor/employer */
  depositor: string;
  /** Contract address of the deposited token or "native" for XLM */
  asset: string;
  /** Deposited amount in smallest base units (bigint) */
  amount: bigint;
  /** Optional transaction memo or reference identifier */
  memo?: string;
  /** Unix seconds when the deposit occurred on-chain */
  depositedAt: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const PRIMARY_EVENT_NAME = "treasury_deposited";
const ALIAS_EVENT_NAME = "treasury_deposit";

/**
 * Mask an address for privacy-preserving logs and audits.
 */
export function redactAddress(address?: string): string {
  if (!address || address.trim().length === 0) {
    return "[ANONYMOUS]";
  }
  const clean = address.trim();
  if (clean.length <= 6) {
    return "[REDACTED_ADDRESS]";
  }
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Parse a raw contract event into a typed `TreasuryDepositEvent`.
 *
 * @param event - Raw contract event from RPC or indexer.
 * @returns Parsed and validated `TreasuryDepositEvent`.
 * @throws `EventDecodingError` if the event is malformed or not a deposit event.
 */
export function parseTreasuryDepositEvent(event: RawContractEvent): TreasuryDepositEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new EventDecodingError("Event has no topics", event);
  }

  const eventName = decodeEventName(event.topics[0]);
  if (eventName !== PRIMARY_EVENT_NAME && eventName !== ALIAS_EVENT_NAME) {
    throw new EventDecodingError(
      `Expected "${PRIMARY_EVENT_NAME}" or "${ALIAS_EVENT_NAME}" event, got "${eventName || "unknown"}"`,
      event
    );
  }

  const data = event.data ? decodeDataMap(event.data) : {};

  // Extract depositor: from topic[1] or data.depositor
  let depositor = "";
  if (event.topics.length > 1) {
    depositor = decodeAddress(event.topics[1]);
  }
  if (!depositor && data.depositor) {
    depositor = decodeAddress(data.depositor);
  }
  if (!depositor) {
    throw new EventDecodingError(
      "Missing required depositor address in treasury deposit event",
      event
    );
  }

  // Extract asset: from topic[2] or data.asset
  let asset = "";
  if (event.topics.length > 2) {
    asset = decodeAddress(event.topics[2]);
  }
  if (!asset && data.asset) {
    asset = decodeAddress(data.asset);
    if (!asset) {
      try {
        asset = data.asset.sym()?.toString() ?? "";
      } catch {
        // ignore
      }
    }
  }
  if (!asset) {
    asset = "native";
  }

  // Extract amount: from data.amount
  const amount = decodeBigInt(data.amount);

  // Extract memo: from data.memo
  let memo: string | undefined;
  if (data.memo) {
    try {
      memo = data.memo.str()?.toString() || data.memo.sym()?.toString();
    } catch {
      // ignore
    }
  }

  // Extract depositedAt: from data.deposited_at or data.timestamp
  let depositedAt = decodeU64AsNumber(data.deposited_at);
  if (!depositedAt && data.timestamp) {
    depositedAt = decodeU64AsNumber(data.timestamp);
  }

  return {
    type: "treasury_deposit",
    depositor,
    asset,
    amount,
    memo,
    depositedAt,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Parse multiple raw contract events into typed `TreasuryDepositEvent` objects.
 *
 * @param events - Array of raw contract events.
 * @returns Array of parsed `TreasuryDepositEvent`s.
 */
export function parseTreasuryDepositEvents(events: RawContractEvent[]): TreasuryDepositEvent[] {
  return events.map(parseTreasuryDepositEvent);
}

/**
 * Check whether a raw contract event is a treasury deposit event.
 *
 * @param event - Raw contract event.
 * @returns True if the event is a treasury deposit event.
 */
export function isTreasuryDepositEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  const eventName = decodeEventName(event.topics[0]);
  return eventName === PRIMARY_EVENT_NAME || eventName === ALIAS_EVENT_NAME;
}

/**
 * Format a human-readable summary of a treasury deposit event.
 *
 * @param event - Typed `TreasuryDepositEvent`.
 * @param options - Formatting and redaction options.
 * @returns Human-readable string.
 */
export function formatTreasuryDepositSummary(
  event: TreasuryDepositEvent,
  options: { redactDepositor?: boolean; assetSymbol?: string } = {}
): string {
  const { redactDepositor = false, assetSymbol } = options;
  const depositorStr = redactDepositor ? redactAddress(event.depositor) : event.depositor;
  const assetStr = assetSymbol || (event.asset === "native" ? "XLM" : event.asset);
  const ledgerInfo = event.ledger ? ` (ledger ${event.ledger})` : "";
  const memoInfo = event.memo ? ` [memo: ${event.memo}]` : "";

  return `Treasury Deposit: ${event.amount} ${assetStr} from ${depositorStr}${ledgerInfo}${memoInfo}`;
}
