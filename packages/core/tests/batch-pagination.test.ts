/**
 * Batch pagination helper tests (Issue #102)
 *
 * Covers: page retrieval semantics, boundary conditions, empty collections,
 * ordering preservation, no duplicate/skipped records, invalid parameter
 * rejection, and integration with employee and payroll-recipient batches.
 */

import {
  getBatchPage,
  iterateBatches,
  assertValidPageSize,
  BatchPaymentEntry,
  EmployeeRecord,
} from "../src/batch";
import { ValidationError } from "../src/errors";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import { PayrollService } from "../src/payroll";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
import { IProofGenerator, ProofPayload } from "../src/crypto/IProofGenerator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItems(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `item-${i}`);
}

function makeEmployees(count: number): EmployeeRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    employeeId: `EMP-${String(i).padStart(3, "0")}`,
    recipient: `GTESTEMPLOYEE${String(i).padStart(50, "0")}`,
    salary: BigInt((i + 1) * 1000),
    asset: "native",
    name: `Employee ${i}`,
  }));
}

function makeRecipients(count: number): BatchPaymentEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    recipient: `GTESTRECIPIENT${String(i).padStart(52, "0")}`,
    amount: BigInt((i + 1) * 500),
    asset: i % 2 === 0 ? "native" : "CUSDC000000000000000000000000000000000000000000",
  }));
}

const MOCK_PROOF: ProofPayload = {
  proof: {
    pi_a: ["1", "2"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
    ],
    pi_c: ["7", "8"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["123", "456"],
};

// ---------------------------------------------------------------------------
// getBatchPage — success cases
// ---------------------------------------------------------------------------

describe("getBatchPage — success cases", () => {
  it("returns the first page", () => {
    const items = makeItems(10);
    const page = getBatchPage(items, 4, 0);

    expect(page.items).toEqual(["item-0", "item-1", "item-2", "item-3"]);
    expect(page.index).toBe(0);
    expect(page.offset).toBe(0);
    expect(page.count).toBe(4);
    expect(page.totalItems).toBe(10);
    expect(page.totalPages).toBe(3);
    expect(page.hasNext).toBe(true);
  });

  it("returns a middle page", () => {
    const items = makeItems(10);
    const page = getBatchPage(items, 4, 1);

    expect(page.items).toEqual(["item-4", "item-5", "item-6", "item-7"]);
    expect(page.index).toBe(1);
    expect(page.offset).toBe(4);
    expect(page.hasNext).toBe(true);
  });

  it("returns a partial final page", () => {
    const items = makeItems(10);
    const page = getBatchPage(items, 4, 2);

    expect(page.items).toEqual(["item-8", "item-9"]);
    expect(page.index).toBe(2);
    expect(page.offset).toBe(8);
    expect(page.count).toBe(2);
    expect(page.hasNext).toBe(false);
  });

  it("collection smaller than page size returns all items with no next page", () => {
    const items = makeItems(10);
    const page = getBatchPage(items, 100);

    expect(page.items).toEqual(items);
    expect(page.count).toBe(10);
    expect(page.totalPages).toBe(1);
    expect(page.hasNext).toBe(false);
  });

  it("collection exactly equal to page size returns all items with no next page", () => {
    const items = makeItems(100);
    const page = getBatchPage(items, 100);

    expect(page.items).toHaveLength(100);
    expect(page.totalPages).toBe(1);
    expect(page.hasNext).toBe(false);
  });

  it("collection one larger than page size splits into full page plus single-item page", () => {
    const items = makeItems(101);
    const first = getBatchPage(items, 100, 0);
    const second = getBatchPage(items, 100, 1);

    expect(first.items).toHaveLength(100);
    expect(first.hasNext).toBe(true);
    expect(second.items).toEqual(["item-100"]);
    expect(second.count).toBe(1);
    expect(second.hasNext).toBe(false);
  });

  it("empty collection yields an empty batch with no next page", () => {
    const page = getBatchPage([], 10);

    expect(page.items).toEqual([]);
    expect(page.count).toBe(0);
    expect(page.totalItems).toBe(0);
    expect(page.totalPages).toBe(1);
    expect(page.hasNext).toBe(false);
  });

  it("one-item collection yields a single batch", () => {
    const page = getBatchPage(["only"], 10);

    expect(page.items).toEqual(["only"]);
    expect(page.hasNext).toBe(false);
  });

  it("very large page size returns everything in one batch", () => {
    const items = makeItems(50);
    const page = getBatchPage(items, Number.MAX_SAFE_INTEGER);

    expect(page.items).toEqual(items);
    expect(page.hasNext).toBe(false);
  });

  it("omitting pageSize treats the whole collection as a single batch", () => {
    const items = makeItems(7);
    const page = getBatchPage(items);

    expect(page.items).toEqual(items);
    expect(page.totalPages).toBe(1);
    expect(page.hasNext).toBe(false);
  });

  it("batch index beyond the last page returns an empty batch without throwing", () => {
    const items = makeItems(5);
    const page = getBatchPage(items, 2, 99);

    expect(page.items).toEqual([]);
    expect(page.count).toBe(0);
    expect(page.hasNext).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ordering and completeness guarantees
// ---------------------------------------------------------------------------

describe("getBatchPage — ordering and completeness", () => {
  it("preserves original ordering across batches", () => {
    const items = ["A", "B", "C", "D", "E"];

    expect(getBatchPage(items, 2, 0).items).toEqual(["A", "B"]);
    expect(getBatchPage(items, 2, 1).items).toEqual(["C", "D"]);
    expect(getBatchPage(items, 2, 2).items).toEqual(["E"]);
  });

  it.each([1, 2, 3, 5, 7, 10])(
    "concatenating all pages (pageSize=%i) reconstructs the original collection exactly once",
    (pageSize) => {
      const items = makeItems(23);
      const totalPages = Math.ceil(items.length / pageSize);

      const reconstructed: string[] = [];
      for (let index = 0; index < totalPages; index++) {
        reconstructed.push(...getBatchPage(items, pageSize, index).items);
      }

      expect(reconstructed).toEqual(items);
      expect(reconstructed).toHaveLength(items.length);
      expect(new Set(reconstructed).size).toBe(items.length);
    }
  );

  it("does not mutate or copy-modify the underlying records", () => {
    const items = makeItems(6);
    const snapshot = [...items];

    getBatchPage(items, 2, 1);

    expect(items).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Invalid parameters
// ---------------------------------------------------------------------------

describe("getBatchPage — invalid parameters", () => {
  const items = makeItems(5);

  function expectPageSizeError(fn: () => unknown): void {
    try {
      fn();
      fail("expected ValidationError to be thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.message).toBe("Invalid page size: expected a positive integer.");
      expect(err.field).toBe("pageSize");
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  }

  it("rejects a page size of 0", () => {
    expectPageSizeError(() => getBatchPage(items, 0));
  });

  it("rejects a negative page size", () => {
    expectPageSizeError(() => getBatchPage(items, -5));
  });

  it("rejects NaN as a page size", () => {
    expectPageSizeError(() => getBatchPage(items, NaN));
  });

  it("rejects Infinity as a page size", () => {
    expectPageSizeError(() => getBatchPage(items, Infinity));
  });

  it("rejects -Infinity as a page size", () => {
    expectPageSizeError(() => getBatchPage(items, -Infinity));
  });

  it("rejects a non-integer page size", () => {
    expectPageSizeError(() => getBatchPage(items, 2.5));
  });

  it("assertValidPageSize accepts undefined (pagination not opted into)", () => {
    expect(() => assertValidPageSize(undefined)).not.toThrow();
  });

  it("rejects a negative batch index", () => {
    try {
      getBatchPage(items, 2, -1);
      fail("expected ValidationError to be thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.message).toBe("Invalid batch index: expected a non-negative integer.");
      expect(err.field).toBe("batchIndex");
    }
  });
});

// ---------------------------------------------------------------------------
// iterateBatches
// ---------------------------------------------------------------------------

describe("iterateBatches", () => {
  it("yields every batch in order with correct metadata", () => {
    const items = makeItems(10);
    const pages = [...iterateBatches(items, 4)];

    expect(pages.map((p) => p.items)).toEqual([
      ["item-0", "item-1", "item-2", "item-3"],
      ["item-4", "item-5", "item-6", "item-7"],
      ["item-8", "item-9"],
    ]);
    expect(pages.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(pages.map((p) => p.hasNext)).toEqual([true, true, false]);
  });

  it("yields nothing but a single empty batch for an empty collection", () => {
    const pages = [...iterateBatches([], 10)];

    expect(pages).toHaveLength(1);
    expect(pages[0].items).toEqual([]);
    expect(pages[0].hasNext).toBe(false);
  });

  it("yields a single batch when pageSize is omitted", () => {
    const items = makeItems(9);
    const pages = [...iterateBatches(items)];

    expect(pages).toHaveLength(1);
    expect(pages[0].items).toEqual(items);
  });

  it("concatenating yielded batches reconstructs the original collection", () => {
    const items = makeItems(37);
    const reconstructed: string[] = [];

    for (const batch of iterateBatches(items, 6)) {
      reconstructed.push(...batch.items);
    }

    expect(reconstructed).toEqual(items);
  });

  it("rejects an invalid page size before yielding any batch", () => {
    expect(() => [...iterateBatches(makeItems(5), 0)]).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Employee batch integration
// ---------------------------------------------------------------------------

describe("employee batch pagination integration", () => {
  it("divides employees into the expected batches preserving order", () => {
    const employees = makeEmployees(7);
    const pages = [...iterateBatches(employees, 3)];

    expect(pages.map((p) => p.count)).toEqual([3, 3, 1]);
    expect(pages[0].items.map((e) => e.employeeId)).toEqual(["EMP-000", "EMP-001", "EMP-002"]);
    expect(pages[1].items.map((e) => e.employeeId)).toEqual(["EMP-003", "EMP-004", "EMP-005"]);
    expect(pages[2].items.map((e) => e.employeeId)).toEqual(["EMP-006"]);
  });

  it("skips no employee and duplicates no employee across batches", () => {
    const employees = makeEmployees(25);
    const seen: string[] = [];

    for (const batch of iterateBatches(employees, 4)) {
      for (const employee of batch.items) {
        seen.push(employee.employeeId);
      }
    }

    expect(seen).toEqual(employees.map((e) => e.employeeId));
    expect(new Set(seen).size).toBe(employees.length);
  });

  it("does not modify employee records while paginating", () => {
    const employees = makeEmployees(6);
    const snapshot = employees.map((e) => ({ ...e }));

    for (const batch of iterateBatches(employees, 2)) {
      expect(batch.items.length).toBeGreaterThan(0);
    }

    expect(employees).toEqual(snapshot);
  });

  it("handles an empty employee roster safely", () => {
    const pages = [...iterateBatches(makeEmployees(0), 5)];

    expect(pages[0].items).toEqual([]);
    expect(pages[0].hasNext).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Payroll recipient batch integration
// ---------------------------------------------------------------------------

describe("payroll recipient batch pagination integration", () => {
  it("divides recipients into the expected batches preserving order", () => {
    const recipients = makeRecipients(5);
    const pages = [...iterateBatches(recipients, 2)];

    expect(pages.map((p) => p.count)).toEqual([2, 2, 1]);
    expect(pages.flatMap((p) => p.items.map((r) => r.recipient))).toEqual(
      recipients.map((r) => r.recipient)
    );
  });

  it("includes every recipient exactly once across batches", () => {
    const recipients = makeRecipients(11);
    const seen: string[] = [];

    for (const batch of iterateBatches(recipients, 3)) {
      for (const recipient of batch.items) {
        seen.push(recipient.recipient);
      }
    }

    expect(seen).toEqual(recipients.map((r) => r.recipient));
    expect(new Set(seen).size).toBe(recipients.length);
  });

  it("does not modify recipient payloads or amounts", () => {
    const recipients = makeRecipients(8);
    const snapshot = recipients.map((r) => ({ ...r }));

    for (const batch of iterateBatches(recipients, 3)) {
      for (const entry of batch.items) {
        expect(typeof entry.amount).toBe("bigint");
      }
    }

    expect(recipients).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// PayrollService.processBatchPayments paged processing
// ---------------------------------------------------------------------------

describe("PayrollService.processBatchPayments with batchSize", () => {
  function createService(): {
    service: PayrollService;
    mockWrapper: PayrollContractWrapper;
    mockProofGen: IProofGenerator;
  } {
    const mockWrapper = {
      privatePay: jest.fn().mockResolvedValue(xdr.ScVal.scvVoid()),
    } as unknown as PayrollContractWrapper;

    const mockProofGen: IProofGenerator = {
      generateProof: jest.fn().mockResolvedValue(MOCK_PROOF),
    };

    const service = new PayrollService(mockWrapper, mockProofGen, Keypair.random());
    return { service, mockWrapper, mockProofGen };
  }

  function makeEntries(count: number): BatchPaymentEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      recipient: `GSERVICEENTRY${String(i).padStart(51, "0")}`,
      amount: BigInt((i + 1) * 100),
      asset: "native",
    }));
  }

  it("processes all entries in original order when paginated", async () => {
    const { service, mockWrapper } = createService();
    const entries = makeEntries(7);

    const results = await service.processBatchPayments(entries, 3);

    expect(results).toHaveLength(7);
    const calls = (mockWrapper.privatePay as jest.Mock).mock.calls;
    expect(calls.map(([recipient]) => recipient)).toEqual(entries.map((e) => e.recipient));
  });

  it("produces the same results with pagination as without", async () => {
    const unpaged = createService();
    const paged = createService();
    const entries = makeEntries(9);

    const expected = await unpaged.service.processBatchPayments(entries);
    const actual = await paged.service.processBatchPayments(entries, 4);

    expect(actual).toEqual(expected);
  });

  it("propagates an invalid batchSize as a clear validation error", async () => {
    const { service } = createService();

    await expect(service.processBatchPayments(makeEntries(3), 0)).rejects.toMatchObject({
      message: "Invalid page size: expected a positive integer.",
      field: "pageSize",
    });
  });

  it("still rejects invalid payloads before any pagination occurs", async () => {
    const { service, mockWrapper } = createService();

    await expect(service.processBatchPayments([], 2)).rejects.toThrow();
    expect(mockWrapper.privatePay).not.toHaveBeenCalled();
  });
});
