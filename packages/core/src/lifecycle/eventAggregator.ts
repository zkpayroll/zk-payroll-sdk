/**
 * Payroll Lifecycle Event Aggregator
 *
 * Merges raw payroll, treasury, wallet, and contract events into a single,
 * time-ordered lifecycle stream. Integrators consume one reliable sequence
 * for dashboards, notifications, audit views, and reconciliation tools
 * instead of stitching together several independent event sources.
 *
 * ## Usage
 *
 * ```ts
 * import { aggregateLifecycleEvents } from "@zk-payroll/core";
 *
 * const stream = aggregateLifecycleEvents([
 *   payrollEvents,   // source: "payroll"
 *   treasuryEvents,  // source: "treasury"
 *   walletEvents,    // source: "wallet"
 *   contractEvents,  // source: "contract"
 * ]);
 *
 * for (const event of stream) {
 *   console.log(event.timestamp, event.source, event.type, event.summary);
 * }
 * ```
 */

// ── Source & Raw Event ──────────────────────────────────────────────────────

/** Origin of a raw lifecycle event, prior to aggregation. */
export type LifecycleEventSource = "payroll" | "treasury" | "wallet" | "contract";

/**
 * A raw event as produced by one of the upstream systems (payroll engine,
 * treasury service, wallet adapter, or on-chain contract indexer).
 */
export interface RawLifecycleEvent {
  /** Which system produced this event. */
  source: LifecycleEventSource;
  /** Event-specific discriminant, e.g. "payment_executed", "funds_deposited". */
  type: string;
  /** Millisecond epoch timestamp of when the event occurred. */
  timestamp: number;
  /**
   * Optional monotonic sequence number from the origin system, used to
   * break ties when two events share a timestamp (e.g. same ledger).
   */
  sequence?: number;
  /** Stellar public key, user ID, or system identifier that caused the event. */
  actor?: string;
  /** Optional human-readable summary; auto-generated when omitted. */
  summary?: string;
  /** Arbitrary event-specific payload. */
  details?: Record<string, unknown>;
}

// ── Aggregated Lifecycle Event ──────────────────────────────────────────────

/** A single event in the merged, ordered lifecycle stream. */
export interface LifecycleEvent {
  /** Unique identifier, stable for the lifetime of the stream. */
  id: string;
  /** Millisecond epoch timestamp used for ordering. */
  timestamp: number;
  /** Origin system. */
  source: LifecycleEventSource;
  /** Event-specific discriminant. */
  type: string;
  /** Actor responsible for the event, if known. */
  actor: string;
  /** Human-readable summary. */
  summary: string;
  /** Event-specific payload, unchanged from the raw event. */
  details: Record<string, unknown>;
  /**
   * Position of this event within the merged stream (0-based, after
   * ordering). Stable for a given input set.
   */
  index: number;
}

export interface AggregateLifecycleEventsOptions {
  /** Sort direction by timestamp. Defaults to "asc" (oldest first). */
  order?: "asc" | "desc";
  /** Restrict the aggregated stream to these sources. */
  sources?: LifecycleEventSource[];
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

let idCounter = 0;

/** Generate a stream-local event ID (stable ordering key, not a UUID). */
function generateLifecycleEventId(source: LifecycleEventSource, timestamp: number): string {
  idCounter += 1;
  return `lc_${source}_${timestamp}_${idCounter}`;
}

function defaultSummary(event: RawLifecycleEvent): string {
  const actor = event.actor ? ` (${event.actor})` : "";
  return `${event.source}.${event.type}${actor}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Aggregate raw payroll, treasury, wallet, and contract events into a single
 * ordered lifecycle stream.
 *
 * Accepts either a flat array of raw events, or an array of arrays (one per
 * source) for convenience when callers already have events grouped by
 * origin. Events are sorted by `timestamp`, then by `sequence` (if present),
 * then by their original position, so ties resolve deterministically.
 *
 * @param rawEvents - Raw events, flat or grouped by source.
 * @param options   - Ordering and source-filtering options.
 * @returns         A single, time-ordered `LifecycleEvent[]`.
 */
export function aggregateLifecycleEvents(
  rawEvents: RawLifecycleEvent[] | RawLifecycleEvent[][],
  options: AggregateLifecycleEventsOptions = {}
): LifecycleEvent[] {
  const flat: RawLifecycleEvent[] = Array.isArray(rawEvents[0])
    ? (rawEvents as RawLifecycleEvent[][]).flat()
    : (rawEvents as RawLifecycleEvent[]);

  const order = options.order ?? "asc";
  const sourceFilter = options.sources ? new Set(options.sources) : undefined;

  const filtered = sourceFilter ? flat.filter((e) => sourceFilter.has(e.source)) : flat.slice();

  // Preserve original position for stable tie-breaking.
  const withPosition = filtered.map((event, position) => ({ event, position }));

  withPosition.sort((a, b) => {
    if (a.event.timestamp !== b.event.timestamp) {
      return order === "asc"
        ? a.event.timestamp - b.event.timestamp
        : b.event.timestamp - a.event.timestamp;
    }
    const aSeq = a.event.sequence ?? a.position;
    const bSeq = b.event.sequence ?? b.position;
    if (aSeq !== bSeq) {
      return order === "asc" ? aSeq - bSeq : bSeq - aSeq;
    }
    return a.position - b.position;
  });

  return withPosition.map(({ event }, index) => ({
    id: generateLifecycleEventId(event.source, event.timestamp),
    timestamp: event.timestamp,
    source: event.source,
    type: event.type,
    actor: event.actor ?? "",
    summary: event.summary ?? defaultSummary(event),
    details: event.details ?? {},
    index,
  }));
}

/**
 * Group an already-aggregated lifecycle stream by source.
 *
 * @param events - A lifecycle stream, typically from `aggregateLifecycleEvents`.
 * @returns      Events bucketed by their originating source.
 */
export function groupLifecycleEventsBySource(
  events: LifecycleEvent[]
): Record<LifecycleEventSource, LifecycleEvent[]> {
  const grouped: Record<LifecycleEventSource, LifecycleEvent[]> = {
    payroll: [],
    treasury: [],
    wallet: [],
    contract: [],
  };
  for (const event of events) {
    grouped[event.source].push(event);
  }
  return grouped;
}

/**
 * Filter a lifecycle stream by source, type, and/or actor. Pure — does not
 * mutate the input.
 *
 * @param events - A lifecycle stream to filter.
 * @param filter - Criteria that must all match.
 * @returns      The matching subset, in original order.
 */
export function filterLifecycleEvents(
  events: LifecycleEvent[],
  filter: { source?: LifecycleEventSource; type?: string; actor?: string }
): LifecycleEvent[] {
  return events.filter((event) => {
    if (filter.source && event.source !== filter.source) return false;
    if (filter.type && event.type !== filter.type) return false;
    if (filter.actor && event.actor !== filter.actor) return false;
    return true;
  });
}
