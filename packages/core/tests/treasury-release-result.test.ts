import {
  summarizeTreasuryReleaseResults,
  TreasuryReleaseResultError,
} from "../src/receipts/treasuryReleaseResult";

describe("summarizeTreasuryReleaseResults", () => {
  it("reports complete and partial release outcomes", () => {
    expect(
      summarizeTreasuryReleaseResults([
        { releaseId: "release_12345678", succeeded: true },
        { releaseId: "release_87654321", succeeded: true },
      ])
    ).toMatchObject({ status: "complete", attemptedCount: 2, succeededCount: 2, failedCount: 0 });

    expect(
      summarizeTreasuryReleaseResults([
        { releaseId: "release_12345678", succeeded: true },
        { releaseId: "release_87654321", succeeded: false, errorCode: "RPC_TIMEOUT" },
      ])
    ).toEqual({
      status: "partial",
      attemptedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      failures: [{ releaseId: "rel***321", code: "RPC_TIMEOUT" }],
    });
  });

  it("reports total failure and does not expose exception text or unsafe codes", () => {
    const result = summarizeTreasuryReleaseResults([
      {
        releaseId: "release_12345678",
        succeeded: false,
        errorCode: "SALARY_5000",
      },
    ]);

    expect(result.status).toBe("failed");
    expect(result.failures[0].code).toBe("TREASURY_RELEASE_FAILED");
    expect(JSON.stringify(result)).not.toMatch(/SALARY|5000|release_12345678/);
  });

  it("treats no attempts as a boundary state and rejects malformed outcomes", () => {
    expect(summarizeTreasuryReleaseResults([])).toEqual({
      status: "not_attempted",
      attemptedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      failures: [],
    });

    expect(() =>
      summarizeTreasuryReleaseResults([{ releaseId: "", succeeded: false }])
    ).toThrow(TreasuryReleaseResultError);
  });
});