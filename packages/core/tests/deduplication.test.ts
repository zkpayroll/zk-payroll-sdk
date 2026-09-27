import {
  detectDuplicates,
  validateDeduplicationInput,
  formatDeduplicationSummary,
} from "../src/batch/deduplication";
import { BatchPaymentEntry } from "../src/batch/BatchPayloadBuilder";

const entryA: BatchPaymentEntry = { recipient: "GA1", amount: 100n, asset: "native" };
const entryB: BatchPaymentEntry = { recipient: "GB2", amount: 200n, asset: "native" };
const entryC: BatchPaymentEntry = { recipient: "GC3", amount: 300n, asset: "usdc" };

describe("validateDeduplicationInput", () => {
  it("returns null for valid input", () => {
    const result = validateDeduplicationInput([entryA, entryB], ["recipient"]);
    expect(result).toBeNull();
  });

  it("returns error for empty entries array", () => {
    const result = validateDeduplicationInput([], ["recipient"]);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("EMPTY_ENTRIES");
    expect(result?.message).toContain("empty");
  });

  it("returns error for undefined entries", () => {
    const result = validateDeduplicationInput(undefined as any, ["recipient"]);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("EMPTY_ENTRIES");
  });

  it("returns error for empty keys array", () => {
    const result = validateDeduplicationInput([entryA], []);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("INVALID_KEY");
  });

  it("returns error for invalid deduplication key", () => {
    const result = validateDeduplicationInput([entryA], ["invalid_key" as any]);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("INVALID_KEY");
    expect(result?.field).toBe("invalid_key");
  });

  it("returns error for missing field in entry", () => {
    const incompleteEntry = { recipient: "GA1", amount: 100n } as BatchPaymentEntry;
    const result = validateDeduplicationInput([incompleteEntry], ["asset"]);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("MISSING_FIELD");
    expect(result?.field).toBe("asset");
  });
});

describe("detectDuplicates", () => {
  describe("validation", () => {
    it("throws error for empty entries array", () => {
      expect(() => detectDuplicates([])).toThrow("Deduplication validation failed");
    });

    it("throws error for invalid deduplication key", () => {
      expect(() => detectDuplicates([entryA], ["invalid_key" as any])).toThrow(
        "Deduplication validation failed"
      );
    });

    it("throws error for missing field", () => {
      const incompleteEntry = { recipient: "GA1", amount: 100n } as BatchPaymentEntry;
      expect(() => detectDuplicates([incompleteEntry], ["asset"])).toThrow(
        "Deduplication validation failed"
      );
    });
  });

  describe("no duplicates", () => {
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

describe("formatDeduplicationSummary", () => {
  it("returns message when no duplicates detected", () => {
    const result = detectDuplicates([entryA, entryB]);
    const summary = formatDeduplicationSummary(result);
    expect(summary).toBe("No duplicates detected in batch.");
  });

  it("redacts sensitive recipient addresses in summary", () => {
    const result = detectDuplicates([entryA, { ...entryA, amount: 999n }]);
    const summary = formatDeduplicationSummary(result);
    expect(summary).toContain("Duplicate recipient");
    expect(summary).toContain("GA1..."); // Redacted address
    expect(summary).not.toContain("GA1" + "1"); // Should not show full address
  });

  it("redacts sensitive amounts in summary", () => {
    const entries = [
      { recipient: "GA1", amount: 1000000n, asset: "native" },
      { recipient: "GB2", amount: 1000000n, asset: "usdc" },
    ];
    const result = detectDuplicates(entries, ["amount"]);
    const summary = formatDeduplicationSummary(result);
    expect(summary).toContain("Duplicate amount");
    expect(summary).toContain("[redacted amount]");
    expect(summary).not.toContain("1000000");
  });

  it("includes indices in summary for debugging", () => {
    const result = detectDuplicates([entryA, { ...entryA, amount: 50n }]);
    const summary = formatDeduplicationSummary(result);
    expect(summary).toContain("[0, 1]");
  });

  it("handles multiple duplicate groups in summary", () => {
    const entries = [entryA, entryB, { ...entryA, amount: 10n }, { ...entryB, amount: 20n }];
    const result = detectDuplicates(entries);
    const summary = formatDeduplicationSummary(result);
    expect(summary).toContain("Duplicates detected");
    expect(summary.split("\n").length).toBeGreaterThan(2); // Header + multiple duplicates
  });
});
