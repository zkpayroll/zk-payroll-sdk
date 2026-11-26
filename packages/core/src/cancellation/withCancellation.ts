import { OperationCancelledError, throwIfAborted } from "./types";

/**
 * Wraps an async operation so that it rejects with `OperationCancelledError`
 * when the supplied `AbortSignal` is aborted.
 *
 * Guarantees:
 *  - Rejects immediately if the signal is already aborted before starting.
 *  - Rejects as soon as the signal aborts while the operation is in flight.
 *  - Never includes sensitive payroll values in the rejection.
 *  - No-ops (transparent pass-through) when no signal is provided.
 */
export async function withCancellation<T>(
  operationName: string,
  signal: AbortSignal | undefined,
  fn: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  throwIfAborted(signal, operationName);

  if (!signal) {
    return fn(undefined);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new OperationCancelledError(operationName));
    signal.addEventListener("abort", onAbort, { once: true });

    fn(signal)
      .then((value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      })
      .catch((err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      });
  });
}

/**
 * Sleeps for `ms` milliseconds, but resolves/rejects early when the signal
 * aborts. Useful inside polling loops so long waits can be cut short.
 */
export function cancellableDelay(
  ms: number,
  signal: AbortSignal | undefined,
  operationName = "delay",
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OperationCancelledError(operationName));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OperationCancelledError(operationName));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
