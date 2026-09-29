import { Keypair, rpc, StrKey } from "@stellar/stellar-sdk";
import { checkEmployerReadiness } from "../src/employer-readiness";
import { validateEnvironment } from "../src/sanity";

jest.mock("../src/sanity", () => ({
  validateEnvironment: jest.fn(),
}));

const mockValidateEnvironment = validateEnvironment as jest.MockedFunction<
  typeof validateEnvironment
>;

describe("checkEmployerReadiness", () => {
  const signer = Keypair.random();
  const config = {
    networkUrl: "https://soroban-testnet.stellar.org",
    contractId: StrKey.encodeContract(Buffer.alloc(32, 1)),
  };
  let getAccount: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateEnvironment.mockResolvedValue({
      isValid: true,
      diagnostics: [
        { component: "rpc", status: "success", message: "RPC available" },
        { component: "contract", status: "success", message: "Contract available" },
      ],
    });
    getAccount = jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue({} as never);
  });

  afterEach(() => {
    getAccount.mockRestore();
  });

  it("reports ready when the employer signer, account, RPC, and contract checks pass", async () => {
    const result = await checkEmployerReadiness({
      config,
      employerAddress: signer.publicKey(),
      signer,
    });

    expect(result.status).toBe("ready");
    expect(result.canProceed).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual([
      "employer",
      "signer",
      "configuration",
      "rpc",
      "contract",
      "account",
    ]);
    expect(getAccount).toHaveBeenCalledWith(signer.publicKey());
  });

  it("blocks an employer account that does not exist without returning raw RPC details", async () => {
    getAccount.mockRejectedValue(new Error("Account not found; salary=987654321"));

    const result = await checkEmployerReadiness({
      config,
      employerAddress: signer.publicKey(),
      signer,
    });

    expect(result.status).toBe("blocked");
    expect(result.canProceed).toBe(false);
    expect(result.checks[0]).toMatchObject({
      id: "account",
      code: "EMPLOYER_ACCOUNT_NOT_FOUND",
      status: "blocked",
    });
    expect(JSON.stringify(result)).not.toContain("987654321");
    expect(JSON.stringify(result)).not.toContain("salary");
  });

  it("blocks a signer that does not match the employer address before making network calls", async () => {
    const otherSigner = Keypair.random();

    const result = await checkEmployerReadiness({
      config,
      employerAddress: signer.publicKey(),
      signer: otherSigner,
    });

    expect(result).toMatchObject({ status: "blocked", canProceed: false });
    expect(result.checks[0]).toMatchObject({
      id: "signer",
      code: "EMPLOYER_SIGNER_MISMATCH",
      status: "blocked",
    });
    expect(mockValidateEnvironment).not.toHaveBeenCalled();
    expect(getAccount).not.toHaveBeenCalled();
  });
});
