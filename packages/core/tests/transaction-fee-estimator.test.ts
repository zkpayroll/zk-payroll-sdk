import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  TransactionFeeEstimator,
  estimateTransactionFee,
  estimatePreparedTransactionFee,
  FeeEstimationErrorCode,
} from "../src/fee-estimation";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
import type { PreparedInvocation } from "../src/adapters/BaseContractWrapper";
import type { ISigner } from "../src/signer/types";
import { ProofPayload } from "../src/crypto/IProofGenerator";
import { ContractErrorCode, ContractExecutionError, ValidationError } from "../src/core/errors";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TEST_RECIPIENT = Keypair.random().publicKey();

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
  publicSignals: ["123"],
};

/** Build an unsigned Soroban transaction (no resource fee folded in). */
function buildUnsignedTransaction(fee: string = BASE_FEE): Transaction {
  const account = new Account(Keypair.random().publicKey(), "1");
  return new TransactionBuilder(account, {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(TEST_CONTRACT_ID).call("private_pay"))
    .setTimeout(30)
    .build();
}

/**
 * Build a transaction the way `rpc.assembleTransaction` would: the resource
 * fee is folded into `transaction.fee` and stored in the Soroban extension.
 */
function buildAssembledTransaction(baseFee: string, resourceFee: bigint): Transaction {
  const account = new Account(Keypair.random().publicKey(), "1");
  return new TransactionBuilder(account, {
    fee: baseFee,
    networkPassphrase: Networks.TESTNET,
    sorobanData: new SorobanDataBuilder().setResourceFee(resourceFee).build(),
  })
    .addOperation(new Contract(TEST_CONTRACT_ID).call("private_pay"))
    .setTimeout(30)
    .build();
}

function makeServer(simulate: jest.Mock): { server: rpc.Server; simulateTransaction: jest.Mock } {
  return {
    server: { simulateTransaction: simulate } as unknown as rpc.Server,
    simulateTransaction: simulate,
  };
}

const SIM_SUCCESS = { minResourceFee: "1234" } as unknown as rpc.Api.SimulateTransactionResponse;

describe("TransactionFeeEstimator", () => {
  describe("estimate", () => {
    it("returns the base and resource fee for an unsigned transaction", async () => {
      const { server, simulateTransaction } = makeServer(jest.fn().mockResolvedValue(SIM_SUCCESS));
      const estimator = new TransactionFeeEstimator(server);

      const estimate = await estimator.estimate(buildUnsignedTransaction());

      expect(simulateTransaction).toHaveBeenCalledTimes(1);
      expect(estimate.baseFee).toBe(BigInt(BASE_FEE));
      expect(estimate.resourceFee).toBe(1234n);
      expect(estimate.bufferFee).toBe(0n);
      expect(estimate.totalFee).toBe(BigInt(BASE_FEE) + 1234n);
      expect(estimate.operationCount).toBe(1);
      expect(estimate.exact).toBe(true);
      expect(estimate.breakdown).toContain("Base:");
      expect(estimate.breakdown).toContain("Resource:");
      expect(estimate.breakdown).toContain("Total:");
      expect(estimate.breakdown).toContain("stroops");
    });

    it("applies the optional safety buffer in basis points", async () => {
      const { server } = makeServer(jest.fn().mockResolvedValue(SIM_SUCCESS));
      const estimator = new TransactionFeeEstimator(server, { bufferBps: 1_000 }); // +10%

      const estimate = await estimator.estimate(buildUnsignedTransaction());

      // subtotal = 100 + 1234 = 1334; 10% => 133
      expect(estimate.bufferFee).toBe(133n);
      expect(estimate.totalFee).toBe(1334n + 133n);
      expect(estimate.breakdown).toContain("Buffer:");
    });

    it("includes the footprint restore fee when the simulation requires a restore", async () => {
      const restoreResponse = {
        minResourceFee: "1000",
        transactionData: {},
        restorePreamble: { minResourceFee: "250", transactionData: {} },
      } as unknown as rpc.Api.SimulateTransactionResponse;
      const { server } = makeServer(jest.fn().mockResolvedValue(restoreResponse));
      const estimator = new TransactionFeeEstimator(server);

      const estimate = await estimator.estimate(buildUnsignedTransaction());

      expect(estimate.resourceFee).toBe(1250n);
      expect(estimate.totalFee).toBe(BigInt(BASE_FEE) + 1250n);
      expect(estimate.breakdown).toContain("restore");
    });

    it("throws a sanitized SIMULATION_FAILED error when simulation rejects the transaction", async () => {
      const errorResponse = {
        error: "simulation failed: recipient=GABCDEFGHIJKLMNOP amount=5000 secret=supersecretvalue",
        events: [],
      } as unknown as rpc.Api.SimulateTransactionResponse;
      const { server } = makeServer(jest.fn().mockResolvedValue(errorResponse));
      const estimator = new TransactionFeeEstimator(server);

      await expect(estimator.estimate(buildUnsignedTransaction())).rejects.toMatchObject({
        code: ContractErrorCode.SIMULATION_FAILED,
      });

      try {
        await estimator.estimate(buildUnsignedTransaction());
        throw new Error("expected estimate to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ContractExecutionError);
        const message = (err as Error).message;
        expect(message).toContain("Transaction fee estimation failed");
        // Privacy: rejected values must never be echoed back.
        expect(message).not.toContain("GABCDEFGHIJKLMNOP");
        expect(message).not.toContain("5000");
        expect(message).not.toContain("supersecretvalue");
      }
    });

    it("throws when the simulation response has no resource fee", async () => {
      const { server } = makeServer(jest.fn().mockResolvedValue({}));
      const estimator = new TransactionFeeEstimator(server);

      await expect(estimator.estimate(buildUnsignedTransaction())).rejects.toThrow(
        /without a resource fee/
      );
    });

    it("maps RPC transport failures through mapRpcError", async () => {
      const { server } = makeServer(
        jest.fn().mockRejectedValue(new Error("request timeout while simulating"))
      );
      const estimator = new TransactionFeeEstimator(server);

      await expect(estimator.estimate(buildUnsignedTransaction())).rejects.toMatchObject({
        code: ContractErrorCode.RPC_TIMEOUT,
      });
    });

    it("rejects a transaction with no operations", async () => {
      const { server, simulateTransaction } = makeServer(jest.fn().mockResolvedValue(SIM_SUCCESS));
      const estimator = new TransactionFeeEstimator(server);
      const empty = {
        toEnvelope: () => undefined,
        operations: [],
      } as unknown as Transaction;

      await expect(estimator.estimate(empty)).rejects.toMatchObject({
        code: FeeEstimationErrorCode.INVALID_TRANSACTION,
      });
      expect(simulateTransaction).not.toHaveBeenCalled();
    });

    it("rejects a non-Soroban (multi-operation) transaction", async () => {
      const account = new Account(Keypair.random().publicKey(), "1");
      const twoOps = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(new Contract(TEST_CONTRACT_ID).call("private_pay"))
        .addOperation(new Contract(TEST_CONTRACT_ID).call("get_balance"))
        .setTimeout(30)
        .build();
      const { server } = makeServer(jest.fn().mockResolvedValue(SIM_SUCCESS));
      const estimator = new TransactionFeeEstimator(server);

      await expect(estimator.estimate(twoOps)).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects an out-of-range buffer option", async () => {
      const { server } = makeServer(jest.fn().mockResolvedValue(SIM_SUCCESS));
      const estimator = new TransactionFeeEstimator(server, { bufferBps: 20_000 });

      await expect(estimator.estimate(buildUnsignedTransaction())).rejects.toMatchObject({
        code: FeeEstimationErrorCode.INVALID_BUFFER,
      });
    });
  });

  describe("estimateTransactionFee", () => {
    it("is a one-off convenience wrapper around the estimator", async () => {
      const { server } = makeServer(jest.fn().mockResolvedValue(SIM_SUCCESS));

      const estimate = await estimateTransactionFee(server, buildUnsignedTransaction());

      expect(estimate.totalFee).toBe(BigInt(BASE_FEE) + 1234n);
    });
  });

  describe("estimatePreparedTransactionFee", () => {
    it("does not double-count the resource fee already folded into the transaction", () => {
      const tx = buildAssembledTransaction("100", 1234n);

      const estimate = estimatePreparedTransactionFee(tx);

      expect(estimate.baseFee).toBe(100n);
      expect(estimate.resourceFee).toBe(1234n);
      expect(estimate.bufferFee).toBe(0n);
      expect(estimate.totalFee).toBe(1334n);
    });

    it("applies a safety buffer on top of the prepared total", () => {
      const tx = buildAssembledTransaction("100", 1234n);

      const estimate = estimatePreparedTransactionFee(tx, { bufferBps: 500 }); // +5%

      expect(estimate.bufferFee).toBe(66n); // floor(1334 * 0.05)
      expect(estimate.totalFee).toBe(1400n);
    });

    it("never includes recipient or amount values in its output", () => {
      const tx = buildAssembledTransaction("100", 1234n);

      const estimate = estimatePreparedTransactionFee(tx);

      expect(estimate.breakdown).not.toContain(TEST_RECIPIENT);
      const stringFields = Object.values(estimate).filter(
        (value): value is string => typeof value === "string"
      );
      expect(stringFields.join(" ")).not.toContain(TEST_RECIPIENT);
    });
  });

  describe("PayrollContractWrapper.estimatePrivatePayFee", () => {
    class TestablePayrollContractWrapper extends PayrollContractWrapper {
      public buildInvocationStub = jest.fn();
      public submitInvocationStub = jest.fn();

      protected async buildInvocation(
        method: string,
        args: xdr.ScVal[],
        sourcePublicKey: string,
        network?: string,
        requestId?: string
      ): Promise<PreparedInvocation> {
        return this.buildInvocationStub(method, args, sourcePublicKey, network, requestId);
      }

      protected async submitInvocation(
        prepared: PreparedInvocation,
        signer: ISigner
      ): Promise<xdr.ScVal> {
        return this.submitInvocationStub(prepared, signer);
      }
    }

    let wrapper: TestablePayrollContractWrapper;

    beforeEach(() => {
      wrapper = new TestablePayrollContractWrapper({} as rpc.Server, TEST_CONTRACT_ID);
      wrapper.buildInvocationStub.mockImplementation(
        async (
          method: string,
          _args: unknown[],
          sourcePublicKey: string,
          network?: string,
          requestId?: string
        ) =>
          ({
            method,
            requestId: requestId ?? "req-stub",
            network: network ?? Networks.TESTNET,
            transaction: buildAssembledTransaction("100", 1234n),
          }) satisfies PreparedInvocation
      );
    });

    it("estimates the fee without signing or submitting", async () => {
      const estimate = await wrapper.estimatePrivatePayFee(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT
      );

      expect(wrapper.buildInvocationStub).toHaveBeenCalledTimes(1);
      expect(wrapper.buildInvocationStub.mock.calls[0][0]).toBe("private_pay");
      expect(wrapper.submitInvocationStub).not.toHaveBeenCalled();
      expect(estimate.baseFee).toBe(100n);
      expect(estimate.resourceFee).toBe(1234n);
      expect(estimate.totalFee).toBe(1334n);
    });

    it("encodes the same four XDR arguments as a real submission and forwards the buffer", async () => {
      const estimate = await wrapper.estimatePrivatePayFee(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT,
        Networks.TESTNET,
        { bufferBps: 1_000, requestId: "req-42" }
      );

      const args: unknown[] = wrapper.buildInvocationStub.mock.calls[0][1];
      expect(args).toHaveLength(4);
      expect(wrapper.buildInvocationStub.mock.calls[0][4]).toBe("req-42");
      expect(estimate.bufferFee).toBe(133n);
      expect(estimate.totalFee).toBe(1467n);
    });
  });
});
