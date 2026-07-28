import { detectDuplicates } from "../src/batch/deduplication";
import { BatchPaymentEntry } from "../src/batch/BatchPayloadBuilder";

const entryA: BatchPaymentEntry = { recipient: "GA1", amount: 100n, asset: "native" };
const entryB: BatchPaymentEntry = { recipient: "GB2", amount: 200n, asset: "native" };
const entryC: BatchPaymentEntry = { recipient: "GC3", amount: 300n, asset: "usdc" };

describe("detectDuplicates", () => {
  describe("no duplicates", () => {
    it("returns no duplicates for an empty batch", () => {
      const result = detectDuplicates([]);
      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicates).toHaveLength(0);
    });

    it("returns no duplicates for a single entry", () => {
      const result = detectDuplicates([entryA]);
      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicates).toHaveLength(0);
    });

    it("returns no duplicates when all recipients are unique", () => {
      const result = detectDuplicates([entryA, entryB, entryC]);
      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicates).toHaveLength(0);
    });
  });

  describe("duplicate detection by recipient (default key)", () => {
    it("detects a duplicate recipient", () => {
      const result = detectDuplicates([entryA, { ...entryA, amount: 999n }]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].key).toBe("recipient");
      expect(result.duplicates[0].value).toBe("GA1");
      expect(result.duplicates[0].indices).toEqual([0, 1]);
    });

    it("reports all indices when a recipient appears three times", () => {
      const entries = [entryA, { ...entryA, amount: 50n }, { ...entryA, amount: 75n }];
      const result = detectDuplicates(entries);
      expect(result.duplicates[0].indices).toEqual([0, 1, 2]);
    });

    it("detects multiple distinct duplicate recipients", () => {
      const entries = [entryA, entryB, { ...entryA, amount: 10n }, { ...entryB, amount: 20n }];
      const result = detectDuplicates(entries);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicates).toHaveLength(2);
    });
  });

  describe("configurable keys", () => {
    it("detects duplicates by asset", () => {
      const result = detectDuplicates([entryA, entryB, entryC], ["asset"]);
      expect(result.hasDuplicates).toBe(true);
      const dup = result.duplicates[0];
      expect(dup.key).toBe("asset");
      expect(dup.value).toBe("native");
      expect(dup.indices).toEqual([0, 1]);
    });

    it("detects duplicates by amount", () => {
      const entries = [
        { recipient: "GA1", amount: 100n, asset: "native" },
        { recipient: "GB2", amount: 100n, asset: "usdc" },
      ];
      const result = detectDuplicates(entries, ["amount"]);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicates[0].key).toBe("amount");
      expect(result.duplicates[0].value).toBe(100n);
    });

    it("checks multiple keys independently", () => {
      const entries = [
        { recipient: "GA1", amount: 100n, asset: "native" },
        { recipient: "GA1", amount: 100n, asset: "usdc" },
      ];
      const result = detectDuplicates(entries, ["recipient", "amount"]);
      expect(result.duplicates).toHaveLength(2);
      const keys = result.duplicates.map((d) => d.key);
      expect(keys).toContain("recipient");
      expect(keys).toContain("amount");
    });

    it("returns no duplicates when key values are all unique", () => {
      const entries = [
        { recipient: "GA1", amount: 100n, asset: "native" },
        { recipient: "GB2", amount: 200n, asset: "usdc" },
        { recipient: "GC3", amount: 300n, asset: "eurc" },
      ];
      const result = detectDuplicates(entries, ["recipient", "asset"]);
      expect(result.hasDuplicates).toBe(false);
    });
  });

  describe("result shape", () => {
    it("duplicate group contains key, value, and indices", () => {
      const result = detectDuplicates([entryA, { ...entryA, amount: 50n }]);
      const dup = result.duplicates[0];
      expect(dup).toHaveProperty("key");
      expect(dup).toHaveProperty("value");
      expect(dup).toHaveProperty("indices");
    });

    it("does not mutate the input entries", () => {
      const entries = [entryA, { ...entryA, amount: 50n }];
      const copy = entries.map((e) => ({ ...e }));
      detectDuplicates(entries);
      expect(entries).toEqual(copy);
    });
  });
});
