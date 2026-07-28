/**
 * redaction-on-failure.test.ts
 *
 * Verifies that sensitive values stay redacted when SDK operations fail.
 * Failure paths are a common place for accidental data leakage in logs and
 * telemetry, so each test simulates a failing operation, captures every log
 * entry emitted, and asserts that no raw sensitive value appears in the output.
 *
 * Coverage:
 *  - Validation failures (invalid recipient / amount / asset)
 *  - Proof generation failures
 *  - Contract invocation failures
 *  - redactError() on errors whose messages contain sensitive field data
 *  - redactObject() / redactDeep() placeholder, mask, and remove modes
 *  - redactSensitive() used directly before logging
 *  - Fields documented as sensitive but NOT in the default set (salary,
 *    employer, employee, commitmentHash) via additionalFields option
 */

import { Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import { PayrollService } from "../src/payroll";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
import { IProofGenerator, ProofPayload } from "../src/crypto/IProofGenerator";
import { PayrollError } from "../src/errors";
import { createHookLogger, redactSensitive, LogEvent } from "../src/logging/SdkLogger";
import {
  redactObject,
  redactDeep,
  redactError,
  getDefaultSensitiveFields,
} from "../src/redaction/RedactionEngine";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SENSITIVE_RECIPIENT = "GABC1234567890RECIPIENTADDRESS";
const SENSITIVE_AMOUNT = 9_500_000n;
const SENSITIVE_ASSET = "CTOKEN_CONTRACT_ID_SENSITIVE";
const SENSITIVE_PRIVATE_KEY = "S_PRIVATE_KEY_SECRET_VALUE";
const SENSITIVE_SALARY = 120_000n;
const SENSITIVE_EMPLOYER = "GEMPLOYER_ADDRESS_SENSITIVE";
const SENSITIVE_EMPLOYEE = "GEMPLOYEE_ADDRESS_SENSITIVE";
const SENSITIVE_COMMITMENT = "commitment_hash_abc123_sensitive";

const MOCK_PROOF: ProofPayload = {
  proof: {
    pi_a: ["1", "2"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
    ],
    pi_c: ["7", "8"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["123", "456"],
};

/** Collect all log entries emitted during a PayrollService operation. */
function makeLogger() {
  const entries: LogEvent[] = [];
  const logger = createHookLogger((e) => entries.push(e));
  return { logger, entries };
}

/**
 * Assert that none of the collected log entries contain a raw sensitive value
 * anywhere in their serialized form.
 */
function assertNoLeakInEntries(entries: LogEvent[], sensitiveValue: string) {
  const serialized = JSON.stringify(entries);
  expect(serialized).not.toContain(sensitiveValue);
}

/** Build a minimal PayrollService with controllable collaborators. */
function buildService(
  overrides: {
    proofGen?: IProofGenerator;
    contractWrapper?: Partial<PayrollContractWrapper>;
    logger?: ReturnType<typeof createHookLogger>;
  } = {}
) {
  const signer = Keypair.random();

  const proofGen: IProofGenerator = overrides.proofGen ?? {
    generateProof: jest.fn().mockResolvedValue(MOCK_PROOF),
  };

  const contractWrapper = {
    privatePay: jest.fn().mockResolvedValue(xdr.ScVal.scvVoid()),
    ...(overrides.contractWrapper ?? {}),
  } as unknown as PayrollContractWrapper;

  const service = new PayrollService(
    contractWrapper,
    proofGen,
    signer,
    Networks.TESTNET,
    overrides.logger
  );

  return { service, contractWrapper, proofGen, signer };
}

// ─── 1. Validation failure paths ─────────────────────────────────────────────

describe("Redaction — validation failure paths", () => {
  it("does not log the recipient value when validation fails on an empty recipient", async () => {
    const { logger, entries } = makeLogger();
    const { service } = buildService({ logger });

    await expect(
      service.processPayment({ recipient: "", amount: SENSITIVE_AMOUNT, asset: SENSITIVE_ASSET })
    ).rejects.toThrow();

    // Only one warn entry should be emitted: payment_validation_failed
    const warnEntries = entries.filter((e) => e.level === "warn");
    expect(warnEntries).toHaveLength(1);
    expect(warnEntries[0].event).toBe("payment_validation_failed");

    // The raw amount and asset must not appear in the log context
    assertNoLeakInEntries(entries, SENSITIVE_AMOUNT.toString());
    assertNoLeakInEntries(entries, SENSITIVE_ASSET);
  });

  it("does not log the amount value when validation fails on a zero amount", async () => {
    const { logger, entries } = makeLogger();
    const { service } = buildService({ logger });

    await expect(
      service.processPayment({
        recipient: SENSITIVE_RECIPIENT,
        amount: 0n,
        asset: SENSITIVE_ASSET,
      })
    ).rejects.toThrow();

    // Recipient and asset must not leak into the warning log
    assertNoLeakInEntries(entries, SENSITIVE_RECIPIENT);
    assertNoLeakInEntries(entries, SENSITIVE_ASSET);
  });

  it("does not log the asset value when validation fails on an empty asset", async () => {
    const { logger, entries } = makeLogger();
    const { service } = buildService({ logger });

    await expect(
      service.processPayment({
        recipient: SENSITIVE_RECIPIENT,
        amount: SENSITIVE_AMOUNT,
        asset: "",
      })
    ).rejects.toThrow();

    assertNoLeakInEntries(entries, SENSITIVE_RECIPIENT);
    assertNoLeakInEntries(entries, SENSITIVE_AMOUNT.toString());
  });

  it("includes only the error message text (not field values) in the validation_failed context", async () => {
    const { logger, entries } = makeLogger();
    const { service } = buildService({ logger });

    await expect(
      service.processPayment({ recipient: "", amount: SENSITIVE_AMOUNT, asset: SENSITIVE_ASSET })
    ).rejects.toThrow();

    const warnEntry = entries.find((e) => e.event === "payment_validation_failed");
    expect(warnEntry).toBeDefined();
    // The logged error text is a generic message, not a raw field value
    expect(warnEntry?.context?.error).toEqual(expect.any(String));
    expect(warnEntry?.context?.error).not.toBe(SENSITIVE_RECIPIENT);
    expect(warnEntry?.context?.error).not.toBe(SENSITIVE_AMOUNT.toString());
    expect(warnEntry?.context?.error).not.toBe(SENSITIVE_ASSET);
  });
});

// ─── 2. Proof generation failure paths ───────────────────────────────────────

describe("Redaction — proof generation failure paths", () => {
  it("does not log sensitive payment params when proof generation throws a generic error", async () => {
    const { logger, entries } = makeLogger();
    const failingProofGen: IProofGenerator = {
      generateProof: jest.fn().mockRejectedValue(new Error("circuit constraint unsatisfied")),
    };
    const { service } = buildService({ proofGen: failingProofGen, logger });

    await expect(
      service.processPayment({
        recipient: SENSITIVE_RECIPIENT,
        amount: SENSITIVE_AMOUNT,
        asset: SENSITIVE_ASSET,
      })
    ).rejects.toThrow();

    assertNoLeakInEntries(entries, SENSITIVE_RECIPIENT);
    assertNoLeakInEntries(entries, SENSITIVE_AMOUNT.toString());
    assertNoLeakInEntries(entries, SENSITIVE_ASSET);
  });

  it("does not log sensitive payment params when proof generation throws a PayrollError", async () => {
    const { logger, entries } = makeLogger();
    const customError = new PayrollError(
      `Proof failed for recipient=${SENSITIVE_RECIPIENT} amount=${SENSITIVE_AMOUNT}`,
      2001
    );
    const failingProofGen: IProofGenerator = {
      generateProof: jest.fn().mockRejectedValue(customError),
    };
    const { service } = buildService({ proofGen: failingProofGen, logger });

    await expect(
      service.processPayment({
        recipient: SENSITIVE_RECIPIENT,
        amount: SENSITIVE_AMOUNT,
        asset: SENSITIVE_ASSET,
      })
    ).rejects.toThrow();

    // The SDK must not forward raw error messages that contain sensitive values
    assertNoLeakInEntries(entries, SENSITIVE_RECIPIENT);
    assertNoLeakInEntries(entries, SENSITIVE_AMOUNT.toString());
  });

  it("emits at most payment_start before failing on proof error — no sensitive context emitted", async () => {
    const { logger, entries } = makeLogger();
    const failingProofGen: IProofGenerator = {
      generateProof: jest.fn().mockRejectedValue(new Error("witness mismatch")),
    };
    const { service } = buildService({ proofGen: failingProofGen, logger });

    await expect(
      service.processPayment({
        recipient: SENSITIVE_RECIPIENT,
        amount: SENSITIVE_AMOUNT,
        asset: SENSITIVE_ASSET,
      })
    ).rejects.toThrow();

    // All emitted events must be safe (payment_start with no context, and
    // validation events — neither should carry sensitive field values)
    for (const entry of entries) {
      const ctx = JSON.stringify(entry.context ?? {});
      expect(ctx).not.toContain(SENSITIVE_RECIPIENT);
      expect(ctx).not.toContain(SENSITIVE_AMOUNT.toString());
      expect(ctx).not.toContain(SENSITIVE_ASSET);
    }
  });
});

// ─── 3. Contract invocation failure paths ────────────────────────────────────

describe("Redaction — contract invocation failure paths", () => {
  it("does not log sensitive params when contract.privatePay throws", async () => {
    const { logger, entries } = makeLogger();
    const failingWrapper = {
      privatePay: jest.fn().mockRejectedValue(new Error("soroban simulate transaction failed")),
    };
    const { service } = buildService({ contractWrapper: failingWrapper, logger });

    await expect(
      service.processPayment({
        recipient: SENSITIVE_RECIPIENT,
        amount: SENSITIVE_AMOUNT,
        asset: SENSITIVE_ASSET,
      })
    ).rejects.toThrow();

    assertNoLeakInEntries(entries, SENSITIVE_RECIPIENT);
    assertNoLeakInEntries(entries, SENSITIVE_AMOUNT.toString());
    assertNoLeakInEntries(entries, SENSITIVE_ASSET);
  });

  it("does not expose private key through logger when contract throws with key-related context", async () => {
    const { logger, entries } = makeLogger();
    const failingWrapper = {
      privatePay: jest
        .fn()
        .mockRejectedValue(
          new Error(`contract revert: invalid signer privateKey=${SENSITIVE_PRIVATE_KEY}`)
        ),
    };
    const { service } = buildService({ contractWrapper: failingWrapper, logger });

    await expect(
      service.processPayment({
        recipient: SENSITIVE_RECIPIENT,
        amount: SENSITIVE_AMOUNT,
        asset: SENSITIVE_ASSET,
      })
    ).rejects.toThrow();

    // The raw private key value must never appear in any log entry
    assertNoLeakInEntries(entries, SENSITIVE_PRIVATE_KEY);
    assertNoLeakInEntries(entries, SENSITIVE_RECIPIENT);
  });
});

// ─── 4. redactError() — sensitive values in error messages ───────────────────

describe("redactError — sensitive values in error messages", () => {
  it("redacts recipient value embedded in error message", () => {
    const err = new Error(`Payment failed: recipient=${SENSITIVE_RECIPIENT} is invalid`);
    const sanitized = redactError(err);

    expect(sanitized.message).not.toContain(SENSITIVE_RECIPIENT);
    expect(sanitized.message).toContain("[redacted]");
  });

  it("redacts amount value embedded in error message", () => {
    const err = new Error(`Overflow: amount=${SENSITIVE_AMOUNT} exceeds max`);
    const sanitized = redactError(err);

    expect(sanitized.message).not.toContain(SENSITIVE_AMOUNT.toString());
    expect(sanitized.message).toContain("[redacted]");
  });

  it("redacts privateKey value embedded in error message", () => {
    const err = new Error(`Auth failed: privateKey=${SENSITIVE_PRIVATE_KEY} rejected`);
    const sanitized = redactError(err);

    expect(sanitized.message).not.toContain(SENSITIVE_PRIVATE_KEY);
    expect(sanitized.message).toContain("[redacted]");
  });

  it("preserves the stack trace after redaction", () => {
    const err = new Error(`Failure: recipient=${SENSITIVE_RECIPIENT}`);
    const sanitized = redactError(err);

    expect(sanitized.stack).toBe(err.stack);
  });

  it("preserves non-sensitive parts of the error message", () => {
    const err = new Error(`Contract revert: recipient=${SENSITIVE_RECIPIENT} — code 403`);
    const sanitized = redactError(err);

    expect(sanitized.message).toContain("Contract revert");
    expect(sanitized.message).toContain("code 403");
  });

  it("uses a custom placeholder when specified", () => {
    const err = new Error(`Denied: secret=TOP_SECRET_VAL`);
    const sanitized = redactError(err, { placeholder: "***" });

    expect(sanitized.message).not.toContain("TOP_SECRET_VAL");
    expect(sanitized.message).toContain("***");
  });
});

// ─── 5. redactObject() — placeholder, mask, remove modes ─────────────────────

describe("redactObject — failure context objects", () => {
  it("placeholder mode replaces sensitive field values with [redacted]", () => {
    const context = {
      recipient: SENSITIVE_RECIPIENT,
      amount: SENSITIVE_AMOUNT,
      txHash: "safe_tx_hash",
      error: "network timeout",
    };
    const { redacted, fieldsRedacted } = redactObject(context);

    expect(redacted.recipient).toBe("[redacted]");
    expect(redacted.amount).toBe("[redacted]");
    expect(redacted.txHash).toBe("safe_tx_hash");
    expect(redacted.error).toBe("network timeout");
    expect(fieldsRedacted).toContain("recipient");
    expect(fieldsRedacted).toContain("amount");
  });

  it("mask mode partially obscures values instead of replacing them", () => {
    const { redacted } = redactObject(
      { recipient: SENSITIVE_RECIPIENT, txHash: "abc" },
      { mode: "mask" }
    );

    const masked = redacted.recipient as string;
    expect(masked).not.toBe(SENSITIVE_RECIPIENT);
    // Mask preserves first 2 and last 2 characters
    expect(masked.startsWith(SENSITIVE_RECIPIENT.slice(0, 2))).toBe(true);
    expect(masked.endsWith(SENSITIVE_RECIPIENT.slice(-2))).toBe(true);
    expect(masked).toContain("*");
  });

  it("remove mode omits sensitive fields entirely from the output", () => {
    const { redacted } = redactObject(
      { recipient: SENSITIVE_RECIPIENT, amount: SENSITIVE_AMOUNT, txHash: "abc" },
      { mode: "remove" }
    );

    expect("recipient" in redacted).toBe(false);
    expect("amount" in redacted).toBe(false);
    expect(redacted.txHash).toBe("abc");
  });

  it("reports which fields were redacted", () => {
    const { fieldsRedacted } = redactObject({
      recipient: SENSITIVE_RECIPIENT,
      witness: { a: 1 },
      method: "private_pay",
    });

    expect(fieldsRedacted).toContain("recipient");
    expect(fieldsRedacted).toContain("witness");
    expect(fieldsRedacted).not.toContain("method");
  });

  it("all default sensitive fields are redacted in a context object", () => {
    const defaultFields = getDefaultSensitiveFields();
    const context: Record<string, unknown> = {};
    for (const field of defaultFields) {
      context[field] = `raw_value_for_${field}`;
    }

    const { redacted } = redactObject(context);

    for (const field of defaultFields) {
      expect(redacted[field]).toBe("[redacted]");
    }
  });
});

// ─── 6. redactDeep() — nested failure context ────────────────────────────────

describe("redactDeep — nested failure context", () => {
  it("redacts sensitive fields nested inside an error context object", () => {
    const context = {
      operation: "processPayment",
      cause: {
        recipient: SENSITIVE_RECIPIENT,
        amount: SENSITIVE_AMOUNT,
        step: "proof_generation",
      },
    };

    const { redacted } = redactDeep(context);
    const typed = redacted as typeof context;

    expect(typed.operation).toBe("processPayment");
    expect(typed.cause.recipient).toBe("[redacted]");
    expect(typed.cause.amount).toBe("[redacted]");
    expect(typed.cause.step).toBe("proof_generation");
  });

  it("redacts sensitive fields inside arrays of failure records", () => {
    const failedBatch = [
      { employee: SENSITIVE_EMPLOYEE, commitmentHash: SENSITIVE_COMMITMENT, step: "commit" },
      { employee: "G_SAFE_ID", commitmentHash: "safe_hash", step: "verify" },
    ];

    const { redacted } = redactDeep(failedBatch, {
      additionalFields: ["employee", "commitmentHash"],
    });
    const typed = redacted as typeof failedBatch;

    expect(typed[0].employee).toBe("[redacted]");
    expect(typed[0].commitmentHash).toBe("[redacted]");
    expect(typed[0].step).toBe("commit");
    // Non-sensitive in the same schema should survive
    expect(typed[1].step).toBe("verify");
  });

  it("redacts the witness object deeply when it contains nested circuit inputs", () => {
    const failureContext = {
      error: "constraint violation",
      witness: {
        recipient: SENSITIVE_RECIPIENT,
        amount: SENSITIVE_AMOUNT.toString(),
        salt: "random_salt",
      },
    };

    const { redacted } = redactDeep(failureContext);
    // "witness" is in the default sensitive set — top-level key is redacted
    expect((redacted as typeof failureContext).witness).toBe("[redacted]");
  });
});

// ─── 7. redactSensitive() — inline logging helper ────────────────────────────

describe("redactSensitive — safe context building before logging failure events", () => {
  it("redacts all default sensitive fields from a mixed failure context", () => {
    const context = {
      recipient: SENSITIVE_RECIPIENT,
      amount: SENSITIVE_AMOUNT,
      privateKey: SENSITIVE_PRIVATE_KEY,
      txHash: "safe_tx_hash",
      errorCode: "PROOF_GENERATION_FAILED",
    };

    const safe = redactSensitive(context);

    expect(safe.recipient).toBe("[redacted]");
    expect(safe.amount).toBe("[redacted]");
    expect(safe.privateKey).toBe("[redacted]");
    expect(safe.txHash).toBe("safe_tx_hash");
    expect(safe.errorCode).toBe("PROOF_GENERATION_FAILED");
  });

  it("redacts asset when listed in additionalFields (asset is not in default set)", () => {
    // asset is documented as sensitive in TELEMETRY.md but not in the default
    // redaction set — callers must opt-in via additionalFields.
    const context = {
      recipient: SENSITIVE_RECIPIENT,
      asset: SENSITIVE_ASSET,
      txHash: "safe_tx_hash",
    };

    const safe = redactSensitive(context);
    // Without additionalFields, asset passes through unchanged
    expect(safe.asset).toBe(SENSITIVE_ASSET);

    // With additionalFields, it is redacted
    const { redacted } = redactObject(context, { additionalFields: ["asset"] });
    expect(redacted.asset).toBe("[redacted]");
  });

  it("can be safely passed to a logger hook without leaking values", () => {
    const received: LogEvent[] = [];
    const logger = createHookLogger((e) => received.push(e));

    const failureContext = {
      recipient: SENSITIVE_RECIPIENT,
      amount: SENSITIVE_AMOUNT,
      witness: { recipient: SENSITIVE_RECIPIENT, amount: SENSITIVE_AMOUNT.toString() },
      method: "private_pay",
      errorCode: "CONTRACT_REVERT",
    };

    logger.error("payment_failed", redactSensitive(failureContext));

    expect(received).toHaveLength(1);
    const entry = received[0];
    expect(entry.level).toBe("error");
    expect(entry.context?.recipient).toBe("[redacted]");
    expect(entry.context?.amount).toBe("[redacted]");
    expect(entry.context?.witness).toBe("[redacted]");
    expect(entry.context?.method).toBe("private_pay");
    expect(entry.context?.errorCode).toBe("CONTRACT_REVERT");
    // Raw sensitive values must not appear anywhere in the serialized entry
    expect(JSON.stringify(entry)).not.toContain(SENSITIVE_RECIPIENT);
    expect(JSON.stringify(entry)).not.toContain(SENSITIVE_AMOUNT.toString());
  });
});

// ─── 8. Fields NOT in the default set (salary, employer, employee, commitment) ──

describe("Redaction — fields outside the default sensitive set", () => {
  it("salary is NOT redacted by default — callers must use additionalFields", () => {
    const { redacted: withDefault } = redactObject({ salary: SENSITIVE_SALARY });
    // Deliberately not redacted without additionalFields
    expect(withDefault.salary).toBe(SENSITIVE_SALARY);

    const { redacted: withExtra } = redactObject(
      { salary: SENSITIVE_SALARY },
      { additionalFields: ["salary"] }
    );
    expect(withExtra.salary).toBe("[redacted]");
  });

  it("employer, employee, commitmentHash are redacted when listed in additionalFields", () => {
    const context = {
      employer: SENSITIVE_EMPLOYER,
      employee: SENSITIVE_EMPLOYEE,
      commitmentHash: SENSITIVE_COMMITMENT,
      cycleId: "2025-Q2",
    };

    const { redacted, fieldsRedacted } = redactObject(context, {
      additionalFields: ["employer", "employee", "commitmentHash"],
    });

    expect(redacted.employer).toBe("[redacted]");
    expect(redacted.employee).toBe("[redacted]");
    expect(redacted.commitmentHash).toBe("[redacted]");
    expect(redacted.cycleId).toBe("2025-Q2");
    expect(fieldsRedacted).toEqual(
      expect.arrayContaining(["employer", "employee", "commitmentHash"])
    );
  });

  it("deeply redacts payroll-specific fields when additionalFields is supplied", () => {
    const registryFailureLog = {
      event: "registry_update_failed",
      entry: {
        employer: SENSITIVE_EMPLOYER,
        employee: SENSITIVE_EMPLOYEE,
        salary: SENSITIVE_SALARY,
        token: "CTOKEN_ADDRESS", // "token" IS in the default set
      },
    };

    const { redacted } = redactDeep(registryFailureLog, {
      additionalFields: ["employer", "employee", "salary"],
    });

    const typed = redacted as typeof registryFailureLog;
    expect(typed.entry.employer).toBe("[redacted]");
    expect(typed.entry.employee).toBe("[redacted]");
    expect(typed.entry.salary).toBe("[redacted]");
    expect(typed.entry.token).toBe("[redacted]"); // default field
    expect(typed.event).toBe("registry_update_failed");
  });
});
