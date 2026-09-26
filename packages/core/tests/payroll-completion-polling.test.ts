import {
  pollPayrollCompletion,
  waitForPayrollRunCompletion,
} from "../src/polling";
import { ContractExecutionError, ContractErrorCode } from "../src/errors";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("pollPayrollCompletion (Issue #477)", () => {
  it("resolves immediately when the payroll is already complete", async () => {
    const getStatus = jest.fn().mockResolvedValue({ status: "executed" });

    const result = await pollPayrollCompletion(getStatus, (v) => v.status === "executed", {
      intervalMs: 5,
    });

    expect(result.value).toEqual({ status: "executed" });
    expect(result.attempts).toBe(1);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("polls until the completion predicate passes and reports attempts", async () => {
    const states = [{ status: "scheduled" }, { status: "scheduled" }, { status: "executed" }];
    const getStatus = jest.fn().mockImplementation(() => Promise.resolve(states.shift()));
    const seen: Array<[number, unknown]> = [];

    const result = await pollPayrollCompletion(getStatus, (v) => v.status === "executed", {
      intervalMs: 5,
      timeoutMs: 1000,
      onAttempt: (attempt, value) => seen.push([attempt, value]),
    });

    expect(result.value).toEqual({ status: "executed" });
    expect(result.attempts).toBe(3);
    expect(seen).toHaveLength(3);
    expect(seen[0][0]).toBe(1);
  });

  it("throws a bounded timeout error that never echoes status values", async () => {
    const secretStatus = { status: "scheduled", recipient: "GSECRET123" };
    const getStatus = jest.fn().mockResolvedValue(secretStatus);

    const failure = await pollPayrollCompletion(getStatus, () => false, {
      timeoutMs: 30,
      intervalMs: 5,
    }).catch((err) => err);

    expect(failure).toBeInstanceOf(ContractExecutionError);
    expect(failure).toMatchObject({ code: ContractErrorCode.TRANSACTION_TIMEOUT });
    expect(String(failure.message)).not.toContain("GSECRET123");
    expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("supports cancellation via an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const getStatus = jest.fn().mockResolvedValue({ status: "scheduled" });

    await expect(
      pollPayrollCompletion(getStatus, () => false, {
        intervalMs: 5,
        signal: controller.signal,
      })
    ).rejects.toThrow("cancelled");
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("stops polling promptly when cancelled mid-wait", async () => {
    const controller = new AbortController();
    const getStatus = jest.fn().mockResolvedValue({ status: "scheduled" });

    const promise = pollPayrollCompletion(getStatus, () => false, {
      intervalMs: 50,
      timeoutMs: 5000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrow("cancelled");
    const callsAtCancel = getStatus.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(getStatus.mock.calls.length).toBe(callsAtCancel);
  });

  it("propagates status-getter errors instead of swallowing them", async () => {
    const getStatus = jest.fn().mockRejectedValue(new Error("payroll API down"));

    await expect(pollPayrollCompletion(getStatus, () => false, { intervalMs: 5 })).rejects.toThrow(
      "payroll API down"
    );
  });

  it("validates its arguments with clear failures", async () => {
    await expect(
      pollPayrollCompletion("nope" as never, () => true)
    ).rejects.toThrow(TypeError);
    await expect(
      pollPayrollCompletion(jest.fn().mockResolvedValue(1), "nope" as never)
    ).rejects.toThrow(TypeError);
    await expect(
      pollPayrollCompletion(jest.fn().mockResolvedValue(1), () => true, { timeoutMs: 0 })
    ).rejects.toThrow(RangeError);
    await expect(
      pollPayrollCompletion(jest.fn().mockResolvedValue(1), () => true, { intervalMs: -1 })
    ).rejects.toThrow(RangeError);
  });

  it("surfaces the pending promise for late completion without hanging past the timeout", async () => {
    const gate = deferred<string>();
    const getStatus = jest.fn().mockImplementation(() => gate.promise);

    const promise = pollPayrollCompletion(getStatus, (v) => v === "done", {
      timeoutMs: 40,
      intervalMs: 5,
    });
    gate.resolve("scheduled");

    await expect(promise).rejects.toBeInstanceOf(ContractExecutionError);
  });
});

describe("waitForPayrollRunCompletion (Issue #477)", () => {
  it("resolves on terminal run statuses", async () => {
    const getStatus = jest
      .fn()
      .mockResolvedValueOnce("scheduled")
      .mockResolvedValueOnce("executed");

    const result = await waitForPayrollRunCompletion(getStatus, { intervalMs: 5 });

    expect(result.value).toBe("executed");
    expect(result.attempts).toBe(2);
  });

  it("treats failed and cancelled runs as terminal", async () => {
    for (const terminal of ["failed", "cancelled"]) {
      const getStatus = jest.fn().mockResolvedValue(terminal);
      const result = await waitForPayrollRunCompletion(getStatus, { intervalMs: 5 });
      expect(result.value).toBe(terminal);
    }
  });

  it("accepts { status } response objects and matches case-insensitively", async () => {
    const getStatus = jest.fn().mockResolvedValue({ status: "EXECUTED" });
    const result = await waitForPayrollRunCompletion(getStatus, { intervalMs: 5 });
    expect(result.attempts).toBe(1);
  });

  it("keeps polling through unknown statuses until the timeout", async () => {
    const getStatus = jest.fn().mockResolvedValue({ status: "mystery-state" });

    await expect(
      waitForPayrollRunCompletion(getStatus, { timeoutMs: 30, intervalMs: 5 })
    ).rejects.toMatchObject({ code: ContractErrorCode.TRANSACTION_TIMEOUT });
  });
});
