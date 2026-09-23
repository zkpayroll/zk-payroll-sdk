/**
 * Tests for the payroll signing payload inspector: building an
 * approver-reviewable summary from a batch, and verifying that a
 * payload's commitment actually matches the batch about to be signed.
 */

import {
  buildSigningPayload,
  computeBatchCommitment,
  verifyBatchCommitment,
} from "../src/signing/inspector";
import type { BatchPayload } from "../src/batch/BatchPayloadBuilder";
import type { PayrollPeriodMetadata } from "../src/simulation/types";
import { redactAmount, redactIdentifier } from "../src/privacy/redaction";

const EMPLOYER = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const PERIOD: PayrollPeriodMetadata = {
  periodId: "2026-Q3-P2",
  startDate: "2026-08-01T00:00:00.000Z",
  endDate: "2026-08-31T00:00:00.000Z",
};

function makeBatch(): BatchPayload {
  return {
    entries: [
      { recipient: "GAAA1", amount: 100_000_000n, asset: "native" },
      { recipient: "GBBB2", amount: 250_000_000n, asset: "native" },
      { recipient: "GCCC3", amount: 50_000_000n, asset: "CUSDCASSET123" },
    ],
    totalAmount: 400_000_000n,
  };
}

describe("buildSigningPayload", () => {
  it("groups entries by asset without exposing individual amounts", () => {
    const batch = makeBatch();
    const payload = buildSigningPayload(batch, EMPLOYER, PERIOD, 1);

    expect(payload.employer).toBe(EMPLOYER);
    expect(payload.periodId).toBe("2026-Q3-P2");
    expect(payload.policyVersion).toBe(1);
    expect(payload.totalRecipients).toBe(3);

    expect(payload.assetGroups).toEqual(
      expect.arrayContaining([
        { asset: "native", recipientCount: 2, totalAmount: 350_000_000n },
        { asset: "CUSDCASSET123", recipientCount: 1, totalAmount: 50_000_000n },
      ])
    );

    const serialized = JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    expect(serialized).not.toContain("GAAA1");
    expect(serialized).not.toContain("GBBB2");
    expect(serialized).not.toContain("GCCC3");
  });

  it("produces a deterministic commitment for identical batches", () => {
    const a = buildSigningPayload(makeBatch(), EMPLOYER, PERIOD, 1);
    const b = buildSigningPayload(makeBatch(), EMPLOYER, PERIOD, 1);
    expect(a.batchCommitment).toBe(b.batchCommitment);
  });

  it("produces a different commitment when an amount changes", () => {
    const original = buildSigningPayload(makeBatch(), EMPLOYER, PERIOD, 1);

    const tampered = makeBatch();
    tampered.entries[0].amount = 999_000_000n;

    const tamperedPayload = buildSigningPayload(tampered, EMPLOYER, PERIOD, 1);
    expect(tamperedPayload.batchCommitment).not.toBe(original.batchCommitment);
  });

  it("produces a different commitment when entry order changes", () => {
    const batch = makeBatch();
    const reordered: BatchPayload = {
      entries: [...batch.entries].reverse(),
      totalAmount: batch.totalAmount,
    };

    expect(computeBatchCommitment(reordered)).not.toBe(computeBatchCommitment(batch));
  });
});

describe("verifyBatchCommitment", () => {
  it("returns true when the payload matches the candidate batch", () => {
    const batch = makeBatch();
    const payload = buildSigningPayload(batch, EMPLOYER, PERIOD, 1);
    expect(verifyBatchCommitment(payload, batch)).toBe(true);
  });

  it("returns false (never throws) when the batch has been tampered with", () => {
    const batch = makeBatch();
    const payload = buildSigningPayload(batch, EMPLOYER, PERIOD, 1);

    const tampered = makeBatch();
    tampered.entries[1].recipient = "GATTACKER99";

    expect(() => verifyBatchCommitment(payload, tampered)).not.toThrow();
    expect(verifyBatchCommitment(payload, tampered)).toBe(false);
  });

  it("returns false when an entry is added to the batch after signing", () => {
    const batch = makeBatch();
    const payload = buildSigningPayload(batch, EMPLOYER, PERIOD, 1);

    const withExtra: BatchPayload = {
      entries: [...batch.entries, { recipient: "GSNEAKY", amount: 1n, asset: "native" }],
      totalAmount: batch.totalAmount + 1n,
    };

    expect(verifyBatchCommitment(payload, withExtra)).toBe(false);
  });
});

describe("redaction helpers used alongside the inspector", () => {
  it("redacts amounts by default and reveals only when explicitly opted in", () => {
    expect(redactAmount(100_000_000n)).toBe("[REDACTED]");
    expect(redactAmount(100_000_000n, true)).toBe("100000000");
    expect(redactAmount(undefined, true)).toBe("[REDACTED]");
  });

  it("masks identifiers to a prefix/suffix by default", () => {
    expect(redactIdentifier(EMPLOYER)).toBe(`${EMPLOYER.slice(0, 4)}…${EMPLOYER.slice(-4)}`);
    expect(redactIdentifier(EMPLOYER, true)).toBe(EMPLOYER);
    expect(redactIdentifier(undefined)).toBe("[REDACTED]");
    expect(redactIdentifier("short")).toBe("[REDACTED]");
  });
});
