import type { PaginationOptions } from "../pagination";
import { ValidationError } from "../core/errors";
import type { ArchiveQuery } from "./types";

/**
 * Internal snapshot of builder state. Bigints are kept as bigints here;
 * they are serialized to decimal strings only in `toParams()`.
 */
interface ArchiveQuerySnapshot {
  employeeIds: string[];
  assets: string[];
  periodStart?: string;
  periodEnd?: string;
  status?: "completed" | "failed";
  minAmount?: bigint;
  maxAmount?: bigint;
  pageSize?: number;
  cursor?: string;
}

/**
 * Creates an `ArchiveQuery` that closes over an immutable snapshot.
 * @internal
 */
function buildQuery(snapshot: ArchiveQuerySnapshot): ArchiveQuery {
  return {
    toParams(): Record<string, string> {
      const params: Record<string, string> = {};

      if (snapshot.employeeIds.length > 0) {
        params["employeeIds"] = snapshot.employeeIds.join(",");
      }
      if (snapshot.assets.length > 0) {
        params["assets"] = snapshot.assets.join(",");
      }
      if (snapshot.periodStart !== undefined) {
        params["periodStart"] = snapshot.periodStart;
      }
      if (snapshot.periodEnd !== undefined) {
        params["periodEnd"] = snapshot.periodEnd;
      }
      if (snapshot.status !== undefined) {
        params["status"] = snapshot.status;
      }
      if (snapshot.minAmount !== undefined) {
        params["minAmount"] = snapshot.minAmount.toString();
      }
      if (snapshot.maxAmount !== undefined) {
        params["maxAmount"] = snapshot.maxAmount.toString();
      }
      if (snapshot.pageSize !== undefined) {
        params["pageSize"] = snapshot.pageSize.toString();
      }
      if (snapshot.cursor !== undefined) {
        params["cursor"] = snapshot.cursor;
      }

      return params;
    },
  };
}

/**
 * Fluent query builder for archived payroll data, scoped to reporting use cases.
 *
 * Produces an immutable `ArchiveQuery` via `build()` that can be consumed by
 * `getArchivedPayrollPage`, `archiveIterator`, and `buildArchiveSummaryReport`.
 *
 * Accumulation semantics:
 * - `forEmployee` / `forEmployees` — IDs accumulate (deduplicated via Set)
 * - `withAsset` / `withAssets`     — asset identifiers accumulate (deduplicated via Set)
 * - `forPeriod`                    — replaces the previously set period
 * - `withStatus`                   — replaces the previously set status
 * - `withMinAmount` / `withMaxAmount` — each replaces the previously set bound
 * - `paginate`                     — replaces the previously set pagination options
 *
 * @example
 * ```ts
 * const query = new ArchiveFilterBuilder()
 *   .forPeriod("2024-01-01", "2024-03-31")
 *   .withStatus("completed")
 *   .withAsset("USDC")
 *   .paginate({ pageSize: 50 })
 *   .build();
 * ```
 */
export class ArchiveFilterBuilder {
  private _employeeIds: Set<string> = new Set();
  private _assets: Set<string> = new Set();
  private _periodStart?: string;
  private _periodEnd?: string;
  private _status?: "completed" | "failed";
  private _minAmount?: bigint;
  private _maxAmount?: bigint;
  private _pagination?: PaginationOptions;

  /**
   * Sets an inclusive ISO 8601 date range for the query.
   * Calling this a second time replaces the previously set period.
   */
  forPeriod(start: string, end: string): this {
    this._periodStart = start;
    this._periodEnd = end;
    return this;
  }

  /**
   * Adds a single employee ID to the filter (accumulates).
   */
  forEmployee(id: string): this {
    this._employeeIds.add(id);
    return this;
  }

  /**
   * Adds multiple employee IDs to the filter (accumulates).
   */
  forEmployees(ids: string[]): this {
    for (const id of ids) {
      this._employeeIds.add(id);
    }
    return this;
  }

  /**
   * Adds a single asset identifier to the filter (accumulates).
   */
  withAsset(asset: string): this {
    this._assets.add(asset);
    return this;
  }

  /**
   * Adds multiple asset identifiers to the filter (accumulates).
   */
  withAssets(assets: string[]): this {
    for (const asset of assets) {
      this._assets.add(asset);
    }
    return this;
  }

  /**
   * Sets the status constraint. Replaces any previously set value.
   * Only one settled status makes sense per query.
   */
  withStatus(status: "completed" | "failed"): this {
    this._status = status;
    return this;
  }

  /**
   * Sets the minimum amount bound (inclusive, in stroops).
   * Replaces any previously set value.
   * @throws {ValidationError} if `amount` is negative.
   */
  withMinAmount(amount: bigint): this {
    if (amount < 0n) {
      throw new ValidationError(`minAmount must be non-negative; received ${amount}`, "minAmount");
    }
    this._minAmount = amount;
    return this;
  }

  /**
   * Sets the maximum amount bound (inclusive, in stroops).
   * Replaces any previously set value.
   * @throws {ValidationError} if `minAmount` is already set and `amount < minAmount`.
   */
  withMaxAmount(amount: bigint): this {
    if (this._minAmount !== undefined && amount < this._minAmount) {
      throw new ValidationError(
        `maxAmount (${amount}) must be greater than or equal to minAmount (${this._minAmount})`,
        "maxAmount"
      );
    }
    this._maxAmount = amount;
    return this;
  }

  /**
   * Sets pagination options from `packages/core/src/pagination.ts::PaginationOptions`.
   * Replaces any previously set pagination options.
   */
  paginate(options: PaginationOptions): this {
    this._pagination = { ...options };
    return this;
  }

  /**
   * Resets all accumulated and set values, returning the builder to the
   * same state as a freshly constructed instance.
   */
  reset(): this {
    this._employeeIds = new Set();
    this._assets = new Set();
    this._periodStart = undefined;
    this._periodEnd = undefined;
    this._status = undefined;
    this._minAmount = undefined;
    this._maxAmount = undefined;
    this._pagination = undefined;
    return this;
  }

  /**
   * Builds and returns an immutable `ArchiveQuery` snapshot.
   * Subsequent mutations to this builder have no effect on the returned query.
   */
  build(): ArchiveQuery {
    // Manual deep copy — JSON.stringify cannot handle bigint
    const snapshot: ArchiveQuerySnapshot = {
      employeeIds: Array.from(this._employeeIds),
      assets: Array.from(this._assets),
      periodStart: this._periodStart,
      periodEnd: this._periodEnd,
      status: this._status,
      minAmount: this._minAmount,
      maxAmount: this._maxAmount,
      pageSize: this._pagination?.pageSize,
      cursor: this._pagination?.cursor,
    };

    return buildQuery(snapshot);
  }
}
