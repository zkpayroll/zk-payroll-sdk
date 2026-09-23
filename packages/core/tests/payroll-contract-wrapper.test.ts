import { rpc, xdr, Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import type { ISigner } from "../src/signer/types";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
import type { InvokeOptions, PreparedInvocation } from "../src/adapters/BaseContractWrapper";
import { ProofPayload } from "../src/crypto/IProofGenerator";

// Generate valid Stellar IDs for testing
const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TEST_RECIPIENT = Keypair.random().publicKey();

/**
 * Testable subclass that intercepts the protected invoke() method
 * so we can verify argument encoding without hitting a real network.
 */
class TestablePayrollContractWrapper extends PayrollContractWrapper {
  public invokeStub = jest.fn().mockResolvedValue(xdr.ScVal.scvVoid());
  public buildInvocationStub = jest.fn();
  public submitInvocationStub = jest.fn().mockResolvedValue(xdr.ScVal.scvVoid());

  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: ISigner,
    network?: string,
    options?: InvokeOptions
  ): Promise<xdr.ScVal> {
    return this.invokeStub(method, args, signer, network, options);
  }

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

describe("PayrollContractWrapper", () => {
  let wrapper: TestablePayrollContractWrapper;
  let signer: ISigner;

  beforeEach(() => {
    const mockServer = {} as rpc.Server;
    wrapper = new TestablePayrollContractWrapper(mockServer, TEST_CONTRACT_ID);
    signer = {
      getPublicKey: jest.fn().mockResolvedValue(TEST_RECIPIENT),
      sign: jest.fn().mockImplementation(async (tx) => tx),
    };
    wrapper.buildInvocationStub.mockImplementation(
      async (
        method: string,
        args: unknown[],
        sourcePublicKey: string,
        network?: string,
        requestId?: string
      ) =>
        ({
          method,
          requestId: requestId ?? "req-stub",
          network: network ?? Networks.TESTNET,
          transaction: {} as unknown as PreparedInvocation["transaction"],
        }) satisfies PreparedInvocation
    );
  });

  describe("privatePay", () => {
    it("calls invoke with method name 'private_pay'", async () => {
      await wrapper.privatePay(TEST_RECIPIENT, 1000n, "native", MOCK_PROOF, signer);

      expect(wrapper.invokeStub).toHaveBeenCalledTimes(1);
      expect(wrapper.invokeStub.mock.calls[0][0]).toBe("private_pay");
    });

    it("passes signer and network through to invoke", async () => {
      await wrapper.privatePay(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        signer,
        Networks.PUBLIC
      );

      expect(wrapper.invokeStub.mock.calls[0][2]).toBe(signer);
      expect(wrapper.invokeStub.mock.calls[0][3]).toBe(Networks.PUBLIC);
    });

    it("forwards idempotency options to invoke", async () => {
      await wrapper.privatePay(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        signer,
        Networks.TESTNET,
        {
          idempotencyKey: "req-1",
        }
      );

      expect(wrapper.invokeStub.mock.calls[0][4]).toEqual({
        idempotencyKey: "req-1",
      });
    });

    it("defaults to TESTNET when network is not specified", async () => {
      await wrapper.privatePay(TEST_RECIPIENT, 1000n, "native", MOCK_PROOF, signer);

      expect(wrapper.invokeStub.mock.calls[0][3]).toBe(Networks.TESTNET);
    });

    it("encodes four XDR arguments (recipient, amount, asset, proof)", async () => {
      await wrapper.privatePay(TEST_RECIPIENT, 1000n, "native", MOCK_PROOF, signer);

      const args: xdr.ScVal[] = wrapper.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(4);
    });

    it("encodes proof as ScVal map with pi_a, pi_b, pi_c, public_signals keys", async () => {
      await wrapper.privatePay(TEST_RECIPIENT, 1000n, "native", MOCK_PROOF, signer);

      const args: xdr.ScVal[] = wrapper.invokeStub.mock.calls[0][1];
      const proofArg = args[3];

      // The proof should be an scvMap
      expect(proofArg.switch().name).toBe("scvMap");

      const mapEntries = proofArg.map()!;
      expect(mapEntries).toHaveLength(4);

      const keys = mapEntries.map((entry) => {
        const sym = entry.key();
        return sym.sym().toString();
      });
      expect(keys).toEqual(["pi_a", "pi_b", "pi_c", "public_signals"]);
    });
  });

  describe("getBalance", () => {
    it("calls invoke with method name 'get_balance'", async () => {
      await wrapper.getBalance(TEST_RECIPIENT, signer);

      expect(wrapper.invokeStub).toHaveBeenCalledTimes(1);
      expect(wrapper.invokeStub.mock.calls[0][0]).toBe("get_balance");
    });

    it("encodes one XDR argument (address)", async () => {
      await wrapper.getBalance(TEST_RECIPIENT, signer);

      const args: xdr.ScVal[] = wrapper.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(1);
    });
  });

  describe("buildPrivatePayInvocation (#187)", () => {
    it("calls buildInvocation with method name 'private_pay'", async () => {
      await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT
      );

      expect(wrapper.buildInvocationStub).toHaveBeenCalledTimes(1);
      expect(wrapper.buildInvocationStub.mock.calls[0][0]).toBe("private_pay");
    });

    it("passes the source public key and network through to buildInvocation", async () => {
      await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT,
        Networks.PUBLIC,
        "req-42"
      );

      expect(wrapper.buildInvocationStub.mock.calls[0][2]).toBe(TEST_RECIPIENT);
      expect(wrapper.buildInvocationStub.mock.calls[0][3]).toBe(Networks.PUBLIC);
      expect(wrapper.buildInvocationStub.mock.calls[0][4]).toBe("req-42");
    });

    it("encodes the same four XDR arguments as privatePay (recipient, amount, asset, proof)", async () => {
      await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT
      );

      const args: xdr.ScVal[] = wrapper.buildInvocationStub.mock.calls[0][1];
      expect(args).toHaveLength(4);
      expect(args[3].switch().name).toBe("scvMap");
    });

    it("never signs or submits -- it does not call invoke or submitInvocation", async () => {
      await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT
      );

      expect(wrapper.invokeStub).not.toHaveBeenCalled();
      expect(wrapper.submitInvocationStub).not.toHaveBeenCalled();
    });

    it("returns the PreparedInvocation produced by buildInvocation", async () => {
      const prepared = await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT
      );

      expect(prepared.method).toBe("private_pay");
      expect(prepared.requestId).toBe("req-stub");
    });
  });

  describe("submitPrivatePayInvocation (#187)", () => {
    it("delegates to submitInvocation with the prepared invocation and signer", async () => {
      const prepared = await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT
      );

      await wrapper.submitPrivatePayInvocation(prepared, signer);

      expect(wrapper.submitInvocationStub).toHaveBeenCalledTimes(1);
      expect(wrapper.submitInvocationStub.mock.calls[0][0]).toBe(prepared);
    });

    it("never calls buildInvocation itself -- building and submitting are separate steps", async () => {
      const prepared = await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT
      );
      wrapper.buildInvocationStub.mockClear();

      await wrapper.submitPrivatePayInvocation(prepared, signer);

      expect(wrapper.buildInvocationStub).not.toHaveBeenCalled();
    });

    it("supports retry-safe usage: rebuilding after a failed submission does not resubmit the old prepared invocation", async () => {
      const firstPrepared = await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT,
        Networks.TESTNET,
        "attempt-1"
      );

      wrapper.submitInvocationStub.mockRejectedValueOnce(new Error("submission failed"));
      await expect(wrapper.submitPrivatePayInvocation(firstPrepared, signer)).rejects.toThrow(
        "submission failed"
      );

      // Caller explicitly rebuilds (fresh sequence number) rather than
      // resubmitting the same prepared invocation blindly.
      wrapper.buildInvocationStub.mockResolvedValueOnce({
        method: "private_pay",
        requestId: "attempt-2",
        network: Networks.TESTNET,
        transaction: {} as unknown as PreparedInvocation["transaction"],
      });
      const secondPrepared = await wrapper.buildPrivatePayInvocation(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        TEST_RECIPIENT,
        Networks.TESTNET,
        "attempt-2"
      );

      await wrapper.submitPrivatePayInvocation(secondPrepared, signer);

      expect(wrapper.submitInvocationStub).toHaveBeenCalledTimes(2);
      expect(wrapper.submitInvocationStub.mock.calls[0][0].requestId).toBe("attempt-1");
      expect(wrapper.submitInvocationStub.mock.calls[1][0].requestId).toBe("attempt-2");
    });
  });
});
