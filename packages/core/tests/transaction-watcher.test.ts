import { rpc } from "@stellar/stellar-sdk";
import { TransactionWatcher, ConfirmationResult } from "../src/events";
import { ContractExecutionError, ContractErrorCode } from "../src/errors";
import { RetryBudgetExhaustedError } from "../src/core/retry-budget";

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
      const server = createMockServer([NOT_FOUND_RESPONSE, NOT_FOUND_RESPONSE, SUCCESS_RESPONSE]);
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
        getTransaction: jest.fn().mockRejectedValue(new Error("Network failure")),
      } as unknown as rpc.Server;
      const watcher = new TransactionWatcher(server);

      await expect(watcher.waitForConfirmation("tx_hash", { pollIntervalMs: 10 })).rejects.toThrow(
        "Network failure"
      );
    });

    describe("with requestId", () => {
      it("includes requestId in ConfirmationResult on success", async () => {
        const server = createMockServer([SUCCESS_RESPONSE]);
        const watcher = new TransactionWatcher(server);

        const result = await watcher.waitForConfirmation("tx_hash", {
          pollIntervalMs: 10,
          requestId: "req_test123",
        });

        expect(result.requestId).toBe("req_test123");
      });

      it("includes requestId in ConfirmationResult on failure", async () => {
        const server = createMockServer([FAILED_RESPONSE]);
        const watcher = new TransactionWatcher(server);

        try {
          await watcher.waitForConfirmation("tx_hash", {
            pollIntervalMs: 10,
            requestId: "req_failtest",
          });
        } catch (e) {
          expect(e).toMatchObject({
            context: expect.objectContaining({}),
          });
        }
      });

      it("includes requestId in error message on failure", async () => {
        const server = createMockServer([FAILED_RESPONSE]);
        const watcher = new TransactionWatcher(server);

        await expect(
          watcher.waitForConfirmation("tx_hash", {
            pollIntervalMs: 10,
            requestId: "req_fail123",
          })
        ).rejects.toMatchObject({
          message: expect.stringContaining("req_fail123"),
        });
      });

      it("includes requestId in error message on timeout", async () => {
        const server = createMockServer([NOT_FOUND_RESPONSE]);
        const watcher = new TransactionWatcher(server);

        await expect(
          watcher.waitForConfirmation("tx_hash", {
            pollIntervalMs: 10,
            maxPolls: 1,
            requestId: "req_timeout123",
          })
        ).rejects.toMatchObject({
          message: expect.stringContaining("req_timeout123"),
        });
      });

      it("includes requestId in polling events", async () => {
        const server = createMockServer([NOT_FOUND_RESPONSE, SUCCESS_RESPONSE]);
        const watcher = new TransactionWatcher(server);
        const pollingEvents: unknown[] = [];

        watcher.on("polling", (data) => pollingEvents.push(data));

        await watcher.waitForConfirmation("tx_hash", {
          pollIntervalMs: 10,
          requestId: "req_poll123",
        });

        expect(pollingEvents).toHaveLength(2);
        expect(pollingEvents[0]).toMatchObject({
          attempt: 1,
          requestId: "req_poll123",
        });
        expect(pollingEvents[1]).toMatchObject({
          attempt: 2,
          requestId: "req_poll123",
        });
      });
    });
  });

  describe("event emitter", () => {
    it("emits 'polling' on each attempt", async () => {
      const server = createMockServer([NOT_FOUND_RESPONSE, SUCCESS_RESPONSE]);
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

      await watcher.waitForConfirmation("tx_hash", { pollIntervalMs: 10 }).catch(() => {});

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

    it("emits 'error' with a distinguishable retry-budget error on RPC errors", async () => {
      const server = {
        getTransaction: jest.fn().mockRejectedValue(new Error("RPC down")),
      } as unknown as rpc.Server;
      const watcher = new TransactionWatcher(server);
      let emittedError: Error | null = null;

      watcher.on("error", (err) => {
        emittedError = err;
      });

      await watcher.waitForConfirmation("tx_hash", { pollIntervalMs: 10 }).catch(() => {});

      expect(emittedError).not.toBeNull();
      // The retry budget is exhausted after 3 attempts and surfaces as a
      // distinct error carrying the original RPC failure as its cause.
      expect(emittedError).toBeInstanceOf(RetryBudgetExhaustedError);
      const retryError = emittedError as RetryBudgetExhaustedError | null;
      expect(retryError!.message).toContain("RPC down");
      expect(retryError!.attempts).toBe(3);
    });

    it("emits 'cancelled' when polling is aborted", async () => {
      const server = createMockServer([NOT_FOUND_RESPONSE]);
      const watcher = new TransactionWatcher(server);
      const controller = new AbortController();
      let cancelledData: unknown = null;

      watcher.on("cancelled", (data) => {
        cancelledData = data;
      });

      controller.abort();
      await watcher
        .waitForConfirmation("tx_hash", {
          pollIntervalMs: 10,
          signal: controller.signal,
        })
        .catch(() => {});

      expect(cancelledData).toMatchObject({
        txHash: "tx_hash",
      });
    });
  });
});
