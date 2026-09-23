import { xdr, nativeToScVal } from "@stellar/stellar-sdk";
import {
  createEmptyLockTimestamp,
  createMockLockTimestamp,
  normalizeLockTimestamp,
  formatLockTimestamp,
} from "../src/payroll/lockTimestamp";

function symbolEntry(key: string, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val });
}

describe("createEmptyLockTimestamp", () => {
  it("creates an unlocked default with all fields defaulted", () => {
    const lock = createEmptyLockTimestamp("batch-1", "GTEST");

    expect(lock.batchId).toBe("batch-1");
    expect(lock.employer).toBe("GTEST");
    expect(lock.isLocked).toBe(false);
    expect(lock.lockedAt).toBe(0);
    expect(lock.lockedBy).toBeUndefined();
    expect(lock.unlockAt).toBeUndefined();
    expect(lock.fetchedAt).toBeDefined();
  });
});

describe("createMockLockTimestamp", () => {
  it("creates a mock locked timestamp with sensible defaults", () => {
    const lock = createMockLockTimestamp();
    expect(lock.isLocked).toBe(true);
    expect(lock.batchId).toBe("batch-2024-01");
    expect(lock.lockedBy).toBeDefined();
  });

  it("allows overriding defaults", () => {
    const lock = createMockLockTimestamp({ isLocked: false, batchId: "batch-99" });
    expect(lock.isLocked).toBe(false);
    expect(lock.batchId).toBe("batch-99");
  });
});

describe("normalizeLockTimestamp", () => {
  it("returns an empty (unlocked) default for a non-map response", () => {
    const lock = normalizeLockTimestamp(xdr.ScVal.scvVoid(), "batch-1", "GTEST");
    expect(lock.isLocked).toBe(false);
    expect(lock.batchId).toBe("batch-1");
    expect(lock.employer).toBe("GTEST");
  });

  it("normalizes a complete locked contract response", () => {
    const raw = xdr.ScVal.scvMap([
      symbolEntry("batch_id", nativeToScVal("batch-2024-03", { type: "string" })),
      symbolEntry("employer", nativeToScVal("GTESTEMPLOYER", { type: "string" })),
      symbolEntry("is_locked", nativeToScVal(true, { type: "bool" })),
      symbolEntry("locked_at", nativeToScVal("1700000000", { type: "u64" })),
      symbolEntry("locked_by", nativeToScVal("GLOCKER", { type: "string" })),
      symbolEntry("unlock_at", nativeToScVal("1700003600", { type: "u64" })),
    ]);

    const lock = normalizeLockTimestamp(raw, "fallback-batch", "fallback-employer");

    expect(lock.batchId).toBe("batch-2024-03");
    expect(lock.employer).toBe("GTESTEMPLOYER");
    expect(lock.isLocked).toBe(true);
    expect(lock.lockedAt).toBe(1700000000 * 1000);
    expect(lock.lockedBy).toBe("GLOCKER");
    expect(lock.unlockAt).toBe(1700003600 * 1000);
  });

  it("falls back to the provided batchId and employer when missing from the response", () => {
    const raw = xdr.ScVal.scvMap([
      symbolEntry("is_locked", nativeToScVal(false, { type: "bool" })),
    ]);
    const lock = normalizeLockTimestamp(raw, "fallback-batch", "fallback-employer");

    expect(lock.batchId).toBe("fallback-batch");
    expect(lock.employer).toBe("fallback-employer");
    expect(lock.isLocked).toBe(false);
    expect(lock.unlockAt).toBeUndefined();
  });
});

describe("formatLockTimestamp", () => {
  it("returns 'Not locked' when isLocked is false", () => {
    const lock = createEmptyLockTimestamp("batch-1", "GTEST");
    expect(formatLockTimestamp(lock)).toBe("Not locked");
  });

  it("formats a locked timestamp with the locking operator", () => {
    const lock = createMockLockTimestamp({
      isLocked: true,
      lockedAt: Date.UTC(2024, 0, 15, 10, 0, 0),
      lockedBy: "GOPERATOR",
    });

    expect(formatLockTimestamp(lock)).toBe("Locked since 2024-01-15T10:00:00.000Z by GOPERATOR");
  });

  it("omits the operator clause when lockedBy is not recorded", () => {
    const lock = createMockLockTimestamp({
      isLocked: true,
      lockedAt: Date.UTC(2024, 0, 15, 10, 0, 0),
      lockedBy: undefined,
    });

    expect(formatLockTimestamp(lock)).toBe("Locked since 2024-01-15T10:00:00.000Z");
  });
});
