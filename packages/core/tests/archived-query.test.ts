/**
 * Tests for getArchivedPayrollPage and archiveIterator (Tasks 5.2–5.4, 7.2–7.3)
 * Requirements: 3.1–3.6, 4.1–4.4, 7.1, 7.5
 */
import { getArchivedPayrollPage, archiveIterator } from "../src/archived/query";
import { ArchiveFilterBuilder } from "../src/archived/ArchiveFilterBuilder";
import { applyArchiveQuery } from "../src/archived/internal";
import { ValidationError } from "../src/core/errors";
import type { ArchivedRecord } from "../src/archived/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 0;

function makeRecord(overrides: Partial<ArchivedRecord> = {}): ArchivedRecord {
  const id = `r${++_seq}`;
  return {
    id,
    recipient: `recipient-${id}`,
    amount: BigInt(Math.floor(Math.random() * 10000) + 100),
    timestamp: 1700000000 + _seq * 60,
    archivedAt: 1700000001 + _seq * 60,
    status: "completed",
    asset: "native",
    ...overrides,
  };
}

function emptyQuery() {
  return new ArchiveFilterBuilder().build();
}

// ---------------------------------------------------------------------------
// getArchivedPayrollPage — unit tests (Task 5.4)
// ---------------------------------------------------------------------------

describe("getArchivedPayrollPage", () => {
  describe("empty records", () => {
    it("returns empty data with total 0 and hasNextPage false", () => {
      const result = getArchivedPayrollPage([], emptyQuery());
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.hasNextPage).toBe(false);
    });
  });

  describe("meta.total reflects filtered count", () => {
    it("only counts records passing the query filter", () => {
      const records = [
        makeRecord({ status: "completed" }),
        makeRecord({ status: "completed" }),
        makeRecord({ status: "failed" }),
      ];
      const query = new ArchiveFilterBuilder().withStatus("completed").build();
      const result = getArchivedPayrollPage(records, query, { pageSize: 10 });
      expect(result.meta.total).toBe(2);
      expect(result.meta.total).not.toBe(records.length);
    });
  });

  describe("pageSize clamping", () => {
    it("clamps pageSize < 1 to 1 without throwing", () => {
      const records = [makeRecord(), makeRecord(), makeRecord()];
      expect(() => getArchivedPayrollPage(records, emptyQuery(), { pageSize: 0 })).not.toThrow();
      const result = getArchivedPayrollPage(records, emptyQuery(), { pageSize: 0 });
      expect(result.meta.pageSize).toBe(1);
    });

    it("clamps pageSize > 100 to 100 without throwing", () => {
      const records = Array.from({ length: 5 }, () => makeRecord());
      expect(() => getArchivedPayrollPage(records, emptyQuery(), { pageSize: 999 })).not.toThrow();
      const result = getArchivedPayrollPage(records, emptyQuery(), { pageSize: 999 });
      expect(result.meta.pageSize).toBe(100);
    });
  });

  describe("cursor handling", () => {
    it("malformed cursor falls back to first page without throwing", () => {
      const records = Array.from({ length: 5 }, () => makeRecord());
      expect(() =>
        getArchivedPayrollPage(records, emptyQuery(), { cursor: "!!!not-valid-base64!!!" })
      ).not.toThrow();
      const result = getArchivedPayrollPage(records, emptyQuery(), {
        cursor: "!!!not-valid-base64!!!",
        pageSize: 3,
      });
      expect(result.data[0].id).toBe(records[0].id);
    });

    it("valid nextCursor advances to the next page", () => {
      const records = Array.from({ length: 6 }, () => makeRecord());
      const page1 = getArchivedPayrollPage(records, emptyQuery(), { pageSize: 3 });
      expect(page1.meta.hasNextPage).toBe(true);

      const page2 = getArchivedPayrollPage(records, emptyQuery(), {
        pageSize: 3,
        cursor: page1.meta.nextCursor,
      });
      expect(page2.data[0].id).toBe(records[3].id);
    });
  });

  describe("ValidationError for inverted period", () => {
    it("throws when periodStart > periodEnd", () => {
      const query = new ArchiveFilterBuilder().forPeriod("2024-12-31", "2024-01-01").build();
      expect(() => getArchivedPayrollPage([], query)).toThrow(ValidationError);
    });

    it("thrown error has field 'periodStart'", () => {
      const query = new ArchiveFilterBuilder().forPeriod("2024-12-31", "2024-01-01").build();
      try {
        getArchivedPayrollPage([], query);
      } catch (e) {
        expect((e as ValidationError).field).toBe("periodStart");
      }
    });

    it("thrown error message contains periodStart and periodEnd", () => {
      const query = new ArchiveFilterBuilder().forPeriod("2024-12-31", "2024-01-01").build();
      try {
        getArchivedPayrollPage([], query);
      } catch (e) {
        expect((e as ValidationError).message).toContain("periodStart");
        expect((e as ValidationError).message).toContain("periodEnd");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Property: pagination completeness (Task 5.2)
// Requirement: 3.6
// ---------------------------------------------------------------------------

describe("getArchivedPayrollPage — pagination completeness property", () => {
  const SAMPLES = 30;

  it("iterating all pages yields every matching record exactly once in order", () => {
    for (let i = 0; i < SAMPLES; i++) {
      const count = Math.floor(Math.random() * 46) + 5; // 5–50
      const records = Array.from({ length: count }, () =>
        makeRecord({ status: Math.random() > 0.4 ? "completed" : "failed" })
      );

      const query = new ArchiveFilterBuilder()
        .withStatus(Math.random() > 0.5 ? "completed" : "failed")
        .build();

      const expected = applyArchiveQuery(records, query);
      const pageSize = Math.floor(Math.random() * 20) + 1;

      const collected: ArchivedRecord[] = [];
      let cursor: string | undefined;

      do {
        const page = getArchivedPayrollPage(records, query, { pageSize, cursor });
        collected.push(...page.data);
        cursor = page.meta.hasNextPage ? page.meta.nextCursor : undefined;
      } while (cursor !== undefined);

      expect(collected).toHaveLength(expected.length);
      expect(collected.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    }
  });
});

// ---------------------------------------------------------------------------
// Property: no duplication across pages (Task 5.3)
// Requirement: 3.6, 4.2
// ---------------------------------------------------------------------------

describe("getArchivedPayrollPage — no duplication property", () => {
  const SAMPLES = 30;

  it("no record id appears in more than one page", () => {
    for (let i = 0; i < SAMPLES; i++) {
      const count = Math.floor(Math.random() * 41) + 10;
      const records = Array.from({ length: count }, () => makeRecord());
      const pageSize = Math.floor(Math.random() * 10) + 2;

      const seenIds = new Set<string>();
      let cursor: string | undefined;

      do {
        const page = getArchivedPayrollPage(records, emptyQuery(), { pageSize, cursor });
        for (const record of page.data) {
          expect(seenIds.has(record.id)).toBe(false);
          seenIds.add(record.id);
        }
        cursor = page.meta.hasNextPage ? page.meta.nextCursor : undefined;
      } while (cursor !== undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// archiveIterator — unit tests (Task 7.3)
// ---------------------------------------------------------------------------

describe("archiveIterator", () => {
  it("yields exactly one empty page for empty input", async () => {
    const pages: ReturnType<typeof getArchivedPayrollPage>[] = [];
    for await (const page of archiveIterator([], emptyQuery())) {
      pages.push(page);
    }
    expect(pages).toHaveLength(1);
    expect(pages[0].data).toEqual([]);
    expect(pages[0].meta.total).toBe(0);
    expect(pages[0].meta.hasNextPage).toBe(false);
  });

  it("collects all records across pages", async () => {
    const records = Array.from({ length: 15 }, () => makeRecord());
    const collected: ArchivedRecord[] = [];

    for await (const page of archiveIterator(records, emptyQuery(), { pageSize: 5 })) {
      collected.push(...page.data);
    }

    expect(collected).toHaveLength(15);
    expect(collected.map((r) => r.id)).toEqual(records.map((r) => r.id));
  });

  it("clamps pageSize < 1 to 1 without throwing", async () => {
    const records = [makeRecord(), makeRecord()];
    const pages: number[] = [];
    for await (const page of archiveIterator(records, emptyQuery(), { pageSize: 0 })) {
      pages.push(page.meta.pageSize);
    }
    expect(pages.every((ps) => ps === 1)).toBe(true);
  });

  it("clamps pageSize > 100 to 100 without throwing", async () => {
    const records = Array.from({ length: 3 }, () => makeRecord());
    const pages: number[] = [];
    for await (const page of archiveIterator(records, emptyQuery(), { pageSize: 999 })) {
      pages.push(page.meta.pageSize);
    }
    expect(pages.every((ps) => ps === 100)).toBe(true);
  });

  it("no record appears in more than one page", async () => {
    const records = Array.from({ length: 12 }, () => makeRecord());
    const seenIds = new Set<string>();

    for await (const page of archiveIterator(records, emptyQuery(), { pageSize: 4 })) {
      for (const record of page.data) {
        expect(seenIds.has(record.id)).toBe(false);
        seenIds.add(record.id);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Property: streaming completeness and no duplication (Task 7.2)
// Requirement: 4.2
// ---------------------------------------------------------------------------

describe("archiveIterator — streaming completeness property", () => {
  const SAMPLES = 30;

  it("flattened pages equal applyArchiveQuery output — no duplication, no omission", async () => {
    for (let i = 0; i < SAMPLES; i++) {
      const count = Math.floor(Math.random() * 91) + 10; // 10–100
      const records = Array.from({ length: count }, () =>
        makeRecord({ status: Math.random() > 0.5 ? "completed" : "failed" })
      );

      const query = new ArchiveFilterBuilder()
        .withStatus(Math.random() > 0.5 ? "completed" : "failed")
        .build();

      const expected = applyArchiveQuery(records, query);
      const pageSize = Math.floor(Math.random() * 15) + 1;
      const collected: ArchivedRecord[] = [];

      for await (const page of archiveIterator(records, query, { pageSize })) {
        collected.push(...page.data);
      }

      expect(collected).toHaveLength(expected.length);
      expect(collected.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    }
  });
});
