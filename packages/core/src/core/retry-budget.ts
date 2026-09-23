import { ZkPayrollError, ErrorContext } from "./errors";
import { IdempotencyRegistry } from "./idempotency";
import { classifyError, RetryCategory, RetryDecision } from "./retry";

/**
 * Kinds of RPC operation the SDK can be asked to perform. Each kind gets its
 * own retry budget so idempotent reads can be retried aggressively while
 * non-idempotent writes stay protected.
 */
export const RetryOperationType = {
  READ: "read",
  WRITE: "write",
  POLL: "poll",
} as const;

export type RetryOperationType = (typeof RetryOperationType)[keyof typeof RetryOperationType];

/** Backoff parameters shared by every operation type. */
export interface RetryBackoffConfig {
  /** Delay before the first retry, in milliseconds. */
  initialDelayMs: number;
  /** Multiplier applied to the delay after every retry. */
  backoffFactor: number;
  /** Upper bound on the exponential delay, in milliseconds. */
  maxDelayMs: number;
  /**
   * Maximum random additional delay applied on top of the exponential delay,
   * in milliseconds. 0 (the default) disables jitter and keeps the schedule
   * fully deterministic.
   */
  jitterMs: number;
}

/** A fully-resolved retry budget for a single operation type. */
export interface RetryBudgetConfig extends RetryBackoffConfig {
  /** Total attempts including the first attempt (1 disables retrying). */
  maxAttempts: number;
  /** Optional overall deadline in milliseconds, measured from the first attempt. */
  timeoutMs?: number;
  /**
   * When true, retrying requires an idempotency key/nonce. If none is
   * provided the effective budget is capped at a single attempt and any
   * failure is reported as a refused retry. Safety-critical for writes.
   */
  idempotencyRequired: boolean;
}

/** Per-operation-type retry budgets, keyed by {@link RetryOperationType}. */
export type RetryBudgetByOperation = {
  read?: Partial<RetryBudgetConfig>;
  write?: Partial<RetryBudgetConfig>;
  poll?: Partial<RetryBudgetConfig>;
};

/**
 * Default retry budgets.
 *
 * Reads and status polls are idempotent and retry with a bounded exponential
 * backoff. Writes (transaction submission) default to a single attempt: they
 * are non-idempotent, so automatic retries are refused unless the caller
 * supplies an idempotency key.
 */
export const DEFAULT_RETRY_BUDGETS: RetryBudgetByOperation = {
  read: {
    maxAttempts: 3,
    initialDelayMs: 100,
    backoffFactor: 2,
    maxDelayMs: 1_600,
    jitterMs: 0,
    idempotencyRequired: false,
  },
  poll: {
    maxAttempts: 3,
    initialDelayMs: 100,
    backoffFactor: 2,
    maxDelayMs: 1_600,
    jitterMs: 0,
    idempotencyRequired: false,
  },
  write: {
    maxAttempts: 1,
    initialDelayMs: 100,
    backoffFactor: 2,
    maxDelayMs: 1_600,
    jitterMs: 0,
    idempotencyRequired: true,
  },
};

/**
 * Merge the default budget for an operation type with optional per-operation
 * and per-call overrides. Later sources win, so callers can tune individual
 * parameters without rebuilding the whole budget.
 */
export function resolveRetryBudget(
  operationType: RetryOperationType,
  input: { budgets?: RetryBudgetByOperation; overrides?: Partial<RetryBudgetConfig> } = {}
): RetryBudgetConfig {
  return {
    ...(DEFAULT_RETRY_BUDGETS[operationType] ?? {}),
    ...(input.budgets?.[operationType] ?? {}),
    ...(input.overrides ?? {}),
  } as RetryBudgetConfig;
}

/**
 * Compute the deterministic backoff delay for a given attempt.
 *
 * The delay is `min(initialDelayMs * backoffFactor^(attempt-1), maxDelayMs)`
 * plus optional jitter. Jitter uses the injected `random` function (defaults
 * to `Math.random`) so tests can pin both the exponential schedule and the
 * jitter bounds without depending on wall-clock timing.
 */
export function computeBackoffDelay(
  attempt: number,
  budget: Pick<RetryBackoffConfig, "initialDelayMs" | "backoffFactor" | "maxDelayMs" | "jitterMs">,
  random: () => number = Math.random
): number {
  const attemptIndex = Math.max(1, attempt);
  const exponentialDelay = budget.initialDelayMs * Math.pow(budget.backoffFactor, attemptIndex - 1);
  const cappedDelay = Math.min(exponentialDelay, budget.maxDelayMs);
  const jitter = budget.jitterMs > 0 ? Math.floor(random() * (budget.jitterMs + 1)) : 0;
  return cappedDelay + jitter;
}

export const RETRY_BUDGET_EXHAUSTED_CODE = "RETRY_BUDGET_EXHAUSTED";
export const RETRY_CANCELLED_CODE = "RETRY_CANCELLED";

/**
 * Thrown when a retry budget is exhausted (or refuses to retry). This is a
 * distinct, catchable SDK error so callers can tell 'gave up after N retries'
 * apart from a genuine failure that was never retried.
 */
export class RetryBudgetExhaustedError extends ZkPayrollError {
  constructor(
    message: string,
    public readonly operationType: RetryOperationType,
    public readonly attempts: number,
    public readonly maxAttempts: number,
    /** True when retries were refused for safety (non-idempotent op without a key). */
    public readonly retryRefused: boolean,
    public readonly deadlineExceeded: boolean,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, RETRY_BUDGET_EXHAUSTED_CODE, context, cause);
    this.name = "RetryBudgetExhaustedError";
  }
}

/** Thrown when an in-flight retry sequence is interrupted via an AbortSignal. */
export class RetryCancelledError extends ZkPayrollError {
  constructor(
    message: string,
    public readonly operationType: RetryOperationType,
    cause?: unknown
  ) {
    super(message, RETRY_CANCELLED_CODE, {}, cause);
    this.name = "RetryCancelledError";
  }
}

export interface WithRetryBudgetOptions<T> {
  /** Kind of operation being retried. Determines the default budget. */
  operationType?: RetryOperationType;
  /** Per-call budget overrides (win over `budgets`). */
  budget?: Partial<RetryBudgetConfig>;
  /** Per-operation-type budgets (win over the built-in defaults). */
  budgets?: RetryBudgetByOperation;
  /**
   * Idempotency key/nonce. Required before a non-idempotent operation type
   * ('write') will be retried; without it the budget is capped at one attempt.
   */
  idempotencyKey?: string;
  /** AbortSignal that cancels the retry sequence between or during attempts. */
  signal?: AbortSignal;
  /**
   * Per-attempt timeout in milliseconds. When exceeded, the attempt is treated
   * as a retryable failure and the loop moves on - the underlying call is left
   * running. Combined with `registry` + `idempotencyKey`, a retry of a still
   * in-flight submission reuses the same promise instead of double-submitting.
   */
  attemptTimeoutMs?: number;
  /** Called with the attempt number when a retry is about to be scheduled. */
  onRetry?: (attempt: number, error: unknown, decision: RetryDecision) => void;
  /** Injectable clock for deterministic deadline checks (defaults to Date.now). */
  now?: () => number;
  /** Injectable scheduler for deterministic backoff (defaults to setTimeout). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable randomness source for jitter (defaults to Math.random). */
  random?: () => number;
  /**
   * Registry used for duplicate-operation protection. When an idempotency key
   * is present, each attempt is executed through `registry.execute(key, fn)` so
   * concurrent retries of the same operation share a single in-flight promise
   * instead of submitting the same operation twice.
   */
  registry?: IdempotencyRegistry<T>;
}

type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

type AttemptResult<T> = { timedOut: false; value: T } | { timedOut: true };

function abortableSleep(
  ms: number,
  signal: AbortSignal | undefined,
  operationType: RetryOperationType
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new RetryCancelledError(
          "Retry sequence for " + operationType + " was cancelled during the backoff delay",
          operationType,
          signal?.reason
        )
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      reject(
        new RetryCancelledError(
          "Retry sequence for " + operationType + " was cancelled before the backoff delay elapsed",
          operationType,
          signal.reason
        )
      );
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function runAttemptWithTimeout<T>(
  invoke: () => Promise<T>,
  attemptTimeoutMs: number | undefined,
  sleep: SleepFn,
  signal: AbortSignal | undefined,
  operationType: RetryOperationType
): Promise<AttemptResult<T>> {
  if (attemptTimeoutMs === undefined) {
    return invoke().then((value) => ({ timedOut: false as const, value }));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const onAttemptSettled = (result: AttemptResult<T>, error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error !== undefined) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    invoke().then(
      (value) => onAttemptSettled({ timedOut: false as const, value }),
      (error) => onAttemptSettled({ timedOut: false as const, value: undefined as never }, error)
    );

    sleep(attemptTimeoutMs, signal).then(
      () => onAttemptSettled({ timedOut: true as const }),
      (error) => onAttemptSettled({ timedOut: false as const, value: undefined as never }, error)
    );
  });
}

const TIMED_OUT_RETRY_DECISION: RetryDecision = {
  category: RetryCategory.RETRYABLE,
  retryable: true,
  reason: "Attempt exceeded its per-attempt timeout; the call may still be in flight",
};

/**
 * Run `fn` under a retry budget.
 *
 * Unlike the lower-level `withRetry`, `withRetryBudget` is operation-type aware:
 *
 * - Each operation type ('read', 'poll', 'write') resolves its own budget from
 *   `DEFAULT_RETRY_BUDGETS`, `budgets`, and per-call `budget` overrides.
 * - Backoff is deterministic and bounded (`initialDelayMs`, `backoffFactor`,
 *   `maxDelayMs`, optional `jitterMs`) and can be driven by an injected
 *   `sleep`/`now` for tests.
 * - An AbortSignal interrupts the sequence cleanly via `RetryCancelledError`.
 * - Non-idempotent operations ('write') are only retried when an `idempotencyKey`
 *   is supplied; otherwise the budget is capped at one attempt and failures
 *   surface as a `RetryBudgetExhaustedError` with `retryRefused: true`.
 * - When a `registry` is provided alongside an `idempotencyKey`, retried
 *   attempts deduplicate against the in-flight execution of the same key, so
 *   the same operation is never submitted twice concurrently.
 *
 * Retry continuation is gated by `classifyError` exactly like `withRetry`:
 * NON_RETRYABLE failures are rethrown immediately (fails fast), RETRYABLE and
 * UNKNOWN failures consume the budget. Exhausting the budget throws
 * `RetryBudgetExhaustedError` rather than a generic error.
 */
export async function withRetryBudget<T>(
  fn: () => Promise<T>,
  options: WithRetryBudgetOptions<T> = {}
): Promise<T> {
  const operationType = options.operationType ?? RetryOperationType.READ;
  const budget = resolveRetryBudget(operationType, {
    budgets: options.budgets,
    overrides: options.budget,
  });

  const hasIdempotencyKey = Boolean(options.idempotencyKey?.trim());
  // Safety-critical: never retry a non-idempotent operation unless the caller
  // supplied an idempotency key/nonce. Without one the budget is capped at a
  // single attempt and the failure reports that retrying was refused.
  const retryRefused = budget.idempotencyRequired && !hasIdempotencyKey;
  const maxAttempts = retryRefused ? 1 : Math.max(1, budget.maxAttempts);

  const now = options.now ?? Date.now;
  const sleepImpl: SleepFn =
    options.sleep ?? ((ms: number, sig?: AbortSignal) => abortableSleep(ms, sig, operationType));
  const random = options.random ?? Math.random;
  const signal = options.signal;
  const startedAt = now();

  const invokeAttempt = (): Promise<T> => {
    if (options.registry && hasIdempotencyKey) {
      return options.registry.execute(options.idempotencyKey!, fn, { ttlMs: 0 });
    }
    return fn();
  };

  const cancelled = (stage: string): RetryCancelledError =>
    new RetryCancelledError(
      "Retry sequence for " + operationType + " was cancelled " + stage,
      operationType,
      signal?.reason
    );

  const exhausted = (
    attempts: number,
    deadlineExceeded: boolean,
    cause?: unknown
  ): RetryBudgetExhaustedError => {
    const lastMessage =
      cause instanceof Error
        ? cause.message
        : cause === undefined
          ? "no attempt completed"
          : String(cause);

    let message: string;
    if (retryRefused) {
      message =
        "Retry budget for " +
        operationType +
        " refused to retry after " +
        attempts +
        " attempt(s): non-idempotent operations require an idempotency key/nonce before they can be retried safely (last error: " +
        lastMessage +
        ")";
    } else if (deadlineExceeded) {
      message =
        "Retry budget for " +
        operationType +
        " exceeded its " +
        budget.timeoutMs +
        "ms deadline after " +
        attempts +
        " attempt(s) (max " +
        maxAttempts +
        ") - giving up (last error: " +
        lastMessage +
        ")";
    } else {
      message =
        "Retry budget for " +
        operationType +
        " exhausted after " +
        attempts +
        " attempt(s) (max " +
        maxAttempts +
        ") - giving up (last error: " +
        lastMessage +
        ")";
    }

    return new RetryBudgetExhaustedError(
      message,
      operationType,
      attempts,
      maxAttempts,
      retryRefused,
      deadlineExceeded,
      { operationType },
      cause
    );
  };

  if (signal?.aborted) {
    throw cancelled("before the first attempt");
  }

  let lastError: unknown;
  let lastDecision: RetryDecision | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw cancelled("before attempt " + attempt);
    }

    if (budget.timeoutMs !== undefined && now() - startedAt >= budget.timeoutMs) {
      throw exhausted(attempt - 1, true, lastError);
    }

    let attemptError: unknown;
    let timedOut = false;

    try {
      const result = await runAttemptWithTimeout(
        invokeAttempt,
        options.attemptTimeoutMs,
        sleepImpl,
        signal,
        operationType
      );
      if (!result.timedOut) {
        return result.value;
      }
      timedOut = true;
      const timeoutError = new Error(
        "Attempt " +
          attempt +
          " of " +
          operationType +
          " did not complete within " +
          options.attemptTimeoutMs +
          "ms"
      );
      timeoutError.name = "RetryAttemptTimeoutError";
      attemptError = timeoutError;
    } catch (err) {
      if (signal?.aborted) {
        throw cancelled("after attempt " + attempt);
      }
      attemptError = err;
    }

    lastError = attemptError;

    if (attempt === maxAttempts) break;

    if (!timedOut) {
      const retryDecision = classifyError(attemptError);
      lastDecision = retryDecision;
      if (retryDecision.category === RetryCategory.NON_RETRYABLE) {
        // Permanent failure: rethrow the original error immediately instead of
        // consuming the remaining budget on attempts that cannot succeed.
        throw attemptError;
      }
    }

    options.onRetry?.(
      attempt,
      attemptError,
      timedOut ? TIMED_OUT_RETRY_DECISION : (lastDecision as RetryDecision)
    );

    const backoffMs = computeBackoffDelay(attempt, budget, random);
    if (budget.timeoutMs !== undefined && now() - startedAt + backoffMs >= budget.timeoutMs) {
      throw exhausted(attempt, true, lastError);
    }

    try {
      await sleepImpl(backoffMs, signal);
    } catch (err) {
      if (signal?.aborted) {
        throw cancelled("during the backoff delay");
      }
      throw err;
    }
  }

  throw exhausted(maxAttempts, false, lastError);
}
