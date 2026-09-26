import { classifyError, RetryCategory, type RetryDecision } from "../core/retry";

export interface RpcRetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  signal?: AbortSignal;
  onRetry?: (event: { attempt: number; delayMs: number; decision: RetryDecision }) => void;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

function resolvePolicy(policy: RpcRetryPolicy): {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
} {
  const maxAttempts = policy.maxAttempts ?? 3;
  const baseDelayMs = policy.baseDelayMs ?? 200;
  const maxDelayMs = policy.maxDelayMs ?? 5_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new RangeError("maxAttempts must be a positive integer.");
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0)
    throw new RangeError("baseDelayMs must be non-negative.");
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs)
    throw new RangeError("maxDelayMs must be at least baseDelayMs.");
  return { maxAttempts, baseDelayMs, maxDelayMs };
}

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Retry aborted", "AbortError"));
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Retry aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/** Retries transient RPC failures only; validation and contract reverts fail immediately. */
export async function withRpcRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RpcRetryPolicy = {}
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = resolvePolicy(policy);
  const sleep = policy.sleep ?? defaultSleep;
  const random = policy.random ?? Math.random;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (policy.signal?.aborted) throw new DOMException("Retry aborted", "AbortError");
    try {
      return await operation(attempt);
    } catch (error) {
      const decision = classifyError(error);
      if (attempt === maxAttempts || decision.category !== RetryCategory.RETRYABLE) throw error;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = policy.jitter === false ? ceiling : Math.floor(ceiling * random());
      policy.onRetry?.({ attempt, delayMs, decision });
      await sleep(delayMs, policy.signal);
    }
  }
  throw new Error("RPC retry loop ended unexpectedly.");
}
