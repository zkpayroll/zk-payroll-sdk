import { xdr, Address } from "@stellar/stellar-sdk";

/**
 * A raw contract event as returned by Soroban RPC or indexed data providers.
 *
 * Compatible with the shape of `rpc.Api.ContractEvent` from `@stellar/stellar-sdk`.
 * Consumers can pass events from:
 * - `rpc.Api.GetSuccessfulTransactionResponse["events"]`
 * - Event indexers / archival data sources that follow the same ScVal schema
 *
 * @remarks
 * The `topics` array uses ScVal encoding where the first entry is always a
 * `symbol` ScVal representing the event name. Subsequent entries are indexed
 * parameters. The `data` field holds non-indexed parameters, typically encoded
 * as an ScVal map (keys as symbols).
 *
 * Indexed data sources (e.g., Soroban Subnet, event indexers) return events
 * in the same shape, with `contractId` identifying the emitting contract and
 * `ledger` / `ledgerClosedAt` providing ledger metadata.
 */
export interface RawContractEvent {
  /** "contract" or "system" */
  eventType?: string;
  /** The contract ID that emitted this event */
  contractId?: string;
  /** Event topics — first entry is the event name as a symbol ScVal */
  topics: xdr.ScVal[];
  /** Event data payload */
  data: xdr.ScVal;
  /** Ledger sequence number where the event was emitted */
  ledger?: number;
  /** ISO timestamp of the ledger close */
  ledgerClosedAt?: string;
  /** Unique event identifier */
  id?: string;
  /** Paging token for cursor-based pagination */
  pagingToken?: string;
}

// ── Typed Event Interfaces ───────────────────────────────────────────────────

/** Emitted when a new payroll registry entry is created */
export interface RegisteredEvent {
  type: "registered";
  employer: string;
  employee: string;
  salary: bigint;
  token: string;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/** Emitted when a registry entry's salary is updated */
export interface RegistryUpdatedEvent {
  type: "registry_updated";
  employer: string;
  employee: string;
  salary: bigint;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/** Emitted when a registry entry is deactivated */
export interface RegistryDeactivatedEvent {
  type: "registry_deactivated";
  employer: string;
  employee: string;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/** Emitted when a salary commitment is recorded */
export interface CommittedEvent {
  type: "committed";
  employer: string;
  employee: string;
  commitmentHash: string;
  cycleId: bigint;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/** Emitted when an employer reveals the actual salary for a cycle */
export interface SalaryRevealedEvent {
  type: "salary_revealed";
  employer: string;
  employee: string;
  cycleId: bigint;
  actualAmount: bigint;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/** Emitted when a payment is executed on-chain */
export interface PaymentExecutedEvent {
  type: "payment_executed";
  recipient: string;
  amount: bigint;
  asset: string;
  txHash: string;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/** Emitted when a payment is scheduled for future execution */
export interface PaymentScheduledEvent {
  type: "payment_scheduled";
  recipient: string;
  amount: bigint;
  asset: string;
  executeAt: number;
  paymentId: bigint;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/** Emitted when a scheduled payment is cancelled */
export interface PaymentCancelledEvent {
  type: "payment_cancelled";
  paymentId: bigint;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

/**
 * Discriminated union of all supported contract event types.
 * Each variant uses a literal `type` discriminant for exhaustive matching.
 *
 * @example
 * ```typescript
 * const event: TypedContractEvent = parseContractEvent(raw);
 * switch (event.type) {
 *   case "registered":
 *     console.log(event.employer, event.employee);
 *     break;
 *   case "payment_executed":
 *     console.log(event.recipient, event.amount);
 *     break;
 *   // ...
 * }
 * ```
 */
export type TypedContractEvent =
  | RegisteredEvent
  | RegistryUpdatedEvent
  | RegistryDeactivatedEvent
  | CommittedEvent
  | SalaryRevealedEvent
  | PaymentExecutedEvent
  | PaymentScheduledEvent
  | PaymentCancelledEvent;

// ── Error Types ──────────────────────────────────────────────────────────────

export class EventParsingError extends Error {
  constructor(
    message: string,
    public readonly rawEvent?: RawContractEvent
  ) {
    super(message);
    this.name = "EventParsingError";
  }
}

// ── Parser Functions ─────────────────────────────────────────────────────────

/**
 * Parse a single raw contract event into a typed event object.
 *
 * @param event - A raw event from Soroban RPC or indexed data source
 * @returns A typed event with a `type` discriminant
 * @throws EventParsingError if the event cannot be recognized or decoded
 *
 * @example
 * ```typescript
 * import { parseContractEvent } from "@zk-payroll/core";
 *
 * const typed = parseContractEvent(rawEvent);
 * console.log(typed.type, typed.contractId);
 * ```
 */
export function parseContractEvent(event: RawContractEvent): TypedContractEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new EventParsingError("Event has no topics", event);
  }

  const eventName = decodeEventName(event.topics[0]);

  if (!eventName) {
    throw new EventParsingError("First topic is not a symbol", event);
  }

  switch (eventName) {
    case "registered":
      return parseRegistered(event);
    case "registry_updated":
      return parseRegistryUpdated(event);
    case "registry_deactivated":
      return parseRegistryDeactivated(event);
    case "committed":
      return parseCommitted(event);
    case "salary_revealed":
      return parseSalaryRevealed(event);
    case "payment_executed":
      return parsePaymentExecuted(event);
    case "payment_scheduled":
      return parsePaymentScheduled(event);
    case "payment_cancelled":
      return parsePaymentCancelled(event);
    default:
      throw new EventParsingError(`Unknown event type: "${eventName}"`, event);
  }
}

/**
 * Parse an array of raw contract events into typed event objects.
 *
 * @param events - Array of raw events from the Soroban RPC or indexer
 * @returns An array of typed events
 */
export function parseContractEvents(events: RawContractEvent[]): TypedContractEvent[] {
  return events.map(parseContractEvent);
}

// ── Event-Specific Parsers ───────────────────────────────────────────────────

function parseRegistered(event: RawContractEvent): RegisteredEvent {
  const topics = event.topics;
  const employer = decodeAddress(topics[1]);
  if (!employer) {
    throw new EventParsingError("Missing required employer topic in registered event");
  }
  const data = decodeDataMap(event.data);

  return {
    type: "registered",
    employer,
    employee: decodeAddress(topics[2]),
    salary: decodeBigInt(data.salary),
    token: decodeAddress(data.token),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

function parseRegistryUpdated(event: RawContractEvent): RegistryUpdatedEvent {
  const topics = event.topics;
  const data = decodeDataMap(event.data);

  return {
    type: "registry_updated",
    employer: decodeAddress(topics[1]),
    employee: decodeAddress(topics[2]),
    salary: decodeBigInt(data.salary),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

function parseRegistryDeactivated(event: RawContractEvent): RegistryDeactivatedEvent {
  const topics = event.topics;

  return {
    type: "registry_deactivated",
    employer: decodeAddress(topics[1]),
    employee: decodeAddress(topics[2]),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

function parseCommitted(event: RawContractEvent): CommittedEvent {
  const topics = event.topics;
  const data = decodeDataMap(event.data);

  return {
    type: "committed",
    employer: decodeAddress(topics[1]),
    employee: decodeAddress(topics[2]),
    commitmentHash: decodeBytes(data.commitment_hash),
    cycleId: decodeBigInt(data.cycle_id),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

function parseSalaryRevealed(event: RawContractEvent): SalaryRevealedEvent {
  const topics = event.topics;
  const data = decodeDataMap(event.data);

  return {
    type: "salary_revealed",
    employer: decodeAddress(topics[1]),
    employee: decodeAddress(topics[2]),
    cycleId: decodeBigInt(data.cycle_id),
    actualAmount: decodeBigInt(data.actual_amount),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

function parsePaymentExecuted(event: RawContractEvent): PaymentExecutedEvent {
  const topics = event.topics;
  const data = decodeDataMap(event.data);

  return {
    type: "payment_executed",
    recipient: decodeAddress(topics[1]),
    amount: decodeBigInt(data.amount),
    asset: decodeAddress(data.asset),
    txHash: decodeBytes(data.tx_hash),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

function parsePaymentScheduled(event: RawContractEvent): PaymentScheduledEvent {
  const topics = event.topics;
  const data = decodeDataMap(event.data);

  return {
    type: "payment_scheduled",
    recipient: decodeAddress(topics[1]),
    amount: decodeBigInt(data.amount),
    asset: decodeAddress(data.asset),
    executeAt: decodeU64AsNumber(data.execute_at),
    paymentId: decodeBigInt(data.payment_id),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

function parsePaymentCancelled(event: RawContractEvent): PaymentCancelledEvent {
  const data = decodeDataMap(event.data);

  return {
    type: "payment_cancelled",
    paymentId: decodeBigInt(data.payment_id ?? event.topics[1]),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

// ── ScVal Decoding Helpers ───────────────────────────────────────────────────
//
// Exported so other event decoders (e.g. `events/employerOnboarding.ts`,
// `events/operatorRemoval.ts`) can decode the same ScVal event shape without
// duplicating this logic.

export function decodeEventName(topic: xdr.ScVal): string {
  try {
    if (topic.switch()?.name === "scvSymbol") {
      return topic.sym()?.toString() ?? "";
    }
  } catch {
    // Ignore non-symbol topics
  }
  return "";
}

export function decodeAddress(scVal: xdr.ScVal | undefined): string {
  if (!scVal) return "";
  try {
    return Address.fromScVal(scVal).toString();
  } catch {
    return "";
  }
}

export function decodeBigInt(scVal: xdr.ScVal | undefined): bigint {
  if (!scVal) return 0n;
  try {
    const swName = scVal.switch()?.name;
    if (swName === "scvI128") {
      const i128 = scVal.i128();
      const hi = BigInt(i128.hi().toString());
      const lo = BigInt(i128.lo().toString());
      return (hi << 64n) | lo;
    }
    if (swName === "scvU64") {
      const u64 = scVal.u64();
      return BigInt(u64.toString());
    }
  } catch {
    return 0n;
  }
  return 0n;
}

export function decodeU64AsNumber(scVal: xdr.ScVal | undefined): number {
  if (!scVal) return 0;
  const u64 = scVal.u64();
  if (u64) return Number(u64);
  return 0;
}

export function decodeBytes(scVal: xdr.ScVal | undefined): string {
  if (!scVal) return "";
  const bytes = scVal.bytes();
  if (bytes) return Buffer.from(bytes).toString("hex");
  return "";
}

export function decodeDataMap(scVal: xdr.ScVal): Record<string, xdr.ScVal> {
  const map = scVal.map();
  if (!map) return {};
  const entries: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym()?.toString() ?? "";
    entries[key] = entry.val();
  }
  return entries;
}
