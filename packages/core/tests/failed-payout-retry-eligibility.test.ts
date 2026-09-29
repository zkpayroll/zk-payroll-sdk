import { evaluateFailedPayoutRetryEligibility } from "../src/payroll/retryEligibility";

const retryableFailure = {
  status: "failed",
  failureCategory: "retryable",
  attemptCount: 1,
  maxAttempts: 3,
  idempotencyKey: "payout-key",
};

describe("evaluateFailedPayoutRetryEligibility", () => {
  it("allows a retryable failed payout when attempts and idempotency are safe", () => {
    expect(evaluateFailedPayoutRetryEligibility(retryableFailure)).toMatchObject({
      isEligible: true,
      code: "ELIGIBLE",
    });
  });

  it.each([
    [{ ...retryableFailure, status: "pending" }, "PAYOUT_PENDING"],
    [{ ...retryableFailure, status: "confirmed" }, "PAYOUT_ALREADY_CONFIRMED"],
    [{ ...retryableFailure, failureCategory: "terminal" }, "FAILURE_NOT_RETRYABLE"],
    [{ ...retryableFailure, attemptCount: 3 }, "RETRY_LIMIT_REACHED"],
    [{ ...retryableFailure, idempotencyKey: "" }, "MISSING_IDEMPOTENCY_KEY"],
  ])("blocks unsafe retries with a stable reason", (input, code) => {
    expect(evaluateFailedPayoutRetryEligibility(input)).toMatchObject({
      isEligible: false,
      code,
    });
  });

  it("does not echo sensitive or untrusted input in blocked results", () => {
    const result = evaluateFailedPayoutRetryEligibility({
      ...retryableFailure,
      status: "Jane Doe $5000",
      idempotencyKey: "private-payout-key",
    });

    expect(JSON.stringify(result)).not.toContain("Jane Doe");
    expect(JSON.stringify(result)).not.toContain("5000");
    expect(JSON.stringify(result)).not.toContain("private-payout-key");
  });
});
