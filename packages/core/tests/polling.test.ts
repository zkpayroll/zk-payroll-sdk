import { rpc } from "@stellar/stellar-sdk";
import { pollTransaction } from "../src/polling";
import { ContractExecutionError, ContractErrorCode } from "../src/errors";

function createMockServer(responses: rpc.Api.GetTransactionResponse[]): rpc.Server {
  let callIndex = 0;
  return {
    getTransaction: jest.fn().mockImplementation(() => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return Promise.resolve(response);
    }),
  } as unknown as rpc.Server;
}

const SUCCESS_RESPONSE = {
  status: rpc.Api.GetTransactionStatus.SUCCESS,
  ledger: 12345,
  returnValue: undefined,
  createdAt: "2024-01-01T00:00:00Z",
  oldestLedger: 1,
  oldestLedgerCloseTime: "2024-01-01T00:00:00Z",
  latestLedger: 12345,
  latestLedgerCloseTime: "2024-01-01T00:00:00Z",
  envelopeXdr: {} as never,
  resultXdr: {} as never,
  resultMetaXdr: {} as never,
} as unknown as rpc.Api.GetSuccessfulTransactionResponse;

const FAILED_RESPONSE = {
  status: rpc.Api.GetTransactionStatus.FAILED,
} as rpc.Api.GetFailedTransactionResponse;

const NOT_FOUND_RESPONSE = {
  status: rpc.Api.GetTransactionStatus.NOT_FOUND,
} as rpc.Api.GetMissingTransactionResponse;

describe("pollTransaction", () => {
  it("returns SUCCESS status on successful transaction", async () => {
    const server = createMockServer([SUCCESS_RESPONSE]);

    const result = await pollTransaction(server, "tx_hash_123", {
      intervalMs: 10,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.txHash).toBe("tx_hash_123");
    if (result.status === "SUCCESS") {
      expect(result.ledger).toBe(12345);
    }
  });

  it("returns FAILED status on failed transaction", async () => {
    const server = createMockServer([FAILED_RESPONSE]);

    const result = await pollTransaction(server, "tx_hash_fail", {
      intervalMs: 10,
    });

    expect(result.status).toBe("FAILED");
    expect(result.txHash).toBe("tx_hash_fail");
  });

  it("polls until transaction is found", async () => {
    const server = createMockServer([NOT_FOUND_RESPONSE, NOT_FOUND_RESPONSE, SUCCESS_RESPONSE]);

    const result = await pollTransaction(server, "tx_hash_123", {
      intervalMs: 10,
    });

    expect(result.status).toBe("SUCCESS");
    expect(server.getTransaction).toHaveBeenCalledTimes(3);
  });

  it("throws ContractExecutionError on timeout", async () => {
    const server = createMockServer([NOT_FOUND_RESPONSE]);

    await expect(
      pollTransaction(server, "tx_hash_timeout", {
        timeoutMs: 30, // short timeout
        intervalMs: 10,
      })
    ).rejects.toThrow(ContractExecutionError);

    await expect(
      pollTransaction(server, "tx_hash_timeout", {
        timeoutMs: 30,
        intervalMs: 10,
      })
    ).rejects.toMatchObject({
      code: ContractErrorCode.TRANSACTION_TIMEOUT,
    });
  });

  it("throws Error if cancelled via AbortSignal", async () => {
    const server = createMockServer([NOT_FOUND_RESPONSE]);
    const controller = new AbortController();

    const promise = pollTransaction(server, "tx_hash_cancel", {
      intervalMs: 50,
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow("cancelled");
  });

  it("propagates RPC errors", async () => {
    const server = {
      getTransaction: jest.fn().mockRejectedValue(new Error("RPC Network failure")),
    } as unknown as rpc.Server;

    await expect(pollTransaction(server, "tx_hash", { intervalMs: 10 })).rejects.toThrow(
      "RPC Network failure"
    );
  });
});
