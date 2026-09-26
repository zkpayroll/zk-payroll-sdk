export interface PayrollPeriodRecord {
  periodId: string;
  [key: string]: unknown;
}
export interface PayrollPeriodPage<T extends PayrollPeriodRecord> {
  items: readonly T[];
  nextCursor?: string;
}
export interface PayrollPeriodPageRequest {
  cursor?: string;
  limit: number;
  signal?: AbortSignal;
}
export interface PayrollPeriodPaginationOptions {
  pageSize?: number;
  maxPages?: number;
  cursor?: string;
  signal?: AbortSignal;
}
export type PayrollPeriodPageFetcher<T extends PayrollPeriodRecord> = (
  request: PayrollPeriodPageRequest
) => Promise<PayrollPeriodPage<T>>;

function resolveOptions(options: PayrollPeriodPaginationOptions): {
  pageSize: number;
  maxPages: number;
} {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new RangeError("Payroll period pageSize must be an integer between 1 and 100.");
  if (!Number.isInteger(maxPages) || maxPages < 1)
    throw new RangeError("Payroll period maxPages must be a positive integer.");
  return { pageSize, maxPages };
}

/** Iterates cursor pages with cancellation and repeated-cursor protection. */
export async function* iteratePayrollPeriods<T extends PayrollPeriodRecord>(
  fetchPage: PayrollPeriodPageFetcher<T>,
  options: PayrollPeriodPaginationOptions = {}
): AsyncGenerator<T, void, undefined> {
  const { pageSize, maxPages } = resolveOptions(options);
  const seen = new Set<string>();
  let cursor = options.cursor;
  for (let page = 0; page < maxPages; page++) {
    if (options.signal?.aborted) throw new DOMException("Pagination aborted", "AbortError");
    const result = await fetchPage({ cursor, limit: pageSize, signal: options.signal });
    for (const period of result.items) yield period;
    if (!result.nextCursor) return;
    if (result.nextCursor === cursor || seen.has(result.nextCursor))
      throw new Error("Payroll period pagination returned a repeated cursor.");
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error("Payroll period pagination exceeded the configured page limit.");
}

export async function collectPayrollPeriods<T extends PayrollPeriodRecord>(
  fetchPage: PayrollPeriodPageFetcher<T>,
  options: PayrollPeriodPaginationOptions = {}
): Promise<T[]> {
  const periods: T[] = [];
  for await (const period of iteratePayrollPeriods(fetchPage, options)) periods.push(period);
  return periods;
}
