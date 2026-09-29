import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import { PreflightClient } from "../src/clients/PreflightClient";
import { ContractExecutionError, ContractErrorCode } from "../src/errors";

describe("PreflightClient", () => {
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 1));
  const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
  const signer = Keypair.random();

  it("should return success when simulation passes", async () => {
    // Mock the server
    const mockServer = {
      getAccount: jest.fn().mockResolvedValue({
        accountId: () => signer.publicKey(),
        sequenceNumber: () => "123",
        incrementSequenceNumber: jest.fn(),
      }),
      simulateTransaction: jest.fn().mockResolvedValue({
        // Minimal mock simulation success
        transactionData: {
          build: () => "mock_auth_entries",
        },
        results: [
          {
            auth: [],
          },
        ],
      }),
    };

    const client = new PreflightClient(mockServer as any, contractId);

    // We expect the assembleTransaction to fail in a real mock if it's too barebones,
    // but we can mock the internal buildInvocation for a simpler test of the client logic.
    jest.spyOn(client as any, "buildInvocation").mockResolvedValue({
      method: "execute",
      requestId: "req-123",
      network: Networks.TESTNET,
      transaction: {} as any,
    });

    const result = await client.preflightExecute(
      {
        recipient: Keypair.random().publicKey(),
        amount: 1000n,
        asset,
        memo: "payroll",
      },
      signer.publicKey()
    );

    expect(result.canProceed).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.prepared).toBeDefined();
  });

  it("should capture execution blockers as findings without exposing sensitive data (edge case)", async () => {
    const client = new PreflightClient({} as any, contractId);

    const mockError = new ContractExecutionError(
      'Simulation failed for "execute": INSUFFICIENT_FUNDS',
      ContractErrorCode.SIMULATION_FAILED,
      { requestId: "req-123" }
    );
    jest.spyOn(client as any, "buildInvocation").mockRejectedValue(mockError);

    const result = await client.preflightExecute(
      {
        recipient: Keypair.random().publicKey(),
        amount: 10000000000000n, // Huge amount
        asset,
      },
      signer.publicKey()
    );

    expect(result.canProceed).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      code: "SIMULATION_FAILED",
      severity: "error",
      message: mockError.message,
    });
  });
});
