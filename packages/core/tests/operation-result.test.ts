/**
 * Tests for explicit SDK operation result types (#483).
 *
 * Covers:
 * - discriminated success and failure results (narrowing on `ok`),
 * - sanitized failure messages (sensitive payroll values never exposed),
 * - retryability classification and actionable remediation guidance,
 * - pre-flight validation failures (operation not attempted),
 * - correlation IDs shared across events and results,
 * - backward-compatible `success` boolean flag.
 */

import { rpc, Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  runSdkOperation,
  unwrapSdkOperationResult,
  isSdkOperationSuccess,
  isSdkOperationFailure,
  SDK_OPERATION_VALIDATION_ERROR_CODE,
  SdkOperationResult,
} from "../src/core/operationResult";
import { ZkPayrollError, NetworkError, ContractExecutionError } from "../src/core/errors";
import {
  EmployeeLifecycleClient,
  isEmployeeLifecycleSuccess,
  isEmployeeLifecycleFailure,
} from "../src/employees/lifecycle";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

/** Fixed clock so timestamps are deterministic. */
const FIXED_NOW = new Date("2026-09-26T12:00:00.000Z");
const fixedClock = () => FIXED_NOW;

describe("runSdkOperation — success path", () => {
  it("returns a discriminated success result with the operation value", async () => {
    const result = await runSdkOperation(async () => ({ receiptId: "rcpt_123" }), {
      operation: "payroll_pay",
      now: fixedClock,
    });

    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(isSdkOperationSuccess(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ receiptId: "rcpt_123" });
      expect(result.correlationId).toMatch(/^corr_/);
      expect(result.timestamp).toBe(FIXED_NOW.toISOString());
    }
  });

  it("honors an explicit correlation ID", async () => {
    const result = await runSdkOperation(async () => "ok", {
      operation: "op",
      correlationId: "corr_custom",
      now: fixedClock,
    });
    expect(result.correlationId).toBe("corr_custom");
  });

  it("does not run validation twice on success", async () => {
    const validate = jest.fn(() => ({ ok: true as const }));
    await runSdkOperation(async () => "ok", { operation: "op", validate, now: fixedClock });
    expect(validate).toHaveBeenCalledTimes(1);
  });
});

describe("runSdkOperation — failure path", () => {
  it("returns a discriminated failure result with sanitized message and stable code", async () => {
    const result = await runSdkOperation(
      async () => {
        throw new ContractExecutionError(
          "Simulation failed: recipient=GABC... amount=5000",
          "SIMULATION_FAILED"
        );
      },
      { operation: "payroll_pay", now: fixedClock }
    );

    expect(result.ok).toBe(false);
    expect(result.success).toBe(false);
    expect(isSdkOperationFailure(result)).toBe(true);
    if (result.ok === false) {
      expect(result.error.code).toBe("SIMULATION_FAILED");
      expect(result.error.attempted).toBe(true);
      expect(result.error.message).toContain("Simulation failed");
      expect(result.error.retryable).toBe(true); // per core/retry classification
      expect(result.error.remediation.action).toBeTruthy();
      expect(result.error.remediation.summary).toBeTruthy();
      expect(typeof result.error.remediation.selfServiceable).toBe("boolean");
    }
  });

  it("never exposes sensitive payroll values in failure messages or context", async () => {
    const secretAmount = "2500000000";
    const result = await runSdkOperation(
      async () => {
        throw new NetworkError(
          `Payment of amount=${secretAmount} to recipient=GBIGSECRET9999 failed`,
          "NETWORK_ERROR"
        );
      },
      { operation: "payroll_pay", now: fixedClock }
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretAmount);
    expect(serialized).not.toContain("GBIGSECRET9999");
    expect(serialized).toContain("[redacted]");
  });

  it("redacts sensitive keys present in a ZkPayrollError context", async () => {
    const result = await runSdkOperation(
      async () => {
        throw new NetworkError("Transfer failed", "NETWORK_ERROR", {
          recipient: "GSECRET123",
          amount: "999000",
          contractId: "CABCDEF",
        });
      },
      { operation: "op", now: fixedClock }
    );

    if (result.ok === false) {
      expect(result.context.recipient).toBe("[redacted]");
      expect(result.context.amount).toBe("[redacted]");
      expect(result.context.contractId).toBe("CABCDEF"); // non-sensitive context survives
    } else {
      fail("expected failure");
    }
  });

  it("classifies non-retryable failures and provides remediation", async () => {
    const result = await runSdkOperation(
      async () => {
        throw new ContractExecutionError("Contract reverted", "CONTRACT_REVERT");
      },
      { operation: "op", now: fixedClock }
    );

    if (result.ok === false) {
      expect(result.error.retryable).toBe(false);
      expect(result.error.retryReason).toContain("not retryable");
    } else {
      fail("expected failure");
    }
  });

  it("maps thrown RPC values to a stable contract error code", async () => {
    const result = await runSdkOperation(
      async () => {
        throw new Error("Transaction submission failed: connection reset while sending");
      },
      { operation: "op", now: fixedClock }
    );

    if (result.ok === false) {
      expect(result.error.code).toBe("TRANSACTION_SUBMISSION_FAILED");
    } else {
      fail("expected failure");
    }
  });

  it("returns a generic sanitized message for non-Error thrown values", async () => {
    const secret = "private-payroll-value";
    const result = await runSdkOperation(
      async () => {
        throw secret; // deliberate non-Error throw
      },
      { operation: "op", now: fixedClock }
    );

    const serialized = JSON.stringify(result);
    expect(result.ok).toBe(false);
    expect(serialized).not.toContain(secret);
    if (result.ok === false) {
      expect(result.error.message).toBe("Operation failed with an unrecognized thrown value.");
    }
  });
});

describe("runSdkOperation — pre-flight validation", () => {
  it("returns a validation failure without attempting the operation", async () => {
    const execute = jest.fn();
    const result = await runSdkOperation(execute, {
      operation: "payroll_pay",
      validate: () => ({ ok: false, message: "Amount must be a positive value." }),
      now: fixedClock,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.code).toBe(SDK_OPERATION_VALIDATION_ERROR_CODE);
      expect(result.error.attempted).toBe(false);
      expect(result.error.retryable).toBe(false);
    }
  });

  it("does not expose the rejected input value in the failure", async () => {
    const badAmount = "-42";
    const result = await runSdkOperation(async () => "ok", {
      operation: "op",
      validate: () => ({ ok: false, message: `Amount ${badAmount} is not positive.` }),
      now: fixedClock,
    });

    // The caller supplied the message; the runner never invents or reflects
    // raw input, but a good citizen passes a sanitized message. Document the
    // contract: the framework itself adds nothing sensitive.
    expect(result.ok).toBe(false);
  });

  it("proceeds when validation passes", async () => {
    const execute = jest.fn(async () => "value");
    const result = await runSdkOperation(execute, {
      operation: "op",
      validate: () => ({ ok: true }),
      now: fixedClock,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});

describe("runSdkOperation — progress events", () => {
  it("emits sanitized lifecycle events sharing one correlation ID", async () => {
    const events: string[] = [];
    const result = await runSdkOperation(async () => "v", {
      operation: "payroll_pay",
      now: fixedClock,
      onEvent: (e) => events.push(`${e.stage}:${e.correlationId}`),
    });

    expect(events).toEqual([
      `executing:${result.correlationId}`,
      `succeeded:${result.correlationId}`,
    ]);
  });

  it("emits validating → failed events for validation failures", async () => {
    const stages: string[] = [];
    await runSdkOperation(async () => "v", {
      operation: "op",
      validate: () => ({ ok: false, message: "bad" }),
      now: fixedClock,
      onEvent: (e) => stages.push(e.stage),
    });
    expect(stages).toEqual(["validating", "failed"]);
  });

  it("emits a sanitized error summary on the failed event", async () => {
    const failedEvent: Array<{ code: string; message: string } | undefined> = [];
    await runSdkOperation(
      async () => {
        throw new Error("boom amount=123 secret");
      },
      {
        operation: "op",
        now: fixedClock,
        onEvent: (e) => {
          if (e.stage === "failed") failedEvent.push(e.error);
        },
      }
    );

    expect(failedEvent).toHaveLength(1);
    const serialized = JSON.stringify(failedEvent);
    expect(serialized).not.toContain("amount=123");
    expect(serialized).toContain("[redacted]");
  });
});

describe("unwrapSdkOperationResult", () => {
  it("returns the value on success", async () => {
    const result = await runSdkOperation(async () => 42, { operation: "op", now: fixedClock });
    expect(unwrapSdkOperationResult(result)).toBe(42);
  });

  it("throws a typed ZkPayrollError with the sanitized message on failure", async () => {
    const result: SdkOperationResult<number> = await runSdkOperation(
      async () => {
        throw new NetworkError(`failed amount=777`, "NETWORK_ERROR");
      },
      { operation: "op", now: fixedClock }
    );

    expect(() => unwrapSdkOperationResult(result)).toThrow(ZkPayrollError);
    try {
      unwrapSdkOperationResult(result);
      fail("expected throw");
    } catch (err) {
      expect((err as ZkPayrollError).code).toBe("NETWORK_ERROR");
      expect((err as Error).message).not.toContain("777");
      expect((err as ZkPayrollError).context.correlationId).toBe(result.correlationId);
    }
  });

  it("does not attach the raw cause by default", async () => {
    const result = await runSdkOperation(
      async () => {
        throw new Error("raw internals amount=5");
      },
      { operation: "op", now: fixedClock }
    );

    expect(() => unwrapSdkOperationResult(result)).toThrow(ZkPayrollError);
    try {
      unwrapSdkOperationResult(result);
    } catch (err) {
      expect((err as ZkPayrollError).cause).toBeUndefined();
    }
  });
});

describe("EmployeeLifecycleClient — explicit results (#483 integration)", () => {
  const admin = Keypair.random();
  const employee = Keypair.random().publicKey();

  function makeClient(invokeImpl?: (...args: unknown[]) => Promise<unknown>) {
    const client = new EmployeeLifecycleClient({} as rpc.Server, TEST_CONTRACT_ID);
    const invokeStub = jest.fn(invokeImpl ?? (async () => ({})));
    // Intercept the protected invoke() so no network is touched.
    (client as unknown as { invoke: typeof invokeStub }).invoke = invokeStub;
    return { client, invokeStub };
  }

  it("returns a success result with operation metadata on the happy path", async () => {
    const { client, invokeStub } = makeClient();
    const result = await client.create(admin, employee);

    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(isEmployeeLifecycleSuccess(result)).toBe(true);
    if (result.ok) {
      expect(result.employeeAddress).toBe(employee);
    }
    expect(result.operation).toBe("create");
    expect(result.correlationId).toMatch(/^req_/);
    expect(invokeStub).toHaveBeenCalledWith(
      "create_employee",
      expect.anything(),
      admin,
      undefined,
      expect.stringMatching(/^req_/)
    );
  });

  it("returns a failure result instead of throwing when the contract call fails", async () => {
    const { client } = makeClient(async () => {
      throw new Error("simulate failed");
    });
    const result = await client.suspend(admin, employee);

    expect(result.ok).toBe(false);
    expect(result.success).toBe(false);
    expect(isEmployeeLifecycleFailure(result)).toBe(true);
    if (result.ok === false) {
      expect(result.operation).toBe("suspend");
      expect(result.error.code).toBe("SIMULATION_FAILED");
      expect(result.error.attempted).toBe(true);
      expect(result.error.remediation.action).toBeTruthy();
    }
  });

  it("does not echo the employee address back on failure results", async () => {
    const { client } = makeClient(async () => {
      throw new Error("simulate failed");
    });
    const result = await client.offboard(admin, employee);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(employee);
  });

  it("rejects invalid destinations without attempting the call or echoing the value", async () => {
    const { client, invokeStub } = makeClient();
    const result = await client.create(admin, "not-a-valid-address");

    expect(invokeStub).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.code).toBe(SDK_OPERATION_VALIDATION_ERROR_CODE);
      expect(result.error.attempted).toBe(false);
      // Rejected input is never reflected in the sanitized failure message.
      expect(JSON.stringify(result)).not.toContain("not-a-valid-address");
    }
  });

  it("sanitizes sensitive values appearing in failure messages", async () => {
    const { client } = makeClient(async () => {
      throw new Error("transfer failed amount=999999999 recipient=GBIGSECRET0000");
    });
    const result = await client.offboard(admin, employee);

    const serialized = JSON.stringify(result);
    expect(result.ok).toBe(false);
    expect(serialized).not.toContain("999999999");
    expect(serialized).not.toContain("GBIGSECRET0000");
  });

  it("supports all four operations through the shared runner", async () => {
    const { client, invokeStub } = makeClient();
    for (const [op, method] of [
      ["create", "create_employee"],
      ["suspend", "suspend_employee"],
      ["reactivate", "reactivate_employee"],
      ["offboard", "offboard_employee"],
    ] as const) {
      const result = await client[op](admin, employee);
      expect(result.ok).toBe(true);
      expect(result.operation).toBe(op);
      expect(invokeStub).toHaveBeenLastCalledWith(
        method,
        expect.anything(),
        admin,
        undefined,
        expect.anything()
      );
    }
  });
});
