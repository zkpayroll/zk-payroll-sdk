/**
 * Execution Reference Collision Prevention (#705)
 *
 * Prevents duplicate or colliding execution references during SDK payroll
 * submissions and batch runs. Ensures idempotency, auditability, and prevents
 * double-execution of disbursements.
 */

export interface ExecutionReferenceRecord {
  reference: string;
  batchId?: string;
  payrollPeriodId?: string;
  registeredAt: number;
  status: "pending" | "in_flight" | "executed" | "failed" | "cancelled";
  metadata?: Record<string, unknown>;
}

export interface CollisionCheckResult {
  isValid: boolean;
  colliding: boolean;
  reference: string;
  existingRecord?: ExecutionReferenceRecord;
  reason?: string;
}

export class ExecutionReferenceCollisionError extends Error {
  public readonly reference: string;
  public readonly existingRecord?: ExecutionReferenceRecord;

  constructor(reference: string, message: string, existingRecord?: ExecutionReferenceRecord) {
    super(message);
    this.name = "ExecutionReferenceCollisionError";
    this.reference = reference;
    this.existingRecord = existingRecord;
  }
}

/**
 * Normalizes execution references to ensure consistent format comparisons.
 */
export function normalizeExecutionReference(reference: string): string {
  if (typeof reference !== "string") {
    throw new TypeError("Execution reference must be a string");
  }
  const trimmed = reference.trim();
  if (trimmed.length === 0) {
    throw new TypeError("Execution reference cannot be empty");
  }
  return trimmed;
}

/**
 * Manages active and historical execution references to prevent collision and duplicate runs.
 */
export class ExecutionReferenceCollisionGuard {
  private readonly records = new Map<string, ExecutionReferenceRecord>();

  /**
   * Checks whether an execution reference collides with an existing active or executed reference.
   */
  public check(reference: string): CollisionCheckResult {
    const normalized = normalizeExecutionReference(reference);
    const existing = this.records.get(normalized);

    if (
      existing &&
      (existing.status === "in_flight" ||
        existing.status === "executed" ||
        existing.status === "pending")
    ) {
      return {
        isValid: false,
        colliding: true,
        reference: normalized,
        existingRecord: existing,
        reason: `Execution reference "${normalized}" already exists with status "${existing.status}"`,
      };
    }

    return {
      isValid: true,
      colliding: false,
      reference: normalized,
    };
  }

  /**
   * Registers a new execution reference. Throws ExecutionReferenceCollisionError if already in use.
   */
  public register(
    reference: string,
    options: {
      batchId?: string;
      payrollPeriodId?: string;
      status?: "pending" | "in_flight";
      metadata?: Record<string, unknown>;
    } = {}
  ): ExecutionReferenceRecord {
    const checkResult = this.check(reference);
    if (checkResult.colliding) {
      throw new ExecutionReferenceCollisionError(
        checkResult.reference,
        checkResult.reason ??
          `Collision detected for execution reference: ${checkResult.reference}`,
        checkResult.existingRecord
      );
    }

    const record: ExecutionReferenceRecord = {
      reference: checkResult.reference,
      batchId: options.batchId,
      payrollPeriodId: options.payrollPeriodId,
      registeredAt: Date.now(),
      status: options.status ?? "in_flight",
      metadata: options.metadata,
    };

    this.records.set(checkResult.reference, record);
    return record;
  }

  /**
   * Attempts to register an execution reference without throwing an exception.
   */
  public tryRegister(
    reference: string,
    options: {
      batchId?: string;
      payrollPeriodId?: string;
      status?: "pending" | "in_flight";
      metadata?: Record<string, unknown>;
    } = {}
  ): CollisionCheckResult {
    try {
      this.register(reference, options);
      return {
        isValid: true,
        colliding: false,
        reference: normalizeExecutionReference(reference),
      };
    } catch (err) {
      if (err instanceof ExecutionReferenceCollisionError) {
        return {
          isValid: false,
          colliding: true,
          reference: err.reference,
          existingRecord: err.existingRecord,
          reason: err.message,
        };
      }
      throw err;
    }
  }

  /**
   * Marks an execution reference as completed.
   */
  public markExecuted(reference: string): void {
    const normalized = normalizeExecutionReference(reference);
    const existing = this.records.get(normalized);
    if (existing) {
      existing.status = "executed";
    } else {
      this.records.set(normalized, {
        reference: normalized,
        registeredAt: Date.now(),
        status: "executed",
      });
    }
  }

  /**
   * Releases an execution reference when an execution has failed or was cancelled.
   */
  public release(reference: string, reason: "failed" | "cancelled" = "cancelled"): boolean {
    const normalized = normalizeExecutionReference(reference);
    const existing = this.records.get(normalized);
    if (existing) {
      existing.status = reason;
      return true;
    }
    return false;
  }

  /**
   * Generates a collision-resistant deterministic execution reference.
   */
  public generateUniqueReference(
    prefix: string,
    batchId: string,
    nonce: string | number = Date.now()
  ): string {
    const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "");
    const cleanBatchId = batchId.replace(/[^a-zA-Z0-9_-]/g, "");
    const candidate = `${cleanPrefix}_${cleanBatchId}_${nonce}`;
    return candidate;
  }

  /**
   * Clears internal state (primarily used in testing).
   */
  public clear(): void {
    this.records.clear();
  }
}

/**
 * Validates a list of execution references for internal duplicates.
 */
export function validateBatchExecutionReferences(references: string[]): {
  isValid: boolean;
  duplicates: string[];
} {
  if (!Array.isArray(references)) {
    throw new TypeError("Expected an array of execution references");
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const ref of references) {
    const normalized = normalizeExecutionReference(ref);
    if (seen.has(normalized)) {
      if (!duplicates.includes(normalized)) {
        duplicates.push(normalized);
      }
    } else {
      seen.add(normalized);
    }
  }

  return {
    isValid: duplicates.length === 0,
    duplicates,
  };
}
