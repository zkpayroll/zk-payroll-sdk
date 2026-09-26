/**
 * Request correlation ID support for SDK operations.
 *
 * Provides a unified way to trace payroll requests across logs and support
 * reports. Each operation gets a unique correlation ID that can be used
 * to group related operations together.
 *
 * @example
 * ```typescript
 * import { CorrelationContext, generateCorrelationId } from "@zk-payroll/core/correlation";
 *
 * // Create a correlation context for a payroll batch
 * const ctx = CorrelationContext.forBatch("payroll-2024-01");
 *
 * // Use the context in operations
 * await client.pay(ctx, { ... });
 *
 * // Log with correlation ID
 * logger.info({ correlationId: ctx.correlationId }, "Payment processed");
 * ```
 */

import { randomBytes, createHash } from "crypto";

/** Prefix for correlation IDs */
const CORRELATION_PREFIX = "corr_";

/** Prefix for span IDs */
const SPAN_PREFIX = "span_";

/**
 * A correlation context that groups related SDK operations.
 *
 * Each context has a unique correlation ID and can create child spans
 * for individual operations within the group.
 */
export class CorrelationContext {
  /** The primary correlation ID for this context */
  public readonly correlationId: string;

  /** Optional parent correlation ID for nested contexts */
  public readonly parentId?: string;

  /** Metadata attached to this context */
  public readonly metadata: Record<string, unknown>;

  private spanCounter = 0;

  /**
   * Create a new correlation context.
   *
   * @param id - Optional explicit ID (auto-generated if not provided)
   * @param parentId - Optional parent correlation ID
   * @param metadata - Optional metadata to attach
   */
  constructor(
    id?: string,
    parentId?: string,
    metadata: Record<string, unknown> = {}
  ) {
    this.correlationId = id ?? CorrelationContext.generateId();
    this.parentId = parentId;
    this.metadata = metadata;
  }

  /**
   * Create a context for a payroll batch operation.
   *
   * @param batchId - Identifier for the batch (e.g., "payroll-2024-01")
   * @param metadata - Optional additional metadata
   */
  static forBatch(batchId: string, metadata?: Record<string, unknown>): CorrelationContext {
    return new CorrelationContext(
      `${CORRELATION_PREFIX}batch_${CorrelationContext.hashString(batchId)}`,
      undefined,
      { batchId, ...metadata }
    );
  }

  /**
   * Create a context for a single transaction.
   *
   * @param transactionType - Type of transaction (e.g., "private_pay")
   * @param metadata - Optional additional metadata
   */
  static forTransaction(
    transactionType: string,
    metadata?: Record<string, unknown>
  ): CorrelationContext {
    return new CorrelationContext(
      `${CORRELATION_PREFIX}txn_${CorrelationContext.hashString(transactionType)}_${Date.now().toString(36)}`,
      undefined,
      { transactionType, ...metadata }
    );
  }

  /**
   * Create a child context for a sub-operation.
   *
   * @param operationName - Name of the sub-operation
   * @param metadata - Optional additional metadata
   * @returns A new CorrelationContext with this context as parent
   */
  child(operationName: string, metadata?: Record<string, unknown>): CorrelationContext {
    return new CorrelationContext(
      undefined,
      this.correlationId,
      { operation: operationName, ...metadata }
    );
  }

  /**
   * Create a new span ID for tracing within this context.
   *
   * @param spanName - Name of the span
   * @returns A unique span identifier
   */
  createSpan(spanName: string): string {
    this.spanCounter++;
    return `${SPAN_PREFIX}${this.correlationId}_${this.spanCounter}_${CorrelationContext.hashString(spanName).slice(0, 8)}`;
  }

  /**
   * Convert this context to a plain object for serialization.
   */
  toJSON(): Record<string, unknown> {
    return {
      correlationId: this.correlationId,
      parentId: this.parentId,
      metadata: this.metadata,
    };
  }

  /**
   * Generate a unique correlation ID.
   */
  static generateId(): string {
    const hex = randomBytes(16).toString("hex");
    return `${CORRELATION_PREFIX}${hex}`;
  }

  /**
   * Validate a correlation ID format.
   */
  static isValid(id: string): boolean {
    return /^corr_[a-f0-9]{32}$/.test(id);
  }

  /**
   * Generate a deterministic hash of a string (first 16 hex chars).
   */
  private static hashString(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 16);
  }
}

/**
 * A correlation-aware logger wrapper that automatically includes
 * correlation IDs in log output.
 */
export class CorrelatedLogger {
  private context: CorrelationContext;

  constructor(
    private readonly logger: {
      info: (msg: string, meta?: Record<string, unknown>) => void;
      warn: (msg: string, meta?: Record<string, unknown>) => void;
      error: (msg: string, meta?: Record<string, unknown>) => void;
      debug: (msg: string, meta?: Record<string, unknown>) => void;
    },
    context: CorrelationContext
  ) {
    this.context = context;
  }

  info(message: string, meta: Record<string, unknown> = {}): void {
    this.logger.info(message, { ...this.context.toJSON(), ...meta });
  }

  warn(message: string, meta: Record<string, unknown> = {}): void {
    this.logger.warn(message, { ...this.context.toJSON(), ...meta });
  }

  error(message: string, meta: Record<string, unknown> = {}): void {
    this.logger.error(message, { ...this.context.toJSON(), ...meta });
  }

  debug(message: string, meta: Record<string, unknown> = {}): void {
    this.logger.debug(message, { ...this.context.toJSON(), ...meta });
  }

  /**
   * Create a child logger with a new span.
   */
  child(spanName: string, meta?: Record<string, unknown>): CorrelatedLogger {
    const childContext = this.context.child(spanName, meta);
    return new CorrelatedLogger(this.logger, childContext);
  }
}
