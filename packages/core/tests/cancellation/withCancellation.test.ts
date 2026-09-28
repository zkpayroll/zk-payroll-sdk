import {
  OperationCancelledError,
  cancellableDelay,
  throwIfAborted,
  withCancellation,
} from "../../src/cancellation";

describe("cancellation helpers", () => {
  it("passes through when no signal is supplied (happy path)", async () => {
    const value = await withCancellation("fetchBalance", undefined, async () => 42);
    expect(value).toBe(42);
  });

  it("rejects immediately if the signal is already aborted (edge case)", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      withCancellation("fetchBalance", controller.signal, async () => 1),
    ).rejects.toBeInstanceOf(OperationCancelledError);

    try {
      await withCancellation("fetchBalance", controller.signal, async () => 1);
    } catch (e) {
      const err = e as OperationCancelledError;
      expect(err.code).toBe("OPERATION_CANCELLED");
      // No sensitive values in the message
      expect(err.message).not.toMatch(/salary|amount|recipient|employee/i);
      expect(err.message).toContain("fetchBalance");
    }
  });

  it("rejects when the signal aborts mid-flight", async () => {
    const controller = new AbortController();
    const slowOp = withCancellation("pollApproval", controller.signal, () =>
      new Promise((resolve) => setTimeout(() => resolve("done"), 50)),
    );
    controller.abort();
    await expect(slowOp).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("throwIfAborted is a no-op when signal is undefined", () => {
    expect(() => throwIfAborted(undefined, "any")).not.toThrow();
  });

  it("cancellableDelay rejects when aborted during the wait", async () => {
    const controller = new AbortController();
    const wait = cancellableDelay(1000, controller.signal, "pollDelay");
    controller.abort();
    await expect(wait).rejects.toBeInstanceOf(OperationCancelledError);
  });
});
