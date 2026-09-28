import { rpc } from "@stellar/stellar-sdk";
import { pollTransaction } from "../../src/polling";
import { OperationCancelledError } from "../../src/cancellation";

const SUCCESS = rpc.Api.GetTransactionStatus.SUCCESS;
const NOT_FOUND = rpc.Api.GetTransactionStatus.NOT_FOUND;

function makeServer(impl: (hash: string) => Promise<unknown>): rpc.Server {
  return { getTransaction: impl } as unknown as rpc.Server;
}

describe("pollTransaction cancellation", () => {
  it("returns SUCCESS when the transaction lands (happy path)", async () => {
    const server = makeServer(async () => ({ status: SUCCESS, ledger: 100 }));

    const result = await pollTransaction(server, "tx-abc", {
      timeoutMs: 5000,
      intervalMs: 10,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.txHash).toBe("tx-abc");
  });

  it("rejects with OperationCancelledError when aborted mid-poll (edge case)", async () => {
    const controller = new AbortController();
    const server = makeServer(async () => ({ status: NOT_FOUND }));

    const promise = pollTransaction(server, "tx-secret-hash", {
      timeoutMs: 60_000,
      intervalMs: 1000,
      signal: controller.signal,
    });

    // Abort before the first interval elapses.
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("does not leak the txHash in the cancellation message", async () => {
    const controller = new AbortController();
    controller.abort();
    const server = makeServer(async () => ({ status: NOT_FOUND }));

    try {
      await pollTransaction(server, "tx-secret-hash", {
        timeoutMs: 60_000,
        intervalMs: 1000,
        signal: controller.signal,
      });
      throw new Error("expected rejection");
    } catch (err) {
      const e = err as OperationCancelledError;
      expect(e).toBeInstanceOf(OperationCancelledError);
      expect(e.code).toBe("OPERATION_CANCELLED");
      expect(e.message).toContain("pollTransaction");
      expect(e.message).not.toContain("tx-secret-hash");
    }
  });
});
