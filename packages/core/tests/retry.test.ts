import { classifyError, RetryCategory, RetryDecision } from "../src/core/retry";
import {
  ZkPayrollError,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  ValidationError,
  ContractErrorCode,
} from "../src/core/errors";
import { BatchValidationFailedError } from "../src/batch/BatchPayloadBuilder";

function expectRetryable(decision: RetryDecision): void {
  expect(decision.retryable).toBe(true);
  expect(decision.category).toBe(RetryCategory.RETRYABLE);
}

function expectNonRetryable(decision: RetryDecision): void {
  expect(decision.retryable).toBe(false);
  expect(decision.category).toBe(RetryCategory.NON_RETRYABLE);
}

function expectUnknown(decision: RetryDecision): void {
  expect(decision.retryable).toBe(false);
  expect(decision.category).toBe(RetryCategory.UNKNOWN);
}

describe("classifyError", () => {
  describe("NetworkError", () => {
    it("classifies NetworkError without statusCode as RETRYABLE", () => {
      const error = new NetworkError("connection refused");
      expectRetryable(classifyError(error));
    });

    it("classifies 5xx as RETRYABLE", () => {
      const error = new NetworkError("server error", "NETWORK_ERROR", {}, 503);
      expectRetryable(classifyError(error));
    });

    it("classifies 429 as RETRYABLE", () => {
      const error = new NetworkError("rate limited", "NETWORK_ERROR", {}, 429);
      expectRetryable(classifyError(error));
    });

    it("classifies 4xx (non-429) as NON_RETRYABLE", () => {
      const error = new NetworkError("bad request", "NETWORK_ERROR", {}, 400);
      expectNonRetryable(classifyError(error));
    });

    it("classifies 403 as NON_RETRYABLE", () => {
      const error = new NetworkError("forbidden", "NETWORK_ERROR", {}, 403);
      expectNonRetryable(classifyError(error));
    });

    it("classifies 404 as NON_RETRYABLE", () => {
      const error = new NetworkError("not found", "NETWORK_ERROR", {}, 404);
      expectNonRetryable(classifyError(error));
    });

    it("classifies 1xx/2xx as UNKNOWN", () => {
      const error = new NetworkError("unexpected", "NETWORK_ERROR", {}, 200);
      expectUnknown(classifyError(error));
    });
  });

  describe("ContractExecutionError", () => {
    it("classifies SIMULATION_FAILED as RETRYABLE", () => {
      const error = new ContractExecutionError("sim failed", ContractErrorCode.SIMULATION_FAILED);
      expectRetryable(classifyError(error));
    });

    it("classifies TRANSACTION_SUBMISSION_FAILED as RETRYABLE", () => {
      const error = new ContractExecutionError(
        "submit failed",
        ContractErrorCode.TRANSACTION_SUBMISSION_FAILED
      );
      expectRetryable(classifyError(error));
    });

    it("classifies TRANSACTION_TIMEOUT as RETRYABLE", () => {
      const error = new ContractExecutionError("timed out", ContractErrorCode.TRANSACTION_TIMEOUT);
      expectRetryable(classifyError(error));
    });

    it("classifies INSUFFICIENT_FEE as NON_RETRYABLE", () => {
      const error = new ContractExecutionError("fee too low", ContractErrorCode.INSUFFICIENT_FEE);
      expectNonRetryable(classifyError(error));
    });

    it("classifies CONTRACT_REVERT as NON_RETRYABLE", () => {
      const error = new ContractExecutionError(
        "contract reverted",
        ContractErrorCode.CONTRACT_REVERT
      );
      expectNonRetryable(classifyError(error));
    });

    it("classifies UNKNOWN_RPC_ERROR as UNKNOWN", () => {
      const error = new ContractExecutionError(
        "unknown error",
        ContractErrorCode.UNKNOWN_RPC_ERROR
      );
      expectUnknown(classifyError(error));
    });
  });

  describe("ProofGenerationError", () => {
    it("classifies as NON_RETRYABLE", () => {
      const error = new ProofGenerationError("circuit download failed");
      expectNonRetryable(classifyError(error));
    });
  });

  describe("ValidationError", () => {
    it("classifies as NON_RETRYABLE", () => {
      const error = new ValidationError("invalid amount", "amount");
      expectNonRetryable(classifyError(error));
    });
  });

  describe("BatchValidationFailedError", () => {
    it("classifies as NON_RETRYABLE", () => {
      const error = new BatchValidationFailedError([
        { code: "INVALID_RECIPIENT", message: "bad address", field: "recipient" },
      ]);
      expectNonRetryable(classifyError(error));
    });
  });

  describe("Generic ZkPayrollError subclass", () => {
    it("classifies unknown subclasses as UNKNOWN", () => {
      const error = new ZkPayrollError("unexpected", "SOME_OTHER_CODE");
      expectUnknown(classifyError(error));
    });
  });

  describe("Generic Error", () => {
    it("classifies ECONNREFUSED as RETRYABLE", () => {
      expectRetryable(classifyError(new Error("ECONNREFUSED")));
    });

    it("classifies ECONNRESET as RETRYABLE", () => {
      expectRetryable(classifyError(new Error("ECONNRESET")));
    });

    it("classifies ETIMEDOUT as RETRYABLE", () => {
      expectRetryable(classifyError(new Error("ETIMEDOUT")));
    });

    it("classifies ENOTFOUND as RETRYABLE", () => {
      expectRetryable(classifyError(new Error("ENOTFOUND")));
    });

    it("classifies EAI_AGAIN as RETRYABLE", () => {
      expectRetryable(classifyError(new Error("EAI_AGAIN")));
    });

    it("classifies network-related message as RETRYABLE", () => {
      expectRetryable(classifyError(new Error("request failed: network error")));
    });

    it("classifies timeout message as RETRYABLE", () => {
      expectRetryable(classifyError(new Error("timed out")));
    });

    it("classifies AbortError as RETRYABLE", () => {
      const error = new Error("signal timed out");
      error.name = "AbortError";
      expectRetryable(classifyError(error));
    });

    it("classifies TimeoutError as RETRYABLE", () => {
      const error = new Error("request took too long");
      error.name = "TimeoutError";
      expectRetryable(classifyError(error));
    });

    it("classifies unrelated Error as UNKNOWN", () => {
      const error = new Error("some random error");
      expectUnknown(classifyError(error));
    });
  });

  describe("Non-Error thrown values", () => {
    it("classifies string as UNKNOWN", () => {
      expectUnknown(classifyError("something went wrong"));
    });

    it("classifies object as UNKNOWN", () => {
      expectUnknown(classifyError({ code: 500 }));
    });

    it("classifies null as UNKNOWN", () => {
      expectUnknown(classifyError(null));
    });

    it("classifies undefined as UNKNOWN", () => {
      expectUnknown(classifyError(undefined));
    });
  });

  describe("RetryDecision structure", () => {
    it("returns category, retryable, and reason fields", () => {
      const decision = classifyError(new Error("ECONNREFUSED"));
      expect(decision).toHaveProperty("category");
      expect(decision).toHaveProperty("retryable");
      expect(decision).toHaveProperty("reason");
      expect(typeof decision.reason).toBe("string");
      expect(decision.reason.length).toBeGreaterThan(0);
    });
  });
});
