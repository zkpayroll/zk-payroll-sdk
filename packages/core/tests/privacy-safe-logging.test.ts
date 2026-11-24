/**
 * Privacy-safe logging guarantees for SDK log output (#979).
 *
 * Covers:
 *  - Engine default fields and payroll fields are redacted in logged context.
 *  - Operational fields (transaction hash, error code, step) pass through.
 *  - The caller's context object is never mutated.
 *  - The process-wide logger applies the same redaction.
 */

import {
  createHookLogger,
  getSdkLogger,
  redactSensitive,
  resetSdkLogger,
  setSdkLogger,
  LogEvent,
} from "../src/logging/SdkLogger";

describe("privacy-safe SDK logging", () => {
  afterEach(() => {
    resetSdkLogger();
  });

  it("redacts engine default fields in logged context", () => {
    const received: LogEvent[] = [];
    const logger = createHookLogger((entry) => received.push(entry));

    logger.error("payment_failed", {
      recipient: "GRECIPIENTADDRESS",
      amount: 500n,
      privateKey: "SSECRETSEED",
    });

    expect(received[0].context).toEqual({
      recipient: "[redacted]",
      amount: "[redacted]",
      privateKey: "[redacted]",
    });
  });

  it("redacts payroll fields that the engine does not redact by default", () => {
    const context = {
      salary: "120000",
      salaryAmount: "120000",
      employee: "GEMPLOYEEADDRESS",
      employer: "GEMPLOYERADDRESS",
      commitmentHash: "abc123",
      nullifier: "def456",
    };

    const safe = redactSensitive(context);

    for (const key of Object.keys(context)) {
      expect(safe[key]).toBe("[redacted]");
    }
  });

  it("keeps operational fields such as transaction hash, step, and error code", () => {
    const safe = redactSensitive({
      txHash: "0xabc",
      step: "proof_generation",
      errorCode: "PROOF_GENERATION_FAILED",
      count: 3,
    });

    expect(safe).toEqual({
      txHash: "0xabc",
      step: "proof_generation",
      errorCode: "PROOF_GENERATION_FAILED",
      count: 3,
    });
  });

  it("does not mutate the caller's context object", () => {
    const context = { salary: "120000", txHash: "0x1" };

    redactSensitive(context);

    expect(context).toEqual({ salary: "120000", txHash: "0x1" });
  });

  it("applies the same redaction to the process-wide logger", () => {
    const entries: LogEvent[] = [];
    setSdkLogger((entry) => entries.push(entry));

    getSdkLogger().warn("salary_mismatch", { salary: "120000", employee: "GEMPLOYEEADDRESS" });

    expect(entries[0].context).toEqual({ salary: "[redacted]", employee: "[redacted]" });
  });
});
