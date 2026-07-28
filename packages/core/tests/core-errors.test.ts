import {
  ZkPayrollError,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  ValidationError,
  ContractErrorCode,
  mapRpcError,
  toUserFriendlyError,
  TimeoutFailureState,
  classifyContractErrorCode,
  classifyTimeoutFailure,
} from "../src/errors";
import { PayrollError } from "../src/errors";

describe("Core Error Classes", () => {
  describe("ZkPayrollError", () => {
    it("sets name to constructor name", () => {
      const error = new ZkPayrollError("test", "TEST_CODE");
      expect(error.name).toBe("ZkPayrollError");
    });

    it("stores code and context", () => {
      const error = new ZkPayrollError("msg", "CODE_1", {
        transactionId: "tx_123",
      });
      expect(error.code).toBe("CODE_1");
      expect(error.context.transactionId).toBe("tx_123");
      expect(error.message).toBe("msg");
    });

    it("defaults context to empty object", () => {
      const error = new ZkPayrollError("msg", "CODE");
      expect(error.context).toEqual({});
    });

    it("is instanceof Error", () => {
      const error = new ZkPayrollError("msg", "CODE");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("NetworkError", () => {
    it("extends ZkPayrollError", () => {
      const error = new NetworkError("timeout");
      expect(error).toBeInstanceOf(ZkPayrollError);
      expect(error.name).toBe("NetworkError");
    });

    it("stores statusCode", () => {
      const error = new NetworkError("not found", "HTTP_404", {}, 404);
      expect(error.statusCode).toBe(404);
    });

    it("defaults code to NETWORK_ERROR", () => {
      const error = new NetworkError("fail");
      expect(error.code).toBe("NETWORK_ERROR");
    });
  });

  describe("ProofGenerationError", () => {
    it("extends ZkPayrollError", () => {
      const error = new ProofGenerationError("circuit failed");
      expect(error).toBeInstanceOf(ZkPayrollError);
      expect(error.name).toBe("ProofGenerationError");
    });

    it("defaults code to PROOF_GENERATION_FAILED", () => {
      const error = new ProofGenerationError("bad witness");
      expect(error.code).toBe("PROOF_GENERATION_FAILED");
    });

    it("accepts context metadata", () => {
      const error = new ProofGenerationError("fail", "PROOF_GENERATION_FAILED", {
        contractId: "C_ABC",
      });
      expect(error.context.contractId).toBe("C_ABC");
    });
  });

  describe("ContractExecutionError", () => {
    it("extends ZkPayrollError", () => {
      const error = new ContractExecutionError("revert");
      expect(error).toBeInstanceOf(ZkPayrollError);
      expect(error.name).toBe("ContractExecutionError");
    });

    it("accepts ContractErrorCode values", () => {
      const error = new ContractExecutionError("sim failed", ContractErrorCode.SIMULATION_FAILED, {
        transactionId: "tx_456",
      });
      expect(error.code).toBe("SIMULATION_FAILED");
      expect(error.context.transactionId).toBe("tx_456");
    });

    it("defaults to UNKNOWN_RPC_ERROR", () => {
      const error = new ContractExecutionError("unknown");
      expect(error.code).toBe("UNKNOWN_RPC_ERROR");
    });
  });

  describe("ValidationError", () => {
    it("extends ZkPayrollError", () => {
      const error = new ValidationError("invalid", "recipient");
      expect(error).toBeInstanceOf(ZkPayrollError);
      expect(error.name).toBe("ValidationError");
    });

    it("stores the field name", () => {
      const error = new ValidationError("too small", "amount");
      expect(error.field).toBe("amount");
    });

    it("defaults code to VALIDATION_ERROR", () => {
      const error = new ValidationError("bad", "asset");
      expect(error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("mapRpcError", () => {
    it("returns existing ContractExecutionError unchanged", () => {
      const original = new ContractExecutionError("existing");
      expect(mapRpcError(original)).toBe(original);
    });

    it("maps simulation errors", () => {
      const result = mapRpcError(new Error("simulate transaction failed"));
      expect(result.code).toBe(ContractErrorCode.SIMULATION_FAILED);
    });

    it("maps fee errors", () => {
      const result = mapRpcError(new Error("insufficient fee"));
      expect(result.code).toBe(ContractErrorCode.INSUFFICIENT_FEE);
    });

    it("maps timeout errors", () => {
      const result = mapRpcError(new Error("transaction timeout"));
      expect(result.code).toBe(ContractErrorCode.TRANSACTION_TIMEOUT);
    });

    it("maps revert errors", () => {
      const result = mapRpcError(new Error("contract revert"));
      expect(result.code).toBe(ContractErrorCode.CONTRACT_REVERT);
    });

    it("maps submission errors", () => {
      const result = mapRpcError(new Error("failed to submit"));
      expect(result.code).toBe(ContractErrorCode.TRANSACTION_SUBMISSION_FAILED);
    });

    it("maps unknown errors", () => {
      const result = mapRpcError(new Error("something else"));
      expect(result.code).toBe(ContractErrorCode.UNKNOWN_RPC_ERROR);
    });

    it("passes context through", () => {
      const result = mapRpcError(new Error("fail"), {
        transactionId: "tx_789",
      });
      expect(result.context.transactionId).toBe("tx_789");
    });
  });

  describe("PayrollError (backward compat)", () => {
    it("extends ZkPayrollError", () => {
      const error = new PayrollError("test", 500);
      expect(error).toBeInstanceOf(ZkPayrollError);
    });

    it("converts numeric code to string", () => {
      const error = new PayrollError("test", 1001);
      expect(error.code).toBe("1001");
    });

    it("keeps name as PayrollError", () => {
      const error = new PayrollError("test", 500);
      expect(error.name).toBe("PayrollError");
    });
  });

  describe("toUserFriendlyError", () => {
    it("maps SIMULATION_FAILED to a simulation-friendly message", () => {
      const err = new ContractExecutionError(
        "simulate failed",
        ContractErrorCode.SIMULATION_FAILED,
        { transactionId: "tx_sim" }
      );
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/simulat/i);
      expect(result.code).toBe(ContractErrorCode.SIMULATION_FAILED);
    });

    it("maps TRANSACTION_SUBMISSION_FAILED to a submission-friendly message", () => {
      const err = new ContractExecutionError(
        "submit failed",
        ContractErrorCode.TRANSACTION_SUBMISSION_FAILED
      );
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/rejected|submission|network/i);
      expect(result.code).toBe(ContractErrorCode.TRANSACTION_SUBMISSION_FAILED);
    });

    it("maps TRANSACTION_TIMEOUT to a timeout-friendly message", () => {
      const err = new ContractExecutionError("timed out", ContractErrorCode.TRANSACTION_TIMEOUT);
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/time|congested/i);
      expect(result.code).toBe(ContractErrorCode.TRANSACTION_TIMEOUT);
    });

    it("maps INSUFFICIENT_FEE to a fee-friendly message", () => {
      const err = new ContractExecutionError("fee too low", ContractErrorCode.INSUFFICIENT_FEE);
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/fee/i);
      expect(result.code).toBe(ContractErrorCode.INSUFFICIENT_FEE);
    });

    it("maps CONTRACT_REVERT to a revert-friendly message", () => {
      const err = new ContractExecutionError(
        "contract reverted",
        ContractErrorCode.CONTRACT_REVERT
      );
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/reject|contract/i);
      expect(result.code).toBe(ContractErrorCode.CONTRACT_REVERT);
    });

    it("maps UNKNOWN_RPC_ERROR to a generic message", () => {
      const err = new ContractExecutionError("weird error");
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/unexpected|error/i);
      expect(result.code).toBe("UNKNOWN_RPC_ERROR");
    });

    it("maps NetworkError to a network-friendly message", () => {
      const err = new NetworkError("connection refused");
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/network/i);
      expect(result.code).toBe("NETWORK_ERROR");
    });

    it("maps ProofGenerationError to a proof-friendly message", () => {
      const err = new ProofGenerationError("circuit crashed");
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/proof/i);
      expect(result.code).toBe("PROOF_GENERATION_FAILED");
    });

    it("maps ValidationError to a validation-friendly message", () => {
      const err = new ValidationError("bad input", "amount");
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/validat/i);
      expect(result.code).toBe("VALIDATION_ERROR");
    });

    it("maps WalletError-like objects via duck-typing", () => {
      const walletErr = {
        name: "WalletError",
        message: "User rejected signing",
        code: "WALLET_SIGNING_REJECTED",
        walletId: "freighter",
      };
      const result = toUserFriendlyError(walletErr);
      expect(result.friendlyMessage).toMatch(/signing|rejected/i);
      expect(result.code).toBe("WALLET_SIGNING_REJECTED");
      expect(result.context.walletId).toBe("freighter");
    });

    it("maps a plain Error with UNKNOWN_RPC_ERROR code", () => {
      const result = toUserFriendlyError(new Error("something broke"));
      expect(result.friendlyMessage).toMatch(/unexpected|error/i);
      expect(result.code).toBe("UNKNOWN_RPC_ERROR");
      expect(result.context).toEqual({});
    });

    it("maps a string value gracefully", () => {
      const result = toUserFriendlyError("raw string error");
      expect(result.friendlyMessage).toMatch(/unexpected|error/i);
      expect(result.code).toBe("UNKNOWN_RPC_ERROR");
    });

    it("preserves original error in result", () => {
      const original = new ContractExecutionError("test");
      const result = toUserFriendlyError(original);
      expect(result.originalError).toBe(original);
    });

    it("preserves context metadata", () => {
      const ctx = { transactionId: "tx_abc", contractId: "C_123", network: "testnet" };
      const err = new ContractExecutionError("fail", ContractErrorCode.SIMULATION_FAILED, ctx);
      const result = toUserFriendlyError(err);
      expect(result.context).toEqual(ctx);
    });

    it("accepts custom message overrides", () => {
      const err = new ContractExecutionError("sim fail", ContractErrorCode.SIMULATION_FAILED);
      const overrides = {
        SIMULATION_FAILED: "Custom simulation message for the user.",
      };
      const result = toUserFriendlyError(err, overrides);
      expect(result.friendlyMessage).toBe(overrides.SIMULATION_FAILED);
    });

    it("uses default message for unrecognized codes when no override", () => {
      const err = { code: "SOME_WEIRD_CODE", context: {}, message: "weird" };
      const result = toUserFriendlyError(err);
      expect(result.friendlyMessage).toMatch(/unexpected|error/i);
    });

    it("uses override for unrecognized codes when provided", () => {
      const err = { code: "SOME_WEIRD_CODE", context: {}, message: "weird" };
      const overrides = { SOME_WEIRD_CODE: "Handled with custom message." };
      const result = toUserFriendlyError(err, overrides);
      expect(result.friendlyMessage).toBe(overrides.SOME_WEIRD_CODE);
    });

    it("falls back to hardcoded message when even the default map is missing", () => {
      const unknown = { code: "NO_SUCH_CODE", context: {} };
      const result = toUserFriendlyError(unknown);
      expect(result.friendlyMessage).toBeTruthy();
    });
  });

  describe("TimeoutFailureState", () => {
    it("defines all four states", () => {
      expect(TimeoutFailureState.RETRYABLE).toBe("RETRYABLE");
      expect(TimeoutFailureState.EXPIRED).toBe("EXPIRED");
      expect(TimeoutFailureState.UNKNOWN).toBe("UNKNOWN");
      expect(TimeoutFailureState.TERMINAL).toBe("TERMINAL");
    });
  });

  describe("classifyContractErrorCode", () => {
    it("classifies TRANSACTION_TIMEOUT as EXPIRED", () => {
      expect(classifyContractErrorCode(ContractErrorCode.TRANSACTION_TIMEOUT)).toBe(
        TimeoutFailureState.EXPIRED
      );
    });

    it("classifies SIMULATION_FAILED as TERMINAL", () => {
      expect(classifyContractErrorCode(ContractErrorCode.SIMULATION_FAILED)).toBe(
        TimeoutFailureState.TERMINAL
      );
    });

    it("classifies CONTRACT_REVERT as TERMINAL", () => {
      expect(classifyContractErrorCode(ContractErrorCode.CONTRACT_REVERT)).toBe(
        TimeoutFailureState.TERMINAL
      );
    });

    it("classifies INSUFFICIENT_FEE as RETRYABLE", () => {
      expect(classifyContractErrorCode(ContractErrorCode.INSUFFICIENT_FEE)).toBe(
        TimeoutFailureState.RETRYABLE
      );
    });

    it("classifies TRANSACTION_SUBMISSION_FAILED as RETRYABLE", () => {
      expect(classifyContractErrorCode(ContractErrorCode.TRANSACTION_SUBMISSION_FAILED)).toBe(
        TimeoutFailureState.RETRYABLE
      );
    });

    it("classifies RPC_TIMEOUT as RETRYABLE", () => {
      expect(classifyContractErrorCode(ContractErrorCode.RPC_TIMEOUT)).toBe(
        TimeoutFailureState.RETRYABLE
      );
    });

    it("classifies INVALID_RESPONSE as RETRYABLE", () => {
      expect(classifyContractErrorCode(ContractErrorCode.INVALID_RESPONSE)).toBe(
        TimeoutFailureState.RETRYABLE
      );
    });

    it("classifies UNKNOWN_RPC_ERROR as UNKNOWN", () => {
      expect(classifyContractErrorCode(ContractErrorCode.UNKNOWN_RPC_ERROR)).toBe(
        TimeoutFailureState.UNKNOWN
      );
    });
  });

  describe("classifyTimeoutFailure", () => {
    it("classifies ContractExecutionError by its failureState", () => {
      const err = new ContractExecutionError("msg", ContractErrorCode.TRANSACTION_TIMEOUT);
      expect(classifyTimeoutFailure(err)).toBe(TimeoutFailureState.EXPIRED);
    });

    it("classifies network-level errors as RETRYABLE", () => {
      const networkErrors = [
        "econnrefused",
        "econnreset",
        "enetunreach",
        "etimedout",
        "network error",
        "fetch failed",
        "request failed",
        "socket hang up",
      ];
      for (const msg of networkErrors) {
        expect(classifyTimeoutFailure(new Error(msg))).toBe(TimeoutFailureState.RETRYABLE);
      }
    });

    it("classifies ledger expiry errors as EXPIRED", () => {
      const expiryErrors = ["txn timeout", "tx expired", "ledger seq too old", "stale transaction"];
      for (const msg of expiryErrors) {
        expect(classifyTimeoutFailure(new Error(msg))).toBe(TimeoutFailureState.EXPIRED);
      }
    });

    it("classifies terminal contract errors as TERMINAL", () => {
      const terminalErrors = ["contract revert", "wasm trap", "simulation fail", "unauthorized"];
      for (const msg of terminalErrors) {
        expect(classifyTimeoutFailure(new Error(msg))).toBe(TimeoutFailureState.TERMINAL);
      }
    });

    it("classifies unrecognized errors as UNKNOWN", () => {
      expect(classifyTimeoutFailure(new Error("weird internal error"))).toBe(
        TimeoutFailureState.UNKNOWN
      );
    });

    it("handles non-Error input", () => {
      expect(classifyTimeoutFailure("string error")).toBe(TimeoutFailureState.UNKNOWN);
      expect(classifyTimeoutFailure(null)).toBe(TimeoutFailureState.UNKNOWN);
      expect(classifyTimeoutFailure(42)).toBe(TimeoutFailureState.UNKNOWN);
    });
  });

  describe("ContractExecutionError.failureState", () => {
    it("auto-classifies SIMULATION_FAILED as TERMINAL", () => {
      const err = new ContractExecutionError("sim failed", ContractErrorCode.SIMULATION_FAILED);
      expect(err.failureState).toBe(TimeoutFailureState.TERMINAL);
    });

    it("auto-classifies TRANSACTION_TIMEOUT as EXPIRED", () => {
      const err = new ContractExecutionError("timed out", ContractErrorCode.TRANSACTION_TIMEOUT);
      expect(err.failureState).toBe(TimeoutFailureState.EXPIRED);
    });

    it("auto-classifies INSUFFICIENT_FEE as RETRYABLE", () => {
      const err = new ContractExecutionError("fee too low", ContractErrorCode.INSUFFICIENT_FEE);
      expect(err.failureState).toBe(TimeoutFailureState.RETRYABLE);
    });

    it("auto-classifies CONTRACT_REVERT as TERMINAL", () => {
      const err = new ContractExecutionError("reverted", ContractErrorCode.CONTRACT_REVERT);
      expect(err.failureState).toBe(TimeoutFailureState.TERMINAL);
    });

    it("auto-classifies TRANSACTION_SUBMISSION_FAILED as RETRYABLE", () => {
      const err = new ContractExecutionError(
        "submission failed",
        ContractErrorCode.TRANSACTION_SUBMISSION_FAILED
      );
      expect(err.failureState).toBe(TimeoutFailureState.RETRYABLE);
    });

    it("auto-classifies RPC_TIMEOUT as RETRYABLE", () => {
      const err = new ContractExecutionError("rpc timeout", ContractErrorCode.RPC_TIMEOUT);
      expect(err.failureState).toBe(TimeoutFailureState.RETRYABLE);
    });

    it("auto-classifies INVALID_RESPONSE as RETRYABLE", () => {
      const err = new ContractExecutionError(
        "invalid response",
        ContractErrorCode.INVALID_RESPONSE
      );
      expect(err.failureState).toBe(TimeoutFailureState.RETRYABLE);
    });

    it("defaults UNKNOWN_RPC_ERROR to UNKNOWN", () => {
      const err = new ContractExecutionError("unknown");
      expect(err.failureState).toBe(TimeoutFailureState.UNKNOWN);
    });
  });
});
