import { withRetry } from "../../src/core/retry";
import { OperationCancelledError } from "../../src/cancellation";

describe("withRetry cancellation", () => {
  it("stops retrying and rejects with OperationCancelledError when aborted mid-loop (edge case)", async () => {
    const controller = new AbortController();
    let calls = 0;

    const fn = async () => {
      calls++;
      if (calls === 1) controller.abort();
      throw new Error("transient failure");
    };

    await expect(
      withRetry(fn, { attempts: 5, delayMs: 10, signal: controller.signal }),
    ).rejects.toBeInstanceOf(OperationCancelledError);

    expect(calls).toBe(1);
  });

  it("rejects immediately if the signal is already aborted and never calls fn", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;

    await expect(
      withRetry(
        async () => {
          called = true;
          return 1;
        },
        { attempts: 3, signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);

    expect(called).toBe(false);
  });

  it("treats AbortError as non-retryable (no automatic retry)", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    let calls = 0;

    const fn = async () => {
      calls++;
      throw abortErr;
    };

    await expect(withRetry(fn, { attempts: 5, delayMs: 1 })).rejects.toBe(abortErr);
    expect(calls).toBe(1);
  });

  it("is a no-op when no signal is supplied (backward compatible)", async () => {
    const value = await withRetry(async () => 42, { attempts: 2 });
    expect(value).toBe(42);
  });
});
