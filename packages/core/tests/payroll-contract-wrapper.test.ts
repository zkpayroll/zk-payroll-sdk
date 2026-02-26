import { rpc, xdr, Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
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

  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: Keypair,
    network?: string
  ): Promise<xdr.ScVal> {
    return this.invokeStub(method, args, signer, network);
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
  let signer: Keypair;

  beforeEach(() => {
    const mockServer = {} as rpc.Server;
    wrapper = new TestablePayrollContractWrapper(mockServer, TEST_CONTRACT_ID);
    signer = Keypair.random();
  });

  describe("privatePay", () => {
    it("calls invoke with method name 'private_pay'", async () => {
      await wrapper.privatePay(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        signer
      );

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

    it("defaults to TESTNET when network is not specified", async () => {
      await wrapper.privatePay(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        signer
      );

      expect(wrapper.invokeStub.mock.calls[0][3]).toBe(Networks.TESTNET);
    });

    it("encodes four XDR arguments (recipient, amount, asset, proof)", async () => {
      await wrapper.privatePay(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        signer
      );

      const args: xdr.ScVal[] = wrapper.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(4);
    });

    it("encodes proof as ScVal map with pi_a, pi_b, pi_c, public_signals keys", async () => {
      await wrapper.privatePay(
        TEST_RECIPIENT,
        1000n,
        "native",
        MOCK_PROOF,
        signer
      );

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
});
