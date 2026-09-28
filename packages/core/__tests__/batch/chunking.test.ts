import { chunkPayoutBatches } from "../../src/batch/chunking";
import { BatchPaymentEntry } from "../../src/batch/BatchPayloadBuilder";

describe("chunkPayoutBatches", () => {
  it("chunks valid payout entries into batches according to safety limits", () => {
    const entries: BatchPaymentEntry[] = [
      { recipient: "A", amount: 100n, asset: "USDC" },
      { recipient: "B", amount: 200n, asset: "USDC" },
      { recipient: "C", amount: 300n, asset: "USDC" },
    ];

    const result = chunkPayoutBatches(entries, { maxBatchSize: 2 });
    
    expect(result.errors).toHaveLength(0);
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]).toEqual([
      { recipient: "A", amount: 100n, asset: "USDC" },
      { recipient: "B", amount: 200n, asset: "USDC" },
    ]);
    expect(result.chunks[1]).toEqual([
      { recipient: "C", amount: 300n, asset: "USDC" },
    ]);
  });

  it("returns privacy-safe errors without exposing sensitive values on validation failure", () => {
    const entries: BatchPaymentEntry[] = [
      { recipient: "", amount: 100n, asset: "USDC" }, // Invalid recipient
      { recipient: "B", amount: -200n, asset: "USDC" }, // Invalid amount
    ];

    const result = chunkPayoutBatches(entries, { maxBatchSize: 2 });

    expect(result.chunks).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].code).toBe("INVALID_RECIPIENT");
    // Assert no sensitive info is leaked in error message
    expect(result.errors[0].message).not.toContain("100");
    
    expect(result.errors[1].code).toBe("INVALID_AMOUNT");
    expect(result.errors[1].message).not.toContain("-200");
  });

  it("throws when maxBatchSize is invalid", () => {
    const entries: BatchPaymentEntry[] = [
      { recipient: "A", amount: 100n, asset: "USDC" }
    ];

    expect(() => chunkPayoutBatches(entries, { maxBatchSize: 0 })).toThrowError(
      "Invalid maxBatchSize: must be a positive integer."
    );
  });
  
  it("returns EMPTY_BATCH error if entries array is empty", () => {
    const result = chunkPayoutBatches([], { maxBatchSize: 2 });
    expect(result.chunks).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("EMPTY_BATCH");
  });
});
