import { rpc, xdr, Keypair, StrKey, Account, Networks } from "@stellar/stellar-sdk";
import {
  RetryOperationType,
  DEFAULT_RETRY_BUDGETS,
  resolveRetryBudget,
  computeBackoffDelay,
  withRetryBudget,
  RetryBudgetExhaustedError,
  RetryCancelledError,
  RETRY_BUDGET_EXHAUSTED_CODE,
  RETRY_CANCELLED_CODE,
} from "../src/core/retry-budget";
import { IdempotencyRegistry } from "../src/core/idempotency";
import {
  ZkPayrollError,
  NetworkError,
  ContractExecutionError,
  ContractErrorCode,
} from "../src/core/errors";
import { validateConfig, ConfigBuilder } from "../src/config";
import { BaseContractWrapper, PreparedInvocation } from "../src/adapters/BaseContractWrapper";
import { toISigner } from "../src/signer/KeypairSigner";
import { createFlakyServer } from "../src/testing/FlakyRpcServer";

// Mock @stellar/stellar-sdk so buildInvocation can assemble simulated
// transactions without a live network.
jest.mock("@stellar/stellar-sdk", () => {
  const original = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...original,
    rpc: {
      ...original.rpc,
      assembleTransaction: jest.fn().mockImplementation((tx) => {
        return {
          build: () => tx,
        };
      }),
    },
  };
});

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

const ACCOUNT_RESPONSE = {
  accountId: () => Keypair.random().publicKey(),
  sequenceNumber: () => "1",
  incrementSequenceNumber: () => {},
} as unknown as Account;

const SIMULATE_SUCCESS_RESPONSE = {
  results: [],
  minResourceFee: "100",
} as unknown as rpc.Api.SimulateTransactionResponse;

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

const SEND_SUCCESS_RESPONSE = {
  status: "PENDING",
  hash: "tx_hash_123",
} as unknown as rpc.Api.SendTransactionResponse;

class DummyContractClient extends BaseContractWrapper {
  async testBuild(sourcePublicKey: string): Promise<PreparedInvocation> {
    return this.buildInvocation("test_method", [], sourcePublicKey, Networks.TESTNET);
  }

  async testInvoke(signer: Keypair): Promise<xdr.ScVal> {
    return this.invoke("test_method", [], toISigner(signer));
  }

  async testInvokeWithKey(signer: Keypair, idempotencyKey: string): Promise<xdr.ScVal> {
    return this.invoke("test_method", [], toISigner(signer), undefined, { idempotencyKey });
  }
}

describe("resolveRetryBudget", () => {
  it("resolves distinct per-operation defaults for reads vs writes", () => {
    const read = resolveRetryBudget(RetryOperationType.READ);
    const write = resolveRetryBudget(RetryOperationType.WRITE);
    const poll = resolveRetryBudget(RetryOperationType.POLL);

    expect(read.maxAttempts).toBe(3);
    expect(read.idempotencyRequired).toBe(false);
    expect(poll.maxAttempts).toBe(3);
    expect(poll.idempotencyRequired).toBe(false);

    // Writes are non-idempotent: they default to a single attempt and demand
    // an idempotency key before any retry is permitted.
    expect(write.maxAttempts).toBe(1);
    expect(write.idempotencyRequired).toBe(true);
  });

  it("merges per-operation overrides on top of the built-in defaults", () => {
    const budget = resolveRetryBudget(RetryOperationType.READ, {
      budgets: { read: { maxAttempts: 5, initialDelayMs: 250 } },
      overrides: { backoffFactor: 3 },
    });

    expect(budget.maxAttempts).toBe(5);
    expect(budget.initialDelayMs).toBe(250);
    expect(budget.backoffFactor).toBe(3);
    expect(budget.maxDelayMs).toBe(DEFAULT_RETRY_BUDGETS.read!.maxDelayMs);
    expect(budget.jitterMs).toBe(0);
  });

  it("allows a write budget to be widened only via explicit overrides", () => {
    const budget = resolveRetryBudget(RetryOperationType.WRITE, {
      budgets: { write: { maxAttempts: 3 } },
    });

    expect(budget.maxAttempts).toBe(3);
    // Safety is never lifted by widening the budget: idempotency stays required.
    expect(budget.idempotencyRequired).toBe(true);
  });
});

describe("computeBackoffDelay", () => {
  const budget = { initialDelayMs: 100, backoffFactor: 2, maxDelayMs: 1_000, jitterMs: 0 };

  it("computes a deterministic exponential schedule", () => {
    expect(computeBackoffDelay(1, budget)).toBe(100);
    expect(computeBackoffDelay(2, budget)).toBe(200);
    expect(computeBackoffDelay(3, budget)).toBe(400);
    expect(computeBackoffDelay(4, budget)).toBe(800);
  });

  it("caps the delay at maxDelayMs", () => {
    expect(computeBackoffDelay(5, budget)).toBe(1_000);
    expect(computeBackoffDelay(10, budget)).toBe(1_000);
  });

  it("adds bounded jitter from the injected random source", () => {
    const jittered = { ...budget, jitterMs: 50 };
    expect(computeBackoffDelay(1, jittered, () => 0)).toBe(100);
    expect(computeBackoffDelay(1, jittered, () => 0.999)).toBe(150);

    for (let i = 0; i < 100; i++) {
      const delay = computeBackoffDelay(2, jittered, () => Math.random());
      expect(delay).toBeGreaterThanOrEqual(200);
      expect(delay).toBeLessThanOrEqual(250);
    }
  });
});

describe("withRetryBudget", () => {
  const READ_BUDGET = {
    maxAttempts: 3,
    initialDelayMs: 10,
    backoffFactor: 3,
    maxDelayMs: 100,
    jitterMs: 0,
  };
  const WRITE_BUDGET = {
    maxAttempts: 3,
    initialDelayMs: 10,
    backoffFactor: 2,
    maxDelayMs: 100,
    jitterMs: 0,
  };

  it("recovers from transient failures with deterministic backoff and succeeds", async () => {
    const delays: number[] = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce("ok");

    const result = await withRetryBudget(fn, {
      operationType: RetryOperationType.READ,
      budget: READ_BUDGET,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    // initialDelayMs=10, backoffFactor=3 => 10ms then 30ms, capped at 100ms.
    expect(delays).toEqual([10, 30]);
  });

  it("caps the backoff schedule and reports exhaustion as a distinct error", async () => {
    const delays: number[] = [];
    const fn = jest.fn().mockRejectedValue(new Error("ECONNRESET"));

    const promise = withRetryBudget(fn, {
      operationType: RetryOperationType.READ,
      budget: { maxAttempts: 6, initialDelayMs: 10, backoffFactor: 2, maxDelayMs: 25, jitterMs: 0 },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await expect(promise).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
    const err = await captureError<RetryBudgetExhaustedError>(promise);
    expect(err).toBeInstanceOf(ZkPayrollError);
    expect(err.code).toBe(RETRY_BUDGET_EXHAUSTED_CODE);
    expect(err.operationType).toBe(RetryOperationType.READ);
    expect(err.attempts).toBe(6);
    expect(err.maxAttempts).toBe(6);
    expect(err.retryRefused).toBe(false);
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toContain("ECONNRESET");
    expect(fn).toHaveBeenCalledTimes(6);
    expect(delays).toEqual([10, 20, 25, 25, 25]);
  });

  it("fails fast on a permanent failure without consuming retries", async () => {
    const permanent = new NetworkError("bad request", "NETWORK_ERROR", {}, 400);
    const fn = jest.fn().mockRejectedValue(permanent);
    let sleeps = 0;

    await expect(
      withRetryBudget(fn, {
        operationType: RetryOperationType.READ,
        budget: { ...READ_BUDGET, maxAttempts: 5 },
        sleep: async () => {
          sleeps++;
        },
      })
    ).rejects.toBe(permanent);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleeps).toBe(0);
  });

  it("reports a non-retryable contract revert immediately", async () => {
    const revert = new ContractExecutionError("reverted", ContractErrorCode.CONTRACT_REVERT);
    const fn = jest.fn().mockRejectedValue(revert);

    await expect(
      withRetryBudget(fn, {
        operationType: RetryOperationType.READ,
        budget: { ...READ_BUDGET, maxAttempts: 5 },
        sleep: async () => {
          throw new Error("sleep must not run");
        },
      })
    ).rejects.toBe(revert);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("refuses to retry a non-idempotent operation without an idempotency key", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
    const sleep = jest.fn(async () => {
      throw new Error("sleep must not run");
    });

    const promise = withRetryBudget(fn, {
      operationType: RetryOperationType.WRITE,
      // A widened budget must not bypass the safety gate.
      budget: { ...WRITE_BUDGET, maxAttempts: 5 },
      sleep,
    });

    await expect(promise).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
    const err = await captureError<RetryBudgetExhaustedError>(promise);
    expect(err.retryRefused).toBe(true);
    expect(err.operationType).toBe(RetryOperationType.WRITE);
    expect(err.attempts).toBe(1);
    expect(err.message).toMatch(/idempotency key/i);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a non-idempotent operation once an idempotency key is present", async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce("ok");

    const result = await withRetryBudget(fn, {
      operationType: RetryOperationType.WRITE,
      idempotencyKey: "nonce-abc",
      budget: WRITE_BUDGET,
      sleep: async () => {},
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancels the sequence cleanly when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = jest.fn().mockResolvedValue("ok");

    const promise = withRetryBudget(fn, {
      operationType: RetryOperationType.READ,
      signal: controller.signal,
    });

    await expect(promise).rejects.toBeInstanceOf(RetryCancelledError);
    const err = await captureError<RetryCancelledError>(promise);
    expect(err.code).toBe(RETRY_CANCELLED_CODE);
    expect(fn).not.toHaveBeenCalled();
  });

  it("cancels an in-flight retry sequence during backoff", async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      const fn = jest.fn().mockRejectedValue(new Error("ECONNRESET"));

      const promise = withRetryBudget(fn, {
        operationType: RetryOperationType.READ,
        budget: {
          maxAttempts: 5,
          initialDelayMs: 100,
          backoffFactor: 2,
          maxDelayMs: 1_000,
          jitterMs: 0,
        },
        signal: controller.signal,
      });

      // Let the first attempt fail and the backoff timer be scheduled.
      await jest.advanceTimersByTimeAsync(0);
      controller.abort();

      await expect(promise).rejects.toBeInstanceOf(RetryCancelledError);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops retrying once the overall timeoutMs deadline is exceeded", async () => {
    let clock = 0;
    const fn = jest.fn().mockRejectedValue(new Error("ECONNRESET"));

    const promise = withRetryBudget(fn, {
      operationType: RetryOperationType.READ,
      budget: {
        maxAttempts: 10,
        initialDelayMs: 100,
        backoffFactor: 2,
        maxDelayMs: 1_000,
        jitterMs: 0,
        timeoutMs: 250,
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    await expect(promise).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
    const err = await captureError<RetryBudgetExhaustedError>(promise);
    expect(err.deadlineExceeded).toBe(true);
    expect(err.attempts).toBeLessThan(10);
    expect(fn.mock.calls.length).toBeLessThan(10);
  });

  it("never double-submits the same operation when a retry overlaps the in-flight submission", async () => {
    const registry = new IdempotencyRegistry<string>();
    let resolveSubmission: ((value: string) => void) | undefined;
    const submit = jest.fn().mockImplementation(() => {
      return new Promise<string>((resolve) => {
        resolveSubmission = resolve;
      });
    });

    const sleepQueue: Array<() => void> = [];
    const sleep = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          sleepQueue.push(resolve);
        })
    );

    const promise = withRetryBudget(submit, {
      operationType: RetryOperationType.WRITE,
      idempotencyKey: "pay-nonce-1",
      attemptTimeoutMs: 50,
      budget: WRITE_BUDGET,
      registry,
      sleep,
    });

    // Attempt 1: the submission is in flight (the server may have accepted it).
    await flushMicrotasks();
    expect(submit).toHaveBeenCalledTimes(1);

    // The client times out waiting for the send response, so a retry is scheduled.
    sleepQueue.shift()!();
    await flushMicrotasks();
    // The backoff delay elapses.
    sleepQueue.shift()!();
    await flushMicrotasks();

    // Attempt 2 reuses the in-flight submission for the same key instead of
    // calling submit again -- this is the duplicate-operation protection.
    expect(submit).toHaveBeenCalledTimes(1);

    // The original submission eventually completes and both attempts resolve
    // from the same single network call.
    resolveSubmission!("submitted");
    await flushMicrotasks();

    await expect(promise).resolves.toBe("submitted");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("demonstrates that without a dedup registry the same operation would be re-submitted", async () => {
    // Same scenario as the duplicate-protection test, but WITHOUT a registry:
    // the retried attempt re-invokes the submission function, i.e. the unsafe
    // double-submit the registry guard is designed to prevent.
    const pendingSubmissions: Array<(value: string) => void> = [];
    const submit = jest.fn().mockImplementation(() => {
      return new Promise<string>((resolve) => {
        pendingSubmissions.push(resolve);
      });
    });

    const sleepQueue: Array<() => void> = [];
    const sleep = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          sleepQueue.push(resolve);
        })
    );

    const promise = withRetryBudget(submit, {
      operationType: RetryOperationType.WRITE,
      idempotencyKey: "pay-nonce-2",
      attemptTimeoutMs: 50,
      budget: WRITE_BUDGET,
      sleep,
    });

    await flushMicrotasks();
    sleepQueue.shift()!(); // attempt 1 times out
    await flushMicrotasks();
    sleepQueue.shift()!(); // backoff elapses
    await flushMicrotasks();

    // Without protection the retry re-invokes the submission.
    expect(submit).toHaveBeenCalledTimes(2);

    pendingSubmissions[1]("second");
    await expect(promise).resolves.toBe("second");
  });
});

describe("BaseContractWrapper integration", () => {
  it("honors configured read budgets for RPC reads", async () => {
    const mockServer = {
      getAccount: jest.fn().mockResolvedValue(ACCOUNT_RESPONSE),
      simulateTransaction: jest.fn().mockResolvedValue(SIMULATE_SUCCESS_RESPONSE),
    } as unknown as rpc.Server;

    const flakyServer = createFlakyServer(mockServer, {
      failFirstAttempts: 1,
      errorFactory: () => new Error("Intermittent RPC timeout"),
      targetMethods: ["getAccount"],
    });

    const client = new DummyContractClient(flakyServer, TEST_CONTRACT_ID, {
      read: { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 2, maxDelayMs: 10, jitterMs: 0 },
    });

    const prepared = await client.testBuild(Keypair.random().publicKey());
    expect(prepared.method).toBe("test_method");
    // One failed attempt plus one successful retry reaches the real server.
    expect(mockServer.getAccount).toHaveBeenCalledTimes(1);
    expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("surfaces RetryBudgetExhaustedError when a read budget is exhausted", async () => {
    const mockServer = {
      getAccount: jest.fn().mockResolvedValue(ACCOUNT_RESPONSE),
      simulateTransaction: jest.fn().mockResolvedValue(SIMULATE_SUCCESS_RESPONSE),
    } as unknown as rpc.Server;

    const flakyServer = createFlakyServer(mockServer, {
      failureRate: 1,
      errorFactory: () => new Error("ECONNRESET"),
      targetMethods: ["getAccount"],
    });

    const client = new DummyContractClient(flakyServer, TEST_CONTRACT_ID, {
      read: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 2, maxDelayMs: 10, jitterMs: 0 },
    });

    await expect(client.testBuild(Keypair.random().publicKey())).rejects.toBeInstanceOf(
      RetryBudgetExhaustedError
    );
  });

  it("deduplicates concurrent submissions that share an idempotency key", async () => {
    jest.useFakeTimers();
    try {
      let resolveSend: ((value: rpc.Api.SendTransactionResponse) => void) | undefined;
      const mockServer = {
        getAccount: jest.fn().mockResolvedValue(ACCOUNT_RESPONSE),
        simulateTransaction: jest.fn().mockResolvedValue(SIMULATE_SUCCESS_RESPONSE),
        sendTransaction: jest.fn().mockImplementation(
          () =>
            new Promise<rpc.Api.SendTransactionResponse>((resolve) => {
              resolveSend = resolve;
            })
        ),
        getTransaction: jest.fn().mockResolvedValue(SUCCESS_RESPONSE),
      } as unknown as rpc.Server;

      const client = new DummyContractClient(mockServer, TEST_CONTRACT_ID);
      const signer = Keypair.random();

      const first = client.testInvokeWithKey(signer, "dup-key-1");
      const second = client.testInvokeWithKey(signer, "dup-key-1");

      // Let both invocations build, sign, and reach submission.
      await jest.advanceTimersByTimeAsync(0);
      expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);

      resolveSend!(SEND_SUCCESS_RESPONSE);
      // Let both polls pass their 2s polling interval.
      await jest.advanceTimersByTimeAsync(2_000);

      await expect(Promise.all([first, second])).resolves.toBeDefined();
      expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("retryBudgets config validation", () => {
  it("validates per-operation retry budgets", () => {
    const result = validateConfig({
      networkUrl: "https://soroban-testnet.stellar.org",
      contractId: TEST_CONTRACT_ID,
      retryBudgets: { write: { maxAttempts: 0 } },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "retryBudgets.write.maxAttempts")).toBe(true);
  });

  it("rejects negative jitter and timeout values in per-operation budgets", () => {
    const result = validateConfig({
      networkUrl: "https://soroban-testnet.stellar.org",
      contractId: TEST_CONTRACT_ID,
      retryBudgets: { read: { jitterMs: -1, timeoutMs: -5 } },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "retryBudgets.read.jitterMs")).toBe(true);
    expect(result.errors.some((e) => e.field === "retryBudgets.read.timeoutMs")).toBe(true);
  });

  it("accepts valid per-operation retry budgets via ConfigBuilder", () => {
    const config = new ConfigBuilder()
      .withNetworkUrl("https://soroban-testnet.stellar.org")
      .withContractId(TEST_CONTRACT_ID)
      .withRetryBudgets({
        read: {
          maxAttempts: 5,
          initialDelayMs: 200,
          maxDelayMs: 5000,
          backoffFactor: 2,
          jitterMs: 10,
          timeoutMs: 10_000,
        },
        write: { maxAttempts: 2 },
        poll: { maxAttempts: 4 },
      })
      .build();

    expect(config.retryBudgets?.read?.maxAttempts).toBe(5);
    expect(config.retryBudgets?.read?.jitterMs).toBe(10);
    expect(config.retryBudgets?.write?.maxAttempts).toBe(2);
    expect(config.retryBudgets?.poll?.maxAttempts).toBe(4);
  });
});

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function captureError<T extends Error>(promise: Promise<unknown>): Promise<T> {
  try {
    await promise;
  } catch (error) {
    return error as T;
  }
  throw new Error("Expected promise to reject");
}
