/**
 * Pagination helpers tests (Issue #47)
 *
 * Covers: cursor encoding/decoding, offset-based paging, cursor-based paging,
 * filtering semantics, boundary conditions, empty results, and the async iterator.
 */

import {
  paginate,
  paginate as paginateRecords,
  encodeCursor,
  decodeCursor,
  resolvePageSize,
  filterPayrollRecords,
  filterAuditRecords,
  getPayrollHistoryPage,
  getAuditRecordsPage,
  paginateIterator,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  AuditRecord,
} from "../src/pagination";
import { PayrollRecord } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePayrollRecords(count: number): PayrollRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `rec-${i}`,
    recipient: i % 2 === 0 ? "GABC" : "GXYZ",
    amount: BigInt((i + 1) * 100),
    timestamp: 1_700_000_000 + i * 60,
  }));
}

function makeAuditRecords(count: number): AuditRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `audit-${i}`,
    action: i % 2 === 0 ? "payment" : "approval",
    actor: i % 3 === 0 ? "GADMIN" : "GUSER",
    timestamp: 1_700_000_000 + i * 60,
  }));
}

// ---------------------------------------------------------------------------
// resolvePageSize
// ---------------------------------------------------------------------------

describe("resolvePageSize", () => {
  it("returns DEFAULT_PAGE_SIZE when undefined", () => {
    expect(resolvePageSize()).toBe(DEFAULT_PAGE_SIZE);
  });

  it("clamps to MIN_PAGE_SIZE when below minimum", () => {
    expect(resolvePageSize(0)).toBe(MIN_PAGE_SIZE);
    expect(resolvePageSize(-5)).toBe(MIN_PAGE_SIZE);
  });

  it("clamps to MAX_PAGE_SIZE when above maximum", () => {
    expect(resolvePageSize(200)).toBe(MAX_PAGE_SIZE);
  });

  it("passes through a valid page size", () => {
    expect(resolvePageSize(25)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Cursor encoding / decoding
// ---------------------------------------------------------------------------

describe("cursor encoding and decoding", () => {
  it("encodes and decodes a round-trip correctly", () => {
    const payload = { index: 20, direction: "forward" as const };
    const cursor = encodeCursor(payload);
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it("returns null for a malformed cursor", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
  });

  it("returns null for a valid base64 string with wrong shape", () => {
    const bad = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64");
    expect(decodeCursor(bad)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(decodeCursor("")).toBeNull();
  });

  it("produces different cursors for different indices", () => {
    const a = encodeCursor({ index: 0, direction: "forward" });
    const b = encodeCursor({ index: 20, direction: "forward" });
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// paginate — offset-based
// ---------------------------------------------------------------------------

describe("paginate — offset-based", () => {
  const records = makePayrollRecords(55);

  it("returns the first page with default page size", () => {
    const result = paginate(records, {});
    expect(result.data).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(result.meta.page).toBe(1);
    expect(result.meta.hasNextPage).toBe(true);
    expect(result.meta.hasPrevPage).toBe(false);
  });

  it("returns the correct second page", () => {
    const result = paginate(records, { page: 2, pageSize: 20 });
    expect(result.data[0].id).toBe("rec-20");
    expect(result.meta.page).toBe(2);
    expect(result.meta.hasPrevPage).toBe(true);
  });

  it("returns a partial last page", () => {
    const result = paginate(records, { page: 3, pageSize: 20 });
    expect(result.data).toHaveLength(15); // 55 - 40
    expect(result.meta.hasNextPage).toBe(false);
  });

  it("returns correct total", () => {
    const result = paginate(records, { pageSize: 10 });
    expect(result.meta.total).toBe(55);
  });

  it("page beyond end returns empty data", () => {
    const result = paginate(records, { page: 100, pageSize: 20 });
    expect(result.data).toHaveLength(0);
    expect(result.meta.hasNextPage).toBe(false);
  });

  it("page 1 has no prevCursor", () => {
    const result = paginate(records, { page: 1, pageSize: 20 });
    expect(result.meta.prevCursor).toBeUndefined();
  });

  it("last page has no nextCursor", () => {
    const result = paginate(records, { page: 3, pageSize: 20 });
    expect(result.meta.nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// paginate — cursor-based
// ---------------------------------------------------------------------------

describe("paginate — cursor-based", () => {
  const records = makePayrollRecords(50);

  it("first page produces a nextCursor", () => {
    const page1 = paginate(records, { pageSize: 10 });
    expect(page1.meta.nextCursor).toBeDefined();
  });

  it("following nextCursor yields the next page", () => {
    const page1 = paginate(records, { pageSize: 10 });
    const page2 = paginate(records, {
      pageSize: 10,
      cursor: page1.meta.nextCursor,
    });
    expect(page2.data[0].id).toBe("rec-10");
    expect(page2.meta.page).toBe(2);
  });

  it("can traverse all pages using cursors", () => {
    let cursor: string | undefined;
    let pages = 0;
    let seen = 0;

    do {
      const result = paginate(records, { pageSize: 10, cursor });
      pages++;
      seen += result.data.length;
      cursor = result.meta.nextCursor;
    } while (cursor !== undefined);

    expect(pages).toBe(5);
    expect(seen).toBe(50);
  });

  it("last cursor-page has no nextCursor", () => {
    const page1 = paginate(records, { pageSize: 50 });
    expect(page1.meta.nextCursor).toBeUndefined();
  });

  it("invalid cursor falls back to first page", () => {
    const result = paginate(records, { cursor: "bad-cursor", pageSize: 10 });
    expect(result.data[0].id).toBe("rec-0");
  });
});

// ---------------------------------------------------------------------------
// paginate — empty dataset
// ---------------------------------------------------------------------------

describe("paginate — empty dataset", () => {
  it("returns empty data with correct meta", () => {
    const result = paginate([], { pageSize: 20 });
    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
    expect(result.meta.hasNextPage).toBe(false);
    expect(result.meta.hasPrevPage).toBe(false);
    expect(result.meta.nextCursor).toBeUndefined();
    expect(result.meta.prevCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// filterPayrollRecords
// -----------------------------------------------------------------------

describe("filterPayrollRecords", () => {
  const records = makePayrollRecords(20);

  it("filters by recipient", () => {
    const result = filterPayrollRecords(records, { recipient: "GABC" });
    expect(result.every((r) => r.recipient === "GABC")).toBe(true);
  });

  it("filters by minAmount", () => {
    const result = filterPayrollRecords(records, { minAmount: BigInt(1000) });
    expect(result.every((r) => r.amount >= BigInt(1000))).toBe(true);
  });

  it("filters by maxAmount", () => {
    const result = filterPayrollRecords(records, { maxAmount: BigInt(500) });
    expect(result.every((r) => r.amount <= BigInt(500))).toBe(true);
  });

  it("filters by timestamp range", () => {
    const from = 1_700_000_000 + 5 * 60;
    const to = 1_700_000_000 + 10 * 60;
    const result = filterPayrollRecords(records, {
      fromTimestamp: from,
      toTimestamp: to,
    });
    expect(result.every((r) => r.timestamp >= from && r.timestamp <= to)).toBe(true);
  });

  it("returns all records when filter is empty", () => {
    expect(filterPayrollRecords(records, {})).toHaveLength(records.length);
  });

  it("returns empty array when nothing matches", () => {
    const result = filterPayrollRecords(records, { recipient: "GNOBODY" });
    expect(result).toHaveLength(0);
  });

  it("combines multiple filters (AND semantics)", () => {
    const result = filterPayrollRecords(records, {
      recipient: "GABC",
      minAmount: BigInt(500),
    });
    expect(result.every((r) => r.recipient === "GABC" && r.amount >= BigInt(500))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterAuditRecords
// ---------------------------------------------------------------------------

describe("filterAuditRecords", () => {
  const records = makeAuditRecords(20);

  it("filters by action", () => {
    const result = filterAuditRecords(records, { action: "payment" });
    expect(result.every((r) => r.action === "payment")).toBe(true);
  });

  it("filters by actor", () => {
    const result = filterAuditRecords(records, { actor: "GADMIN" });
    expect(result.every((r) => r.actor === "GADMIN")).toBe(true);
  });

  it("filters by timestamp range", () => {
    const from = 1_700_000_000 + 3 * 60;
    const to = 1_700_000_000 + 8 * 60;
    const result = filterAuditRecords(records, {
      fromTimestamp: from,
      toTimestamp: to,
    });
    expect(result.every((r) => r.timestamp >= from && r.timestamp <= to)).toBe(true);
  });

  it("returns all when filter is empty", () => {
    expect(filterAuditRecords(records, {})).toHaveLength(records.length);
  });

  it("returns empty array when no records match", () => {
    expect(filterAuditRecords(records, { action: "delete" })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getPayrollHistoryPage
// ---------------------------------------------------------------------------

describe("getPayrollHistoryPage", () => {
  const records = makePayrollRecords(40);

  it("returns first page of filtered records", () => {
    const result = getPayrollHistoryPage(records, { recipient: "GABC" }, { pageSize: 5 });
    expect(result.data.every((r) => r.recipient === "GABC")).toBe(true);
    expect(result.data.length).toBeLessThanOrEqual(5);
  });

  it("handles empty filter", () => {
    const result = getPayrollHistoryPage(records, {}, { pageSize: 10 });
    expect(result.meta.total).toBe(40);
  });

  it("total reflects filtered count not full array", () => {
    const result = getPayrollHistoryPage(records, { recipient: "GABC" }, { pageSize: 100 });
    expect(result.meta.total).toBe(result.data.length);
  });
});

// ---------------------------------------------------------------------------
// getAuditRecordsPage
// ---------------------------------------------------------------------------

describe("getAuditRecordsPage", () => {
  const records = makeAuditRecords(30);

  it("returns paged audit records", () => {
    const result = getAuditRecordsPage(records, {}, { pageSize: 10 });
    expect(result.data).toHaveLength(10);
    expect(result.meta.total).toBe(30);
  });

  it("filters and paginates together", () => {
    const result = getAuditRecordsPage(records, { action: "payment" }, { pageSize: 5 });
    expect(result.data.every((r) => r.action === "payment")).toBe(true);
  });

  it("empty result when filter matches nothing", () => {
    const result = getAuditRecordsPage(records, { action: "unknown" }, {});
    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// paginateIterator
// ---------------------------------------------------------------------------

describe("paginateIterator", () => {
  it("iterates through all records across pages", async () => {
    const records = makePayrollRecords(35);
    const pages: number[] = [];
    let total = 0;

    for await (const page of paginateIterator(records, { pageSize: 10 })) {
      pages.push(page.data.length);
      total += page.data.length;
    }

    expect(total).toBe(35);
    expect(pages).toEqual([10, 10, 10, 5]);
  });

  it("yields a single page for small datasets", async () => {
    const records = makePayrollRecords(5);
    const collected: typeof records = [];

    for await (const page of paginateIterator(records, { pageSize: 20 })) {
      collected.push(...page.data);
    }

    expect(collected).toHaveLength(5);
  });

  it("yields nothing for empty input", async () => {
    const pages = [];
    for await (const page of paginateIterator([], { pageSize: 10 })) {
      pages.push(page);
    }
    // One page with 0 results (empty array still yields one result set)
    expect(pages[0].data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Paging boundary conditions
// ---------------------------------------------------------------------------

describe("paging boundary conditions", () => {
  it("single record dataset has no next or prev", () => {
    const result = paginate([{ id: "only" }], { pageSize: 10 });
    expect(result.meta.hasNextPage).toBe(false);
    expect(result.meta.hasPrevPage).toBe(false);
  });

  it("exact multiple of page size — last page has no nextCursor", () => {
    const records = makePayrollRecords(20);
    const result = paginate(records, { pageSize: 10, page: 2 });
    expect(result.meta.hasNextPage).toBe(false);
    expect(result.meta.nextCursor).toBeUndefined();
  });

  it("pageSize of 1 produces correct pagination", () => {
    const records = makePayrollRecords(3);
    const p1 = paginate(records, { pageSize: 1 });
    const p2 = paginate(records, { pageSize: 1, cursor: p1.meta.nextCursor });
    const p3 = paginate(records, { pageSize: 1, cursor: p2.meta.nextCursor });
    expect(p1.data[0].id).toBe("rec-0");
    expect(p2.data[0].id).toBe("rec-1");
    expect(p3.data[0].id).toBe("rec-2");
    expect(p3.meta.hasNextPage).toBe(false);
  });

  it("MAX_PAGE_SIZE clamps oversized request", () => {
    const records = makePayrollRecords(200);
    const result = paginate(records, { pageSize: 9999 });
    expect(result.data).toHaveLength(MAX_PAGE_SIZE);
  });
});
