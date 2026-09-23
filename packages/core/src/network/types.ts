/**
 * Type definitions for network request timing metadata.
 *
 * The SDK talks to the network through two paths — `@stellar/stellar-sdk`'s
 * `rpc.Server` (Soroban RPC) and HTTP(S) requests for circuit artifacts. This
 * module defines the timing metadata produced for both so integrators can
 * diagnose slow RPC or API paths during payroll operations.
 *
 * Security: timing records contain only the operation name, endpoint, and
 * duration. No request or response payloads, and no private payroll values,
 * are ever included.
 *
 * @module
 */

/** Outcome of a timed network request. */
export type NetworkRequestStatus = "success" | "error";

/**
 * Timing metadata for a single network request.
 *
 * Safe to log or emit to telemetry: it carries no payload data and no private
 * payroll values.
 */
export interface NetworkRequestTiming {
  /** Stable identifier of the request (e.g. "getNetwork", "simulateTransaction"). */
  operation: string;
  /** Endpoint targeted by the request (RPC method name or HTTP(S) URL). */
  endpoint?: string;
  /** Epoch milliseconds when the request started. */
  startedAt: number;
  /** Duration of the request in milliseconds (rounded to 3 decimal places). */
  durationMs: number;
  /** Whether the request succeeded or failed. */
  status: NetworkRequestStatus;
  /** Error message for failed requests. Never contains payload values. */
  error?: string;
  /** Optional correlation id supplied by the caller. */
  requestId?: string;
}

/** Callback invoked after each timed network request completes. */
export type NetworkTimingListener = (timing: NetworkRequestTiming) => void;

/** Options shared by the timing instrumentors. */
export interface NetworkTimingOptions {
  /** Listener invoked after every timed request completes (success or error). */
  onRequest?: NetworkTimingListener;
  /** Maximum number of timing records retained in memory. Default: 100. */
  maxRecords?: number;
  /**
   * Whether to attach the timing metadata to the response/error object via a
   * non-enumerable symbol. Default: true.
   */
  attachToResponse?: boolean;
}

/** Aggregated timing statistics over retained records. */
export interface NetworkTimingStats {
  /** Total number of recorded requests. */
  count: number;
  /** Sum of all request durations in milliseconds. */
  totalDurationMs: number;
  /** Average request duration in milliseconds (0 when no records). */
  avgDurationMs: number;
  /** Slowest request duration, or undefined when no records exist. */
  maxDurationMs?: number;
  /** Fastest request duration, or undefined when no records exist. */
  minDurationMs?: number;
  /** Per-operation breakdown for diagnostics. */
  byOperation: Record<
    string,
    {
      count: number;
      totalDurationMs: number;
      avgDurationMs: number;
    }
  >;
}
