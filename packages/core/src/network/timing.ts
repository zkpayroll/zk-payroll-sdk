/**
 * Low-level timing helpers shared by the network request instrumentors.
 *
 * @module
 */

import type { NetworkRequestTiming, NetworkTimingListener } from "./types";

/** Returns a high-resolution monotonic clock when available, else epoch ms. */
export function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Returns the current epoch time in milliseconds. */
export function epochMs(): number {
  return Date.now();
}

/** Rounds a duration to 3 decimal places (millisecond precision). */
export function roundDuration(durationMs: number): number {
  return Math.round(durationMs * 1000) / 1000;
}

/** Extracts a safe, payload-free message from a thrown value. */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Measures an async operation and produces its {@link NetworkRequestTiming}.
 *
 * The operation's result (or thrown error) is preserved exactly — only the
 * timing record is added. If `attachToResponse` is enabled and the resolved
 * value is an object, the timing is attached as a non-enumerable symbol
 * property so it can be read without altering serialized output.
 *
 * @param operation - Stable identifier for the operation.
 * @param fn - The async operation to time.
 * @param options - Endpoint, request id, and listener hooks.
 * @returns The original result together with its timing metadata.
 */
export async function measure<T>(
  operation: string,
  fn: () => Promise<T>,
  options: {
    endpoint?: string;
    requestId?: string;
    onRequest?: NetworkTimingListener;
    attachToResponse?: boolean;
    symbol?: symbol;
  } = {}
): Promise<{ result: T; timing: NetworkRequestTiming }> {
  const startedAt = epochMs();
  const startedAtMonotonic = now();

  try {
    const result = await fn();
    const timing: NetworkRequestTiming = {
      operation,
      endpoint: options.endpoint,
      startedAt,
      durationMs: roundDuration(now() - startedAtMonotonic),
      status: "success",
      requestId: options.requestId,
    };
    attachTiming(result, timing, options);
    options.onRequest?.(timing);
    return { result, timing };
  } catch (err) {
    const timing: NetworkRequestTiming = {
      operation,
      endpoint: options.endpoint,
      startedAt,
      durationMs: roundDuration(now() - startedAtMonotonic),
      status: "error",
      error: safeErrorMessage(err),
      requestId: options.requestId,
    };
    attachTiming(err, timing, options);
    options.onRequest?.(timing);
    throw err;
  }
}

/**
 * Attaches timing metadata to a value as a non-enumerable symbol property when
 * the value is a non-null object. Non-enumerable keeps JSON.stringify(),
 * spreads, and equality checks unchanged.
 */
export function attachTiming(
  target: unknown,
  timing: NetworkRequestTiming,
  options: { attachToResponse?: boolean; symbol?: symbol } = {}
): void {
  if (options.attachToResponse === false) return;
  if (target === null || target === undefined) return;
  if (typeof target !== "object" && typeof target !== "function") return;
  try {
    Object.defineProperty(target, options.symbol ?? Symbol("network.timing"), {
      value: timing,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    // Frozen or non-extensible targets are left untouched.
  }
}

/** Computes aggregated statistics from a list of timing records. */
export function computeStats(
  records: readonly NetworkRequestTiming[]
): import("./types").NetworkTimingStats {
  const byOperation: import("./types").NetworkTimingStats["byOperation"] = {};
  let totalDurationMs = 0;
  let minDurationMs: number | undefined;
  let maxDurationMs: number | undefined;

  for (const record of records) {
    totalDurationMs += record.durationMs;
    if (minDurationMs === undefined || record.durationMs < minDurationMs) {
      minDurationMs = record.durationMs;
    }
    if (maxDurationMs === undefined || record.durationMs > maxDurationMs) {
      maxDurationMs = record.durationMs;
    }

    const entry =
      byOperation[record.operation] ??
      (byOperation[record.operation] = {
        count: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
      });
    entry.count += 1;
    entry.totalDurationMs += record.durationMs;
  }

  for (const entry of Object.values(byOperation)) {
    entry.avgDurationMs = entry.count > 0 ? entry.totalDurationMs / entry.count : 0;
  }

  return {
    count: records.length,
    totalDurationMs,
    avgDurationMs: records.length > 0 ? totalDurationMs / records.length : 0,
    maxDurationMs,
    minDurationMs,
    byOperation,
  };
}
