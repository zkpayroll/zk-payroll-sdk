import {
  collectPayrollPeriods,
  collectPayrollPeriodsAcrossRetentionMigrations,
  iteratePayrollPeriods,
} from "../src/payroll/periodPagination";

describe("payroll period pagination", () => {
  it("reads all retention sources and prefers the newest migrated record", async () => {
    const newest = async (): Promise<{
      items: { periodId: string; schema: string }[];
    }> => ({
      items: [
        { periodId: "2026-02", schema: "current" },
        { periodId: "2026-01", schema: "current" },
      ],
    });
    const older = async (): Promise<{
      items: { periodId: string; schema: string }[];
    }> => ({
      items: [
        { periodId: "2026-01", schema: "legacy" },
        { periodId: "2025-12", schema: "legacy" },
      ],
    });

    await expect(collectPayrollPeriodsAcrossRetentionMigrations([newest, older])).resolves.toEqual([
      { periodId: "2026-02", schema: "current" },
      { periodId: "2026-01", schema: "current" },
      { periodId: "2025-12", schema: "legacy" },
    ]);
  });

  it("fails safely when an older retention source cannot be paged completely", async () => {
    const newest = async (): Promise<{ items: { periodId: string }[] }> => ({
      items: [{ periodId: "2026-02" }],
    });
    const brokenOlder = async (): Promise<{ items: never[]; nextCursor: string }> => ({
      items: [],
      nextCursor: "same",
    });
    await expect(
      collectPayrollPeriodsAcrossRetentionMigrations([newest, brokenOlder])
    ).rejects.toThrow("repeated cursor");
  });

  it("collects ordered records from cursor pages", async () => {
    const fetchPage = jest.fn(async ({ cursor }: { cursor?: string }) =>
      cursor
        ? { items: [{ periodId: "2026-02" }] }
        : { items: [{ periodId: "2026-01" }], nextCursor: "page-2" }
    );
    await expect(collectPayrollPeriods(fetchPage, { pageSize: 25 })).resolves.toEqual([
      { periodId: "2026-01" },
      { periodId: "2026-02" },
    ]);
    expect(fetchPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "page-2", limit: 25 })
    );
  });

  it("stops a malformed source that repeats its cursor", async () => {
    const fetchPage = async (): Promise<{ items: never[]; nextCursor: string }> => ({
      items: [],
      nextCursor: "same",
    });
    const consume = async (): Promise<void> => {
      for await (const _period of iteratePayrollPeriods(fetchPage)) {
        /* consume */
      }
    };
    await expect(consume()).rejects.toThrow("repeated cursor");
  });

  it("rejects malformed pages with an actionable, privacy-safe error", async () => {
    const fetchPage = async (): Promise<never> => ({ items: null }) as never;
    await expect(collectPayrollPeriods(fetchPage)).rejects.toThrow(
      "Payroll period fetcher returned an invalid page."
    );
  });

  it("does not yield a fetched page after cancellation", async () => {
    const controller = new AbortController();
    const fetchPage = async (): Promise<{ items: { periodId: string }[] }> => {
      controller.abort();
      return { items: [{ periodId: "private-period" }] };
    };
    await expect(
      collectPayrollPeriods(fetchPage, { signal: controller.signal })
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
