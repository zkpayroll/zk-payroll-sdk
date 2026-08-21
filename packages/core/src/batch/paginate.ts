/**
 * Batch pagination helpers for employee and payroll-recipient collections.
 *
 * Unlike the view-oriented pagination in `src/pagination.ts` (Issue #47),
 * which clamps out-of-range page sizes for history/audit queries, these
 * helpers are pure batch-processing utilities with strict validation:
 * invalid page sizes fail fast so a payroll run never processes records
 * in an unintended batch size.
 *
 * The helpers are generic, stateless, and independent of payroll business
 * logic: they only decide which records belong to the current batch.
 * Ordering of the underlying collection is always preserved and records
 * are never duplicated or skipped across batches.
 */

import { ValidationError } from "../core/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single deterministic batch (page) of a larger collection. */
export interface BatchPage<T> {
  /** Records belonging to this batch, in original collection order. */
  readonly items: T[];
  /** Zero-based index of this batch (0 .. totalPages - 1). */
  readonly index: number;
  /** Starting offset of this batch within the original collection. */
  readonly offset: number;
  /** Number of records in this batch. */
  readonly count: number;
  /** Total number of records in the underlying collection. */
  readonly totalItems: number;
  /** Total number of batches the collection is divided into. */
  readonly totalPages: number;
  /** Whether another batch follows this one. */
  readonly hasNext: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a batch size.
 *
 * Rejects `0`, negative values, non-finite values (`NaN`, `Infinity`),
 * and non-integers with a clear developer-facing error. When `pageSize`
 * is `undefined` the caller has not opted into pagination and the value
 * is considered valid (the whole collection is treated as one batch).
 *
 * @internal
 */
export function assertValidPageSize(pageSize: unknown): void {
  if (pageSize === undefined) return;

  if (typeof pageSize !== "number" || !Number.isFinite(pageSize) || !Number.isInteger(pageSize)) {
    throw new ValidationError("Invalid page size: expected a positive integer.", "pageSize");
  }

  if (pageSize <= 0) {
    throw new ValidationError("Invalid page size: expected a positive integer.", "pageSize");
  }
}

/**
 * Validates a zero-based batch index.
 * @internal
 */
export function assertValidBatchIndex(batchIndex: number): void {
  const isValid =
    typeof batchIndex === "number" &&
    Number.isFinite(batchIndex) &&
    Number.isInteger(batchIndex) &&
    batchIndex >= 0;

  if (!isValid) {
    throw new ValidationError(
      "Invalid batch index: expected a non-negative integer.",
      "batchIndex"
    );
  }
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Returns the requested batch of an ordered collection.
 *
 * Pure and stateless: the same inputs always produce the same batch, and
 * no state is shared between unrelated payroll operations. An empty
 * collection yields an empty batch with `hasNext = false`. A batch index
 * beyond the last page returns an empty batch rather than throwing.
 *
 * @param items - Ordered collection to divide into batches.
 * @param pageSize - Number of records per batch (positive integer).
 * @param batchIndex - Zero-based batch to return (default: 0).
 * @throws {ValidationError} When `pageSize` or `batchIndex` is invalid.
 *
 * @example
 * ```ts
 * const firstBatch = getBatchPage(employees, 100, 0);
 * if (firstBatch.hasNext) { ... }
 * ```
 */
export function getBatchPage<T>(items: T[], pageSize?: number, batchIndex = 0): BatchPage<T> {
  assertValidPageSize(pageSize);
  assertValidBatchIndex(batchIndex);

  const totalItems = items.length;
  const effectivePageSize = pageSize ?? totalItems;
  const totalPages = totalItems === 0 ? 1 : Math.ceil(totalItems / effectivePageSize);

  const offset = batchIndex * effectivePageSize;
  const clampedOffset = Math.min(offset, totalItems);
  const pageItems = items.slice(clampedOffset, clampedOffset + effectivePageSize);

  return {
    items: pageItems,
    index: batchIndex,
    offset: clampedOffset,
    count: pageItems.length,
    totalItems,
    totalPages,
    hasNext: batchIndex + 1 < totalPages,
  };
}

/**
 * Lazily iterates over all batches of an ordered collection.
 *
 * Each yielded {@link BatchPage} is computed independently from the
 * original collection, so iteration cannot leak state between payroll
 * operations. Concatenating `items` across all yielded batches
 * reconstructs the original collection exactly once and in order.
 *
 * @param items - Ordered collection to divide into batches.
 * @param pageSize - Number of records per batch (positive integer).
 * @throws {ValidationError} When `pageSize` is invalid.
 *
 * @example
 * ```ts
 * for (const batch of iterateBatches(recipients, 50)) {
 *   await processRecipientBatch(batch.items);
 * }
 * ```
 */
export function* iterateBatches<T>(items: T[], pageSize?: number): Generator<BatchPage<T>> {
  assertValidPageSize(pageSize);

  const totalItems = items.length;
  const effectivePageSize = pageSize ?? (totalItems > 0 ? totalItems : 1);
  const totalPages = totalItems === 0 ? 1 : Math.ceil(totalItems / effectivePageSize);

  for (let index = 0; index < totalPages; index++) {
    const offset = index * effectivePageSize;
    const pageItems = items.slice(offset, offset + effectivePageSize);

    yield {
      items: pageItems,
      index,
      offset,
      count: pageItems.length,
      totalItems,
      totalPages,
      hasNext: index + 1 < totalPages,
    };
  }
}
