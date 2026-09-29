import axios from "axios";
import { rpc } from "@stellar/stellar-sdk";
import { TransactionWatcher } from "../src/events";
import { timeAxiosRequest } from "../src/network";
import { REQUEST_ID_HEADER } from "../src/core/request-id";
import { ValidationError } from "../src/core/errors";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    request: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    defaults: {},
  },
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;

const NOT_FOUND = {
  status: rpc.Api.GetTransactionStatus.NOT_FOUND,
} as rpc.Api.GetMissingTransactionResponse;

function serverReturning(response: rpc.Api.GetTransactionResponse): rpc.Server {
  return { getTransaction: jest.fn().mockResolvedValue(response) } as unknown as rpc.Server;
}

describe("TransactionWatcher request id propagation (#535)", () => {
  it("includes the request id in timeout events and the error message", async () => {
    const watcher = new TransactionWatcher(serverReturning(NOT_FOUND));
    const timeouts: unknown[] = [];
    watcher.on("timeout", (e) => timeouts.push(e));

    await expect(
      watcher.waitForConfirmation("tx_1", { pollIntervalMs: 1, maxPolls: 2, requestId: "req_abc" })
    ).rejects.toThrow("[requestId: req_abc]");
    expect(timeouts).toEqual([{ txHash: "tx_1", attempts: 2, requestId: "req_abc" }]);
  });

  it("includes the request id in cancelled events", async () => {
    const watcher = new TransactionWatcher(serverReturning(NOT_FOUND));
    const cancelled: unknown[] = [];
    watcher.on("cancelled", (e) => cancelled.push(e));
    const controller = new AbortController();
    controller.abort();

    await expect(
      watcher.waitForConfirmation("tx_2", { signal: controller.signal, requestId: "corr_1" })
    ).rejects.toThrow("[requestId: corr_1]");
    expect(cancelled).toEqual([{ txHash: "tx_2", requestId: "corr_1" }]);
  });

  it("rejects a malformed request id before polling, without echoing it", async () => {
    const server = serverReturning(NOT_FOUND);
    const watcher = new TransactionWatcher(server);
    const polls = jest.fn();
    watcher.on("polling", polls);

    const err = await watcher
      .waitForConfirmation("tx_3", { pollIntervalMs: 1, requestId: "salary 95000" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).not.toContain("95000");
    expect(polls).not.toHaveBeenCalled();
    expect(server.getTransaction).not.toHaveBeenCalled();
  });
});

describe("timeAxiosRequest request id propagation (#535)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends X-Request-Id and records it on the timing", async () => {
    mockedAxios.request.mockResolvedValue({
      status: 200,
      data: null,
      headers: {},
      config: {},
    } as never);

    const { timing } = await timeAxiosRequest(
      { url: "https://cdn.example.com/circuit.zkey", method: "get", headers: { Accept: "*/*" } },
      undefined,
      "req_123"
    );

    const sent = mockedAxios.request.mock.calls[0][0];
    expect(sent.headers).toEqual({ Accept: "*/*", [REQUEST_ID_HEADER]: "req_123" });
    expect(timing.requestId).toBe("req_123");
  });

  it("records the request id on error timings too", async () => {
    mockedAxios.request.mockRejectedValue(new Error("503"));
    const timings: unknown[] = [];
    await expect(
      timeAxiosRequest(
        { url: "https://cdn.example.com/x", method: "get" },
        (t) => timings.push(t),
        "req_9"
      )
    ).rejects.toThrow("503");
    expect(timings[0]).toMatchObject({ status: "error", requestId: "req_9" });
  });

  it("leaves requests untouched when no request id is given", async () => {
    mockedAxios.request.mockResolvedValue({
      status: 200,
      data: null,
      headers: {},
      config: {},
    } as never);
    const config = { url: "https://cdn.example.com/y", method: "get" as const };
    const { timing } = await timeAxiosRequest(config);
    expect(mockedAxios.request.mock.calls[0][0]).toBe(config);
    expect(timing.requestId).toBeUndefined();
  });
});
