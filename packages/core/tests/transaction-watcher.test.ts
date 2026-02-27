import { rpc } from "@stellar/stellar-sdk";
import { TransactionWatcher, ConfirmationResult } from "../src/events";
import { ContractExecutionError, ContractErrorCode } from "../src/errors";

function createMockServer(
  responses: rpc.Api.GetTransactionResponse[]
): rpc.Server {
  let callIndex = 0;
  return {
    getTransaction: jest.fn().mockImplementation(() => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return Promise.resolve(response);
    }),
  } as unknown as rpc.Server;
}

const SUCCESS_RESPONSE: rpc.Api.GetSuccessfulTransactionResponse = {
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

describe("TransactionWatcher", () => {
  describe("waitForConfirmation", () => {
    it("returns ConfirmationResult on successful transaction", async () => {
      const server = createMockServer([SUCCESS_RESPONSE]);
      const watcher = new TransactionWatcher(server);

      const result = await watcher.waitForConfirmation("tx_hash_123", {
        pollIntervalMs: 10,
      });

      expect(result.status).toBe("SUCCESS");
      expect(result.txHash).toBe("tx_hash_123");
      expect(result.ledger).toBe(12345);
    });

    it("polls until transaction is found", async () => {
      const server = createMockServer([
        NOT_FOUND_RESPONSE,
        NOT_FOUND_RESPONSE,
        SUCCESS_RESPONSE,
      ]);
      const watcher = new TransactionWatcher(server);

      const result = await watcher.waitForConfirmation("tx_hash_123", {
        pollIntervalMs: 10,
      });

      expect(result.status).toBe("SUCCESS");
      expect(server.getTransaction).toHaveBeenCalledTimes(3);
    });

    it("throws ContractExecutionError on failed transaction", async () => {
      const server = createMockServer([FAILED_RESPONSE]);
      const watcher = new TransactionWatcher(server);

      await expect(
        watcher.waitForConfirmation("tx_hash_fail", { pollIntervalMs: 10 })
      ).rejects.toThrow(ContractExecutionError);

      await expect(
        watcher.waitForConfirmation("tx_hash_fail", { pollIntervalMs: 10 })
      ).rejects.toMatchObject({
        code: ContractErrorCode.CONTRACT_REVERT,
      });
    });

    it("throws ContractExecutionError on timeout", async () => {
      const server = createMockServer([NOT_FOUND_RESPONSE]);
      const watcher = new TransactionWatcher(server);

      await expect(
        watcher.waitForConfirmation("tx_hash_timeout", {
          pollIntervalMs: 10,
          maxPolls: 3,
        })
      ).rejects.toThrow(ContractExecutionError);

      await expect(
        watcher.waitForConfirmation("tx_hash_timeout", {
          pollIntervalMs: 10,
          maxPolls: 3,
        })
      ).rejects.toMatchObject({
        code: ContractErrorCode.TRANSACTION_TIMEOUT,
      });
    });

    it("throws on RPC errors", async () => {
      const server = {
        getTransaction: jest
          .fn()
          .mockRejectedValue(new Error("Network failure")),
      } as unknown as rpc.Server;
      const watcher = new TransactionWatcher(server);

      await expect(
        watcher.waitForConfirmation("tx_hash", { pollIntervalMs: 10 })
      ).rejects.toThrow("Network failure");
    });
  });

  describe("event emitter", () => {
    it("emits 'polling' on each attempt", async () => {
      const server = createMockServer([
        NOT_FOUND_RESPONSE,
        SUCCESS_RESPONSE,
      ]);
      const watcher = new TransactionWatcher(server);
      const pollingEvents: unknown[] = [];

      watcher.on("polling", (data) => pollingEvents.push(data));

      await watcher.waitForConfirmation("tx_hash", { pollIntervalMs: 10 });

      expect(pollingEvents).toHaveLength(2);
      expect(pollingEvents[0]).toMatchObject({ attempt: 1 });
      expect(pollingEvents[1]).toMatchObject({ attempt: 2 });
    });

    it("emits 'confirmed' on success", async () => {
      const server = createMockServer([SUCCESS_RESPONSE]);
      const watcher = new TransactionWatcher(server);
      let confirmedResult: ConfirmationResult | null = null;

      watcher.on("confirmed", (result) => {
        confirmedResult = result;
      });

      await watcher.waitForConfirmation("tx_hash", { pollIntervalMs: 10 });

      expect(confirmedResult).not.toBeNull();
      expect(confirmedResult!.status).toBe("SUCCESS");
    });

    it("emits 'confirmed' with FAILED status on chain failure", async () => {
      const server = createMockServer([FAILED_RESPONSE]);
      const watcher = new TransactionWatcher(server);
      let confirmedResult: ConfirmationResult | null = null;

      watcher.on("confirmed", (result) => {
        confirmedResult = result;
      });

      await watcher
        .waitForConfirmation("tx_hash", { pollIntervalMs: 10 })
        .catch(() => {});

      expect(confirmedResult).not.toBeNull();
      expect(confirmedResult!.status).toBe("FAILED");
    });

    it("emits 'timeout' when max polls exceeded", async () => {
      const server = createMockServer([NOT_FOUND_RESPONSE]);
      const watcher = new TransactionWatcher(server);
      let timeoutData: unknown = null;

      watcher.on("timeout", (data) => {
        timeoutData = data;
      });

      await watcher
        .waitForConfirmation("tx_hash", {
          pollIntervalMs: 10,
          maxPolls: 2,
        })
        .catch(() => {});

      expect(timeoutData).toMatchObject({
        txHash: "tx_hash",
        attempts: 2,
      });
    });

    it("emits 'error' on RPC errors", async () => {
      const server = {
        getTransaction: jest
          .fn()
          .mockRejectedValue(new Error("RPC down")),
      } as unknown as rpc.Server;
      const watcher = new TransactionWatcher(server);
      let emittedError: Error | null = null;

      watcher.on("error", (err) => {
        emittedError = err;
      });

      await watcher
        .waitForConfirmation("tx_hash", { pollIntervalMs: 10 })
        .catch(() => {});

      expect(emittedError).not.toBeNull();
      expect(emittedError!.message).toBe("RPC down");
    });
  });
});
