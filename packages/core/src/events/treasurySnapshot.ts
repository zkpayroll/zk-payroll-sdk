/**
 * Treasury Snapshot Event Decoder (Issue #502)
 */

import { xdr } from "@stellar/stellar-sdk";
import type { RawContractEvent } from "../event-parser";
import { EventDecodingError } from "./types";

export const TREASURY_SNAPSHOT_EVENT_NAME = "treasury_snapshot";

export interface TreasurySnapshotEvent {
  type: "treasury_snapshot";
  employer: string;
  asset: string;
  balance: bigint;
  reservedAmount: bigint;
  availableAmount: bigint;
  ledger?: number;
  timestamp?: string;
  contractId?: string;
}

function decodeBigInt(scVal: xdr.ScVal | undefined): bigint {
  if (!scVal) return 0n;
  const type = scVal.switch().name;
  if (type === "scvI128") {
    const i = scVal.i128();
    return (BigInt(i.hi().toString()) << 64n) + BigInt(i.lo().toString());
  }
  if (type === "scvU64") return BigInt(scVal.u64().toString());
  if (type === "scvI64") return BigInt(scVal.i64().toString());
  if (type === "scvU32") return BigInt(scVal.u32());
  if (type === "scvI32") return BigInt(scVal.i32());
  return 0n;
}

function decodeString(scVal: xdr.ScVal | undefined): string {
  if (!scVal) return "";
  const type = scVal.switch().name;
  if (type === "scvSymbol") return scVal.sym().toString();
  if (type === "scvString") return scVal.str().toString();
  return "";
}

export function decodeTreasurySnapshotEvent(raw: RawContractEvent): TreasurySnapshotEvent {
  if (!raw || !Array.isArray(raw.topics) || raw.topics.length === 0) {
    throw new EventDecodingError("Treasury snapshot event is missing topics", raw);
  }

  const eventName = decodeString(raw.topics[0]);
  if (eventName !== TREASURY_SNAPSHOT_EVENT_NAME) {
    throw new EventDecodingError(
      `Expected event name "${TREASURY_SNAPSHOT_EVENT_NAME}", got "${eventName}"`,
      raw
    );
  }

  const topicEmployer = raw.topics[1] ? decodeString(raw.topics[1]) : "";

  const data: Record<string, xdr.ScVal> = {};
  const mapVal = raw.data;
  const map = mapVal ? mapVal.map() : null;
  if (map && map.length > 0) {
    for (let i = 0; i < map.length; i++) {
      const entry = map[i];
      const keyVal = entry.key();
      const symObj = keyVal.sym();
      const key = symObj ? symObj.toString() : "";
      data[key] = entry.val();
    }
  }

  console.log(
    "DEBUG data keys:",
    Object.keys(data),
    "employer raw:",
    decodeString(data.employer),
    "asset raw:",
    decodeString(data.asset)
  );
  const employer = decodeString(data.employer) || topicEmployer;
  const asset = decodeString(data.asset);
  if (!employer || !asset) {
    throw new EventDecodingError("Treasury snapshot event is missing employer or asset", raw);
  }

  const balance = decodeBigInt(data.balance);
  const reservedAmount = decodeBigInt(data.reserved_amount);
  const availableAmount = data.available_amount
    ? decodeBigInt(data.available_amount)
    : balance - reservedAmount;

  return {
    type: "treasury_snapshot",
    employer,
    asset,
    balance,
    reservedAmount,
    availableAmount,
    ledger: raw.ledger,
    timestamp: raw.ledgerClosedAt,
    contractId: raw.contractId,
  };
}

export function decodeTreasurySnapshotEvents(raws: RawContractEvent[]): TreasurySnapshotEvent[] {
  if (!Array.isArray(raws)) return [];
  const out: TreasurySnapshotEvent[] = [];
  for (const raw of raws) {
    try {
      out.push(decodeTreasurySnapshotEvent(raw));
    } catch {
      // Non-snapshot events are expected in a mixed stream
    }
  }
  return out;
}
