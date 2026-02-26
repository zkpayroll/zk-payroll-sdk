import {
  ZkPayrollError,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  ValidationError,
  ContractErrorCode,
  mapRpcError,
} from "../src/core/errors";
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
      const error = new ContractExecutionError(
        "sim failed",
        ContractErrorCode.SIMULATION_FAILED,
        { transactionId: "tx_456" }
      );
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
});
