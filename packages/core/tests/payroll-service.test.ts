import { Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import { PayrollService } from "../src/payroll";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
import { IProofGenerator, ProofPayload } from "../src/crypto/IProofGenerator";
import {
  PayrollError,
  PayrollServiceErrorCode,
  ContractExecutionError,
  ContractErrorCode,
} from "../src/errors";
import type { SdkLogger } from "../src/logging/SdkLogger";

const MOCK_PROOF: ProofPayload = {
  proof: {
    pi_a: ["1", "2"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
    ],
    pi_c: ["7", "8"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["123", "456"],
};

function createMocks() {
  const mockWrapper = {
    privatePay: jest.fn().mockResolvedValue(xdr.ScVal.scvVoid()),
  } as unknown as PayrollContractWrapper;

  const mockProofGen: IProofGenerator = {
    generateProof: jest.fn().mockResolvedValue(MOCK_PROOF),
  };

  const signer = Keypair.random();

  return { mockWrapper, mockProofGen, signer };
}

describe("PayrollService", () => {
  describe("processPayment", () => {
    it("generates a ZK proof with correct witness data", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await service.processPayment({
        recipient: "GABC123",
        amount: 1000000n,
        asset: "native",
      });

      expect(mockProofGen.generateProof).toHaveBeenCalledWith(
        {
          recipient: "GABC123",
          amount: "1000000",
          asset: "native",
        },
        undefined
      );
    });

    it("invokes contract.privatePay with correct args after proof generation", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await service.processPayment({
        recipient: "GABC123",
        amount: 500n,
        asset: "native",
      });

      const privatePayMock = mockWrapper.privatePay as jest.Mock;
      const callArgs = privatePayMock.mock.calls[0];
      expect(callArgs[0]).toBe("GABC123");
      expect(callArgs[1]).toBe(500n);
      expect(callArgs[2]).toBe("native");
      expect(callArgs[3]).toEqual(MOCK_PROOF);
      expect(callArgs[4]).toBeDefined();
      expect(typeof callArgs[4].getPublicKey).toBe("function");
      expect(typeof callArgs[4].sign).toBe("function");
      expect(callArgs[5]).toBe(Networks.TESTNET);
    });

    it("emits structured progress for validation, proof generation, and submission prep", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);
      const onProgress = jest.fn();

      (mockProofGen.generateProof as jest.Mock).mockImplementation(async (_witness, progress) => {
        progress({
          operation: "proof",
          stage: "proof_generating",
          message: "generating",
          progress: 0,
          timestamp: "2026-06-30T00:00:00.000Z",
        });
        return MOCK_PROOF;
      });

      await service.processPayment({
        recipient: "GABC123",
        amount: 100n,
        asset: "native",
        onProgress,
      });

      expect(mockProofGen.generateProof).toHaveBeenCalledWith(expect.any(Object), onProgress);
      expect(onProgress.mock.calls.map(([event]) => event.stage)).toEqual([
        "validation",
        "validation",
        "proof_generating",
        "submission_preparing",
        "submission_done",
      ]);
      expect(onProgress.mock.calls[0][0]).toMatchObject({
        operation: "payment",
        message: "validation_started",
        progress: 0,
      });
    });

    it("returns a PaymentResult with txHash and publicSignals", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      const result = await service.processPayment({
        recipient: "GABC123",
        amount: 100n,
        asset: "native",
      });

      expect(result).toHaveProperty("txHash");
      expect(typeof result.txHash).toBe("string");
      expect(result.publicSignals).toEqual(["123", "456"]);
    });

    it("deduplicates duplicate retries when idempotencyKey matches", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      const request = {
        recipient: "GABC123",
        amount: 100n,
        asset: "native",
        idempotencyKey: "retry-123",
      };

      const [first, second] = await Promise.all([
        service.processPayment(request),
        service.processPayment(request),
      ]);

      expect(first).toEqual(second);
      expect(mockProofGen.generateProof).toHaveBeenCalledTimes(1);
      expect(mockWrapper.privatePay as jest.Mock).toHaveBeenCalledTimes(1);
    });

    it("does not deduplicate when idempotencyKey is omitted", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await service.processPayment({ recipient: "GABC123", amount: 100n, asset: "native" });
      await service.processPayment({ recipient: "GABC123", amount: 100n, asset: "native" });

      expect(mockProofGen.generateProof).toHaveBeenCalledTimes(2);
      expect(mockWrapper.privatePay as jest.Mock).toHaveBeenCalledTimes(2);
    });

    it("builds deterministic idempotency keys for payment payloads", () => {
      const key = PayrollService.createIdempotencyKey({
        recipient: " GABC123 ",
        amount: 100n,
        asset: "NATIVE",
      });

      expect(key).toBe("pay:gabc123:100:native");
    });

    it("passes custom network to contract wrapper", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer, Networks.PUBLIC);

      await service.processPayment({
        recipient: "GABC123",
        amount: 100n,
        asset: "native",
      });

      const privatePayMock = mockWrapper.privatePay as jest.Mock;
      const callArgs = privatePayMock.mock.calls[0];
      expect(typeof callArgs[0]).toBe("string");
      expect(typeof callArgs[1]).toBe("bigint");
      expect(typeof callArgs[2]).toBe("string");
      expect(typeof callArgs[3]).toBe("object");
      expect(callArgs[4]).toBeDefined();
      expect(typeof callArgs[4].getPublicKey).toBe("function");
      expect(callArgs[5]).toBe(Networks.PUBLIC);
    });

    it("throws PayrollError(2002) when recipient is empty", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await expect(
        service.processPayment({ recipient: "", amount: 100n, asset: "native" })
      ).rejects.toThrow(PayrollError);

      await expect(
        service.processPayment({ recipient: "", amount: 100n, asset: "native" })
      ).rejects.toMatchObject({
        code: String(PayrollServiceErrorCode.INVALID_RECIPIENT),
      });
    });

    it("throws PayrollError(2003) when amount is zero", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await expect(
        service.processPayment({
          recipient: "GABC123",
          amount: 0n,
          asset: "native",
        })
      ).rejects.toMatchObject({
        code: String(PayrollServiceErrorCode.INVALID_AMOUNT),
      });
    });

    it("throws PayrollError(2003) when amount is negative", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await expect(
        service.processPayment({
          recipient: "GABC123",
          amount: -5n,
          asset: "native",
        })
      ).rejects.toMatchObject({
        code: String(PayrollServiceErrorCode.INVALID_AMOUNT),
      });
    });

    it("throws PayrollError(2004) when asset is empty", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await expect(
        service.processPayment({
          recipient: "GABC123",
          amount: 100n,
          asset: "",
        })
      ).rejects.toMatchObject({
        code: String(PayrollServiceErrorCode.INVALID_ASSET),
      });
    });

    it("wraps proof generation errors in PayrollError(2001)", async () => {
      const { mockWrapper, signer } = createMocks();
      const failingProofGen: IProofGenerator = {
        generateProof: jest.fn().mockRejectedValue(new Error("circuit mismatch")),
      };
      const service = new PayrollService(mockWrapper, failingProofGen, signer);

      await expect(
        service.processPayment({
          recipient: "GABC123",
          amount: 100n,
          asset: "native",
        })
      ).rejects.toMatchObject({
        code: String(PayrollServiceErrorCode.PROOF_GENERATION_FAILED),
        message: expect.stringContaining("circuit mismatch"),
      });
    });

    it("propagates PayrollError from proof generator unchanged", async () => {
      const { mockWrapper, signer } = createMocks();
      const customError = new PayrollError("Custom proof error", 9999);
      const failingProofGen: IProofGenerator = {
        generateProof: jest.fn().mockRejectedValue(customError),
      };
      const service = new PayrollService(mockWrapper, failingProofGen, signer);

      await expect(
        service.processPayment({
          recipient: "GABC123",
          amount: 100n,
          asset: "native",
        })
      ).rejects.toBe(customError);
    });
  });

  describe("contract-state gating (#145)", () => {
    function createMockLogger(): SdkLogger {
      return {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as SdkLogger;
    }

    it("propagates a CONTRACT_REVERT from an invalid company/payroll state unchanged", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const stateError = new ContractExecutionError(
        'Contract reverted during "private_pay": {"reason":"CompanyNotActive"}',
        ContractErrorCode.CONTRACT_REVERT,
        { requestId: "req-1" }
      );
      (mockWrapper.privatePay as jest.Mock).mockRejectedValue(stateError);
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await expect(
        service.processPayment({ recipient: "GABC123", amount: 100n, asset: "native" })
      ).rejects.toBe(stateError);
    });

    it("preserves the ContractExecutionError type and CONTRACT_REVERT code for consumers", async () => {
      expect.assertions(2);
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const stateError = new ContractExecutionError(
        "company is paused",
        ContractErrorCode.CONTRACT_REVERT
      );
      (mockWrapper.privatePay as jest.Mock).mockRejectedValue(stateError);
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await service
        .processPayment({ recipient: "GABC123", amount: 100n, asset: "native" })
        .catch((err) => {
          expect(err).toBeInstanceOf(ContractExecutionError);
          expect((err as ContractExecutionError).code).toBe(ContractErrorCode.CONTRACT_REVERT);
        });
    });

    it("logs the failure via the SDK logger before rethrowing, for observability", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const stateError = new ContractExecutionError(
        "company is paused",
        ContractErrorCode.CONTRACT_REVERT
      );
      (mockWrapper.privatePay as jest.Mock).mockRejectedValue(stateError);
      const logger = createMockLogger();
      const service = new PayrollService(
        mockWrapper,
        mockProofGen,
        signer,
        Networks.TESTNET,
        logger
      );

      await expect(
        service.processPayment({ recipient: "GABC123", amount: 100n, asset: "native" })
      ).rejects.toBe(stateError);

      expect(logger.error).toHaveBeenCalledWith(
        "contract_invocation_failed",
        expect.objectContaining({
          method: "private_pay",
          error: "company is paused",
          code: ContractErrorCode.CONTRACT_REVERT,
        })
      );
    });

    it("does not emit the submission_done progress event when the contract call is rejected", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      (mockWrapper.privatePay as jest.Mock).mockRejectedValue(
        new ContractExecutionError("company is paused", ContractErrorCode.CONTRACT_REVERT)
      );
      const service = new PayrollService(mockWrapper, mockProofGen, signer);
      const onProgress = jest.fn();

      await expect(
        service.processPayment({
          recipient: "GABC123",
          amount: 100n,
          asset: "native",
          onProgress,
        })
      ).rejects.toThrow();

      const stages = onProgress.mock.calls.map((call) => call[0].stage);
      expect(stages).toContain("submission_preparing");
      expect(stages).not.toContain("submission_done");
    });

    it("also propagates non-state contract failures (e.g. TRANSACTION_TIMEOUT) the same way", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const timeoutError = new ContractExecutionError(
        "Transaction timed out after 15 polls",
        ContractErrorCode.TRANSACTION_TIMEOUT
      );
      (mockWrapper.privatePay as jest.Mock).mockRejectedValue(timeoutError);
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await expect(
        service.processPayment({ recipient: "GABC123", amount: 100n, asset: "native" })
      ).rejects.toBe(timeoutError);
    });

    it("does not log an error and does call payment_complete on a successful invocation", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const logger = createMockLogger();
      const service = new PayrollService(
        mockWrapper,
        mockProofGen,
        signer,
        Networks.TESTNET,
        logger
      );

      await service.processPayment({ recipient: "GABC123", amount: 100n, asset: "native" });

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "payment_complete",
        expect.objectContaining({ txHash: expect.any(String) })
      );
    });
  });

  describe("filterTransactions", () => {
    it("filters transactions by minimum amount", () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      const transactions = [
        { amount: 100n, id: "1" },
        { amount: 500n, id: "2" },
        { amount: 200n, id: "3" },
      ];

      const result = service.filterTransactions(transactions, {
        minAmount: 150n,
      });

      expect(result).toEqual([
        { amount: 500n, id: "2" },
        { amount: 200n, id: "3" },
      ]);
    });
  });
});
