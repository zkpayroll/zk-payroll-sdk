import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { ArchiveRecord, ArchiveStatus } from "./types";

export const ARCHIVE_EVENT_TOPICS = {
  RUN_ARCHIVED: "payroll_run_archived",
  RUN_DISPUTED: "payroll_run_disputed",
  RUN_HELD: "payroll_run_held",
} as const;

export interface RawSorobanEvent {
  type?: string;
  ledger?: number;
  ledgerClosedAt?: string;
  contractId?: string;
  id?: string;
  topic?: xdr.ScVal[] | string[];
  value?: xdr.ScVal | unknown;
  inSuccessfulContractCall?: boolean;
}

/**
 * Parse raw on-chain Soroban contract events into normalized ArchiveRecords.
 */
export function parseArchiveEvent(
  event: rpc.Api.EventResponse | RawSorobanEvent | unknown
): ArchiveRecord | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const raw = event as RawSorobanEvent & {
    topic?: Array<xdr.ScVal | string>;
    value?: xdr.ScVal | unknown;
  };

  let topicName = "";
  if (Array.isArray(raw.topic) && raw.topic.length > 0) {
    const firstTopic = raw.topic[0];
    if (typeof firstTopic === "string") {
      topicName = firstTopic;
    } else if (firstTopic && typeof (firstTopic as xdr.ScVal).sym === "function") {
      topicName = (firstTopic as xdr.ScVal).sym()?.toString() ?? "";
    } else if (firstTopic && typeof (firstTopic as xdr.ScVal).str === "function") {
      topicName = (firstTopic as xdr.ScVal).str()?.toString() ?? "";
    }
  }

  const normalizedTopic = topicName.toLowerCase();
  const isArchived = normalizedTopic.includes("archive");
  const isDisputed = normalizedTopic.includes("dispute");
  const isHeld = normalizedTopic.includes("held") || normalizedTopic.includes("hold");

  if (!isArchived && !isDisputed && !isHeld) {
    return null;
  }

  let decodedValue: Record<string, unknown> = {};
  if (raw.value && typeof (raw.value as xdr.ScVal).map === "function") {
    try {
      decodedValue = (scValToNative(raw.value as xdr.ScVal) as Record<string, unknown>) || {};
    } catch {
      decodedValue = {};
    }
  } else if (raw.value && typeof raw.value === "object") {
    decodedValue = raw.value as Record<string, unknown>;
  }

  const runId = String(
    decodedValue.runId ?? decodedValue.run_id ?? decodedValue.id ?? "unknown_run"
  );
  const archivedBy = decodedValue.archivedBy ?? decodedValue.archived_by ?? decodedValue.actor;
  const reason = decodedValue.reason ? String(decodedValue.reason) : undefined;
  const archivedAt = decodedValue.archivedAt
    ? Number(decodedValue.archivedAt)
    : decodedValue.timestamp
      ? Number(decodedValue.timestamp)
      : Date.now();

  let status: ArchiveStatus = "archived";
  if (isDisputed) status = "disputed";
  else if (isHeld) status = "held";
  else if (isArchived) status = "archived";

  return {
    runId,
    status,
    archivedAt,
    archivedBy: archivedBy ? String(archivedBy) : undefined,
    reason,
    isDisputed: isDisputed || Boolean(decodedValue.isDisputed ?? decodedValue.is_disputed),
    isHeld: isHeld || Boolean(decodedValue.isHeld ?? decodedValue.is_held),
    metadata:
      typeof decodedValue.metadata === "object"
        ? (decodedValue.metadata as Record<string, unknown>)
        : undefined,
  };
}
