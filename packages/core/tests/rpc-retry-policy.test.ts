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
});
