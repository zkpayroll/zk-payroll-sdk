import {
  assertTreasuryReleaseComplete,
  isPartialTreasuryRelease,
  isTreasuryReleaseIncompleteError,
  summarizeTreasuryReleaseResults,
  TreasuryReleaseIncompleteError,
  TREASURY_RELEASE_INCOMPLETE,
  TreasuryReleaseResultError,
} from "../src/receipts/treasuryReleaseResult";

describe("typed handling of partial treasury releases", () => {
  it("passes complete and not_attempted summaries through unchanged", () => {
    const complete = summarizeTreasuryReleaseResults([
      { releaseId: "release_12345678", succeeded: true },
    ]);
    const notAttempted = summarizeTreasuryReleaseResults([]);

    expect(assertTreasuryReleaseComplete(complete)).toBe(complete);
    expect(assertTreasuryReleaseComplete(notAttempted)).toBe(notAttempted);
  });

  it("throws a typed, privacy-safe error for a partial release", () => {
    const result = summarizeTreasuryReleaseResults([
      { releaseId: "release_12345678", succeeded: true },
      { releaseId: "release_87654321", succeeded: false, errorCode: "RPC_TIMEOUT" },
      { releaseId: "release_11112222", succeeded: false, errorCode: "RPC_TIMEOUT" },
    ]);

    expect(isPartialTreasuryRelease(result)).toBe(true);

    let caught: unknown;
    try {
      assertTreasuryReleaseComplete(result);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TreasuryReleaseIncompleteError);
    expect(isTreasuryReleaseIncompleteError(caught)).toBe(true);

    const err = caught as TreasuryReleaseIncompleteError;
    expect(err.code).toBe(TREASURY_RELEASE_INCOMPLETE);
    expect(err.status).toBe("partial");
    expect(err.attemptedCount).toBe(3);
    expect(err.succeededCount).toBe(1);
    expect(err.failedCount).toBe(2);
    expect(err.failureCodes).toEqual(["RPC_TIMEOUT"]);
    expect(Object.isFrozen(err.failureCodes)).toBe(true);
    expect(err.message).toContain("1 of 3");
  });

  it("does not expose release IDs, raw error text, or amounts in the error", () => {
    const result = summarizeTreasuryReleaseResults([
      { releaseId: "release_12345678", succeeded: true },
      { releaseId: "release_87654321", succeeded: false, errorCode: "SALARY_5000" },
    ]);

    let caught: unknown;
    try {
      assertTreasuryReleaseComplete(result);
    } catch (err) {
      caught = err;
    }

    const err = caught as TreasuryReleaseIncompleteError;
    expect(err.failureCodes).toEqual(["TREASURY_RELEASE_FAILED"]);
    expect(JSON.stringify({ message: err.message, failureCodes: err.failureCodes })).not.toMatch(
      /SALARY|5000|release_/
    );
  });

  it("throws for a failed release where no attempt succeeded", () => {
    const result = summarizeTreasuryReleaseResults([
      { releaseId: "release_12345678", succeeded: false, errorCode: "CONTRACT_REVERT" },
    ]);

    expect(isPartialTreasuryRelease(result)).toBe(false);
    expect(() => assertTreasuryReleaseComplete(result)).toThrow(TreasuryReleaseIncompleteError);
    expect(() => assertTreasuryReleaseComplete(result)).toThrow(/none of 1 releases/);
  });

  it("rejects values that are not treasury release summaries", () => {
    expect(() => assertTreasuryReleaseComplete(null as never)).toThrow(TreasuryReleaseResultError);
    expect(() => assertTreasuryReleaseComplete({ status: "unknown" } as never)).toThrow(
      TreasuryReleaseResultError
    );
  });
});
