import { Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import { PayrollService } from "../src/payroll";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
import { IProofGenerator, ProofPayload } from "../src/crypto/IProofGenerator";
import { PayrollError, PayrollServiceErrorCode } from "../src/errors";

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

      expect(mockProofGen.generateProof).toHaveBeenCalledWith({
        recipient: "GABC123",
        amount: "1000000",
        asset: "native",
      });
    });

    it("invokes contract.privatePay with correct args after proof generation", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(mockWrapper, mockProofGen, signer);

      await service.processPayment({
        recipient: "GABC123",
        amount: 500n,
        asset: "native",
      });

      expect(mockWrapper.privatePay).toHaveBeenCalledWith(
        "GABC123",
        500n,
        "native",
        MOCK_PROOF,
        signer,
        Networks.TESTNET
      );
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

    it("passes custom network to contract wrapper", async () => {
      const { mockWrapper, mockProofGen, signer } = createMocks();
      const service = new PayrollService(
        mockWrapper,
        mockProofGen,
        signer,
        Networks.PUBLIC
      );

      await service.processPayment({
        recipient: "GABC123",
        amount: 100n,
        asset: "native",
      });

      expect(mockWrapper.privatePay).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(BigInt),
        expect.any(String),
        expect.any(Object),
        signer,
        Networks.PUBLIC
      );
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
        code: PayrollServiceErrorCode.INVALID_RECIPIENT,
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
        code: PayrollServiceErrorCode.INVALID_AMOUNT,
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
        code: PayrollServiceErrorCode.INVALID_AMOUNT,
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
        code: PayrollServiceErrorCode.INVALID_ASSET,
      });
    });

    it("wraps proof generation errors in PayrollError(2001)", async () => {
      const { mockWrapper, signer } = createMocks();
      const failingProofGen: IProofGenerator = {
        generateProof: jest
          .fn()
          .mockRejectedValue(new Error("circuit mismatch")),
      };
      const service = new PayrollService(
        mockWrapper,
        failingProofGen,
        signer
      );

      await expect(
        service.processPayment({
          recipient: "GABC123",
          amount: 100n,
          asset: "native",
        })
      ).rejects.toMatchObject({
        code: PayrollServiceErrorCode.PROOF_GENERATION_FAILED,
        message: expect.stringContaining("circuit mismatch"),
      });
    });

    it("propagates PayrollError from proof generator unchanged", async () => {
      const { mockWrapper, signer } = createMocks();
      const customError = new PayrollError("Custom proof error", 9999);
      const failingProofGen: IProofGenerator = {
        generateProof: jest.fn().mockRejectedValue(customError),
      };
      const service = new PayrollService(
        mockWrapper,
        failingProofGen,
        signer
      );

      await expect(
        service.processPayment({
          recipient: "GABC123",
          amount: 100n,
          asset: "native",
        })
      ).rejects.toBe(customError);
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
