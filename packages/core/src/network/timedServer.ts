/**
 * Timed `rpc.Server` wrapper for Soroban RPC diagnostics.
 *
 * {@link createTimedRpcServer} wraps any `@stellar/stellar-sdk` `rpc.Server`
 * (or a mock/server-like object) and records a {@link NetworkRequestTiming}
 * entry for every RPC method call — `getNetwork`, `getLedgerEntries`,
 * `simulateTransaction`, `sendTransaction`, `getTransaction`, and friends —
 * without changing the returned values or thrown errors.
 *
 * Timing records are retained in a bounded in-memory ring buffer (default 100)
 * and can be read back with `getNetworkTimings()` / `getNetworkTimingStats()`.
 * When `attachToResponse` is enabled (default), the timing metadata is also
 * attached to each response (and error) as a non-enumerable symbol property,
 * so serialized output and spread copies are unaffected.
 *
 * Security: records contain only the method name and duration — never the
 * request/response payloads or any private payroll values.
 *
 * @module
 */

import { rpc } from "@stellar/stellar-sdk";
import {
  attachTiming,
  computeStats,
  epochMs,
  now,
  roundDuration,
  safeErrorMessage,
} from "./timing";
import type { NetworkRequestTiming, NetworkTimingOptions, NetworkTimingStats } from "./types";

/** Symbol used to attach timing metadata to RPC responses/errors. */
export const RPC_TIMING = Symbol("rpc.network.timing");

/** A `rpc.Server` augmented with timing diagnostics. */
export interface TimedRpcServer extends rpc.Server {
  /** Returns a copy of the retained timing records (oldest first). */
  getNetworkTimings(): NetworkRequestTiming[];
  /** Clears all retained timing records. */
  clearNetworkTimings(): void;
  /** Computes aggregated statistics over the retained timing records. */
  getNetworkTimingStats(): NetworkTimingStats;
}

/** Options accepted by {@link createTimedRpcServer}. */
export type TimedRpcServerOptions = NetworkTimingOptions;

/**
 * Wraps an `rpc.Server` (or server-like mock) with request timing metadata.
 *
 * The returned proxy delegates every RPC call to the original server and
 * behaves identically except for the added timing instrumentation, so existing
 * SDK paths (polling, simulation, transaction submission, sanity checks) keep
 * working unchanged.
 *
 * @example
 * ```typescript
 * const server = createTimedRpcServer(new rpc.Server(rpcUrl));
 * const service = new PayrollService({ ...config, rpcUrl, server } as any);
 *
 * await service.processPayment(recipient, amount);
 *
 * const stats = server.getNetworkTimingStats();
 * if (stats.byOperation.simulateTransaction?.avgDurationMs > 1500) {
 *   console.warn("simulateTransaction is slow; consider a closer RPC endpoint");
 * }
 * ```
 *
 * @param server - The `rpc.Server` instance to instrument.
 * @param options - Timing options (listener, retention, attach behavior).
 * @returns An instrumented server that forwards all calls to `server`.
 */
export function createTimedRpcServer(
  server: rpc.Server,
  options: TimedRpcServerOptions = {}
): TimedRpcServer {
  const maxRecords = options.maxRecords ?? 100;
  const attachToResponse = options.attachToResponse ?? true;
  const records: NetworkRequestTiming[] = [];

  function record(timing: NetworkRequestTiming): void {
    records.push(timing);
    if (records.length > maxRecords) {
      records.splice(0, records.length - maxRecords);
    }
    options.onRequest?.(timing);
  }

  const helpers = {
    getNetworkTimings(): NetworkRequestTiming[] {
      return [...records];
    },
    clearNetworkTimings(): void {
      records.length = 0;
    },
    getNetworkTimingStats(): NetworkTimingStats {
      return computeStats(records);
    },
  };

  const proxy = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "getNetworkTimings") return helpers.getNetworkTimings;
      if (prop === "clearNetworkTimings") return helpers.clearNetworkTimings;
      if (prop === "getNetworkTimingStats") return helpers.getNetworkTimingStats;

      const originalValue = Reflect.get(target, prop, receiver);
      if (typeof originalValue !== "function") {
        return originalValue;
      }

      const methodName = String(prop);
      return async function timedMethod(this: unknown, ...args: unknown[]) {
        const startedAt = epochMs();
        const startedAtMonotonic = now();
        try {
          const result = await originalValue.apply(target, args);
          const timing: NetworkRequestTiming = {
            operation: methodName,
            startedAt,
            durationMs: roundDuration(now() - startedAtMonotonic),
            status: "success",
          };
          attachTiming(result, timing, { attachToResponse, symbol: RPC_TIMING });
          record(timing);
          return result;
        } catch (err) {
          const timing: NetworkRequestTiming = {
            operation: methodName,
            startedAt,
            durationMs: roundDuration(now() - startedAtMonotonic),
            status: "error",
            error: safeErrorMessage(err),
          };
          attachTiming(err, timing, { attachToResponse, symbol: RPC_TIMING });
          record(timing);
          throw err;
        }
      };
    },
  });

  return proxy as unknown as TimedRpcServer;
}
