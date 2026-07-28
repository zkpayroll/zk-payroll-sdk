export interface IdempotencyExecuteOptions {
  /**
   * How long successful results stay cached in-memory for replay.
   * Set to 0 to only dedupe concurrent in-flight requests.
   */
  ttlMs?: number;
  /**
   * Whether to cache rejected results for replay.
   * Defaults to false so callers can safely retry after transient errors.
   */
  cacheErrors?: boolean;
}

interface IdempotencyEntry<T> {
  promise: Promise<T>;
  expiresAt: number | null;
}

/**
 * In-memory idempotency helper.
 *
 * - Reuses the same promise for duplicate keys while a request is in flight
 * - Optionally replays successful results for a short TTL window
 */
export class IdempotencyRegistry<T> {
  private readonly entries = new Map<string, IdempotencyEntry<T>>();

  constructor(private readonly defaultTtlMs = 5 * 60 * 1000) {}

  async execute(
    key: string,
    fn: () => Promise<T>,
    options: IdempotencyExecuteOptions = {}
  ): Promise<T> {
    const normalizedKey = normalizeIdempotencyKey(key);
    if (!normalizedKey) {
      throw new Error("Idempotency key must not be empty");
    }

    this.pruneExpired();

    const existing = this.entries.get(normalizedKey);
    if (existing) {
      return existing.promise;
    }

    const ttlMs = Math.max(0, options.ttlMs ?? this.defaultTtlMs);
    const cacheErrors = options.cacheErrors ?? false;

    const promise = fn();
    this.entries.set(normalizedKey, {
      promise,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null,
    });

    try {
      return await promise;
    } catch (error) {
      if (!cacheErrors) {
        this.entries.delete(normalizedKey);
      }
      throw error;
    } finally {
      if (ttlMs === 0) {
        this.entries.delete(normalizedKey);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export interface PaymentIdempotencyKeyInput {
  recipient: string;
  amount: bigint;
  asset: string;
}

/**
 * Deterministic helper for generating payment idempotency keys.
 *
 * Recommended usage: append your own UI/request nonce if you need to allow
 * repeated identical payments as distinct operations.
 */
export function createPaymentIdempotencyKey(input: PaymentIdempotencyKeyInput): string {
  const recipient = input.recipient.trim().toLowerCase();
  const asset = input.asset.trim().toLowerCase();
  return `pay:${recipient}:${input.amount.toString()}:${asset}`;
}

export function normalizeIdempotencyKey(key: string): string {
  return key.trim();
}

export interface PayrollIdempotencyKeyInput {
  companyId: string;
  payrollPeriod: string;
  commitmentHash: string;
  asset: string;
  treasuryContext: string;
}

/**
 * Deterministic helper for generating payroll submission idempotency keys.
 * Incorporates high-priority business context to avoid duplicate batch submissions.
 */
export function createPayrollIdempotencyKey(input: PayrollIdempotencyKeyInput): string {
  const companyId = input.companyId.trim();
  const payrollPeriod = input.payrollPeriod.trim();
  const commitmentHash = input.commitmentHash.trim().toLowerCase();
  const asset = input.asset.trim().toLowerCase();
  const treasuryContext = input.treasuryContext.trim();

  return `payroll:${companyId}:${payrollPeriod}:${commitmentHash}:${asset}:${treasuryContext}`;
}
