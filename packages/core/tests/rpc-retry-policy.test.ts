import { ValidationError } from "../src/core/errors";
import { withRpcRetry } from "../src/network/rpcRetry";

describe("withRpcRetry", () => {
  it("uses bounded exponential backoff for transient failures", async () => {
    const delays: number[] = [];
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValue("ok");
    await expect(
      withRpcRetry(operation, {
        baseDelayMs: 100,
        maxDelayMs: 150,
        jitter: false,
        sleep: async (delay) => {
          delays.push(delay);
        },
      })
    ).resolves.toBe("ok");
    expect(delays).toEqual([100, 150]);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry validation failures", async () => {
    const operation = jest
      .fn()
      .mockRejectedValue(new ValidationError("Invalid input", "recipient"));
    await expect(withRpcRetry(operation, { sleep: async () => undefined })).rejects.toThrow(
      "Invalid input"
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid jitter source before scheduling a retry", async () => {
    const sleep = jest.fn(async () => undefined);
    await expect(
      withRpcRetry(
        async () => {
          throw new Error("ECONNRESET");
        },
        { random: () => 2, sleep }
      )
    ).rejects.toThrow("random must return a number between 0 and 1");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops before starting when its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = jest.fn(async () => "ok");
    await expect(withRpcRetry(operation, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(operation).not.toHaveBeenCalled();
  });
});
