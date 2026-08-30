import axios from "axios";
import {
  createTimedRpcServer,
  RPC_TIMING,
  timeAxiosRequest,
  installAxiosTiming,
  AXIOS_TIMING,
  measure,
  computeStats,
} from "../src/network";
import type { NetworkRequestTiming } from "../src/network";

jest.mock("axios", () => {
  const requestUse = jest.fn().mockReturnValue(1);
  const responseUse = jest.fn().mockReturnValue(2);
  return {
    __esModule: true,
    default: {
      request: jest.fn(),
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: requestUse, eject: jest.fn() },
        response: { use: responseUse, eject: jest.fn() },
      },
      defaults: {},
    },
  };
});
const mockedAxios = axios as jest.Mocked<typeof axios>;

const fakeServer = {
  getNetwork: jest
    .fn()
    .mockImplementation(() => Promise.resolve({ passphrase: "Test SDF Network ; September 2015" })),
  getTransaction: jest
    .fn()
    .mockImplementation(() => Promise.resolve({ status: "NOT_FOUND", txHash: "abc" })),
  simulateTransaction: jest.fn().mockImplementation(() => Promise.resolve({ results: [] })),
  failing: jest.fn().mockRejectedValue(new Error("RPC unavailable")),
  someProp: "delegated-value",
};

describe("createTimedRpcServer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("records timing for successful RPC calls and preserves the result", async () => {
    const server = createTimedRpcServer(fakeServer as any);

    const result = await server.getNetwork();

    expect(result).toEqual({ passphrase: "Test SDF Network ; September 2015" });
    const timings = server.getNetworkTimings();
    expect(timings).toHaveLength(1);
    expect(timings[0].operation).toBe("getNetwork");
    expect(timings[0].status).toBe("success");
    expect(timings[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(timings[0].startedAt).toBeLessThanOrEqual(Date.now());
  });

  it("attaches timing metadata to responses as a non-enumerable symbol", async () => {
    const server = createTimedRpcServer(fakeServer as any);

    const result: unknown = await server.getNetwork();

    const attached = (result as any)[RPC_TIMING] as NetworkRequestTiming;
    expect(attached).toBeDefined();
    expect(attached.operation).toBe("getNetwork");
    // Non-enumerable: serialized output is unchanged.
    expect(JSON.stringify(result)).toBe('{"passphrase":"Test SDF Network ; September 2015"}');
  });

  it("records error timing and rethrows the original error", async () => {
    const server = createTimedRpcServer(fakeServer as any);

    await expect((server as any).failing()).rejects.toThrow("RPC unavailable");

    const timings = server.getNetworkTimings();
    expect(timings).toHaveLength(1);
    expect(timings[0].operation).toBe("failing");
    expect(timings[0].status).toBe("error");
    expect(timings[0].error).toBe("RPC unavailable");
  });

  it("invokes the onRequest listener for every call", async () => {
    const received: NetworkRequestTiming[] = [];
    const server = createTimedRpcServer(fakeServer as any, {
      onRequest: (t) => received.push(t),
    });

    await server.getNetwork();
    await server.getTransaction("txhash");
    await server.simulateTransaction({} as any);

    expect(server.getNetworkTimings()).toHaveLength(3);
    expect(received.map((t) => t.operation)).toEqual([
      "getNetwork",
      "getTransaction",
      "simulateTransaction",
    ]);
  });

  it("caps retained records to maxRecords", async () => {
    const server = createTimedRpcServer(fakeServer as any, { maxRecords: 2 });

    await server.getNetwork();
    await server.getTransaction("txhash");
    await server.simulateTransaction({} as any);

    expect(server.getNetworkTimings()).toHaveLength(2);
    expect(server.getNetworkTimings()[0].operation).toBe("getTransaction");
    expect(server.getNetworkTimings()[1].operation).toBe("simulateTransaction");
  });

  it("computes aggregated stats per operation", async () => {
    const server = createTimedRpcServer(fakeServer as any);
    await server.getNetwork();
    await server.getNetwork();
    await server.simulateTransaction({} as any);

    const stats = server.getNetworkTimingStats();
    expect(stats.count).toBe(3);
    expect(stats.byOperation.getNetwork.count).toBe(2);
    expect(stats.byOperation.simulateTransaction.count).toBe(1);
    expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.maxDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.minDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("clears retained records", async () => {
    const server = createTimedRpcServer(fakeServer as any);
    await server.getNetwork();
    expect(server.getNetworkTimings()).toHaveLength(1);

    server.clearNetworkTimings();
    expect(server.getNetworkTimings()).toHaveLength(0);
    expect(server.getNetworkTimingStats().count).toBe(0);
  });

  it("skips attaching metadata when attachToResponse is false", async () => {
    const server = createTimedRpcServer(fakeServer as any, {
      attachToResponse: false,
    });

    const result: unknown = await server.getNetwork();
    expect((result as any)[RPC_TIMING]).toBeUndefined();
    expect(server.getNetworkTimings()).toHaveLength(1);
  });

  it("delegates non-function properties unchanged", async () => {
    const server = createTimedRpcServer(fakeServer as any);
    expect((server as any).someProp).toBe("delegated-value");
  });
});

describe("timeAxiosRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the response together with its timing metadata", async () => {
    mockedAxios.request.mockResolvedValue({
      data: new ArrayBuffer(4),
      status: 200,
      statusText: "OK",
      headers: {},
      config: { url: "https://cdn.example.com/circuit.wasm", method: "get" },
    });

    const received: NetworkRequestTiming[] = [];
    const { response, timing } = await timeAxiosRequest(
      { url: "https://cdn.example.com/circuit.wasm", method: "get" },
      (t) => received.push(t)
    );

    expect(response.status).toBe(200);
    expect(timing.operation).toBe("GET https://cdn.example.com/circuit.wasm");
    expect(timing.status).toBe("success");
    expect(timing.durationMs).toBeGreaterThanOrEqual(0);
    expect(received).toHaveLength(1);
  });

  it("throws the original error and reports error timing on failure", async () => {
    mockedAxios.request.mockRejectedValue(new Error("connection refused"));

    const received: NetworkRequestTiming[] = [];
    await expect(
      timeAxiosRequest({ url: "https://cdn.example.com/missing.wasm" }, (t) => received.push(t))
    ).rejects.toThrow("connection refused");

    expect(received).toHaveLength(1);
    expect(received[0].status).toBe("error");
    expect(received[0].error).toBe("connection refused");
  });
});

describe("installAxiosTiming", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("times success and error requests through global interceptors", async () => {
    const received: NetworkRequestTiming[] = [];
    const uninstall = installAxiosTiming({ onRequest: (t) => received.push(t) });

    const requestUse = (mockedAxios.interceptors.request.use as unknown as jest.Mock).mock;
    const responseUse = (mockedAxios.interceptors.response.use as unknown as jest.Mock).mock;
    const requestFn = requestUse.calls[0][0];
    const [onFulfilled, onRejected] = responseUse.calls[0];

    // Success path
    const successConfig = { url: "https://cdn.example.com/circuit.wasm", method: "get" } as any;
    const outConfig = requestFn(successConfig);
    const response = {
      data: new ArrayBuffer(4),
      status: 200,
      statusText: "OK",
      headers: {},
      config: outConfig,
    } as any;
    onFulfilled(response);

    expect(received).toHaveLength(1);
    expect(received[0].operation).toBe("GET https://cdn.example.com/circuit.wasm");
    expect(received[0].status).toBe("success");
    expect(response[AXIOS_TIMING]).toBeDefined();

    // Error path
    const errorConfig = { url: "https://cdn.example.com/bad.zkey", method: "get" } as any;
    const errOutConfig = requestFn(errorConfig);
    const err = Object.assign(new Error("Network Error"), { config: errOutConfig });
    await expect(onRejected(err)).rejects.toThrow("Network Error");

    expect(received).toHaveLength(2);
    expect(received[1].status).toBe("error");
    expect(received[1].error).toBe("Network Error");

    // Uninstall removes both interceptors
    uninstall();
    expect(mockedAxios.interceptors.request.eject).toHaveBeenCalled();
    expect(mockedAxios.interceptors.response.eject).toHaveBeenCalled();
  });
});

describe("measure / computeStats", () => {
  it("measures an async operation and preserves the result", async () => {
    const { result, timing } = await measure("op", async () => 42);

    expect(result).toBe(42);
    expect(timing.operation).toBe("op");
    expect(timing.status).toBe("success");
    expect(timing.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("measures an operation that rejects", async () => {
    const received: NetworkRequestTiming[] = [];
    await expect(
      measure(
        "op",
        async () => {
          throw new Error("boom");
        },
        { onRequest: (t) => received.push(t) }
      )
    ).rejects.toThrow("boom");

    expect(received).toHaveLength(1);
    expect(received[0].status).toBe("error");
    expect(received[0].error).toBe("boom");
  });

  it("computes stats with per-operation breakdowns", () => {
    const records: NetworkRequestTiming[] = [
      { operation: "getNetwork", startedAt: 1, durationMs: 10, status: "success" },
      { operation: "getNetwork", startedAt: 2, durationMs: 20, status: "success" },
      { operation: "getTransaction", startedAt: 3, durationMs: 30, status: "error", error: "x" },
    ];

    const stats = computeStats(records);
    expect(stats.count).toBe(3);
    expect(stats.avgDurationMs).toBe(20);
    expect(stats.minDurationMs).toBe(10);
    expect(stats.maxDurationMs).toBe(30);
    expect(stats.byOperation.getNetwork.avgDurationMs).toBe(15);
  });

  it("never includes payload values in timing records", async () => {
    const received: NetworkRequestTiming[] = [];
    const server = createTimedRpcServer(fakeServer as any, {
      onRequest: (t) => received.push(t),
    });
    await server.getTransaction("SOMEPRIVATEHASHVALUE");

    const serialized = JSON.stringify(received);
    expect(serialized).not.toContain("SOMEPRIVATEHASHVALUE");
  });
});
