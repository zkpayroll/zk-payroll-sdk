/**
 * Transaction Receipt Redaction Snapshot Tests
 *
 * Locks the redacted output of receipts, verification results, nested
 * metadata trees, and error logs to stored snapshots so any redaction
 * regression (a sensitive value leaking through, an operational field
 * disappearing, or a placeholder changing) fails CI loudly.
 *
 * Redaction policy expectations are documented in:
 *   - tests/redaction-snapshots/README.md (authoritative policy table)
 *   - docs/RECEIPT_VERIFICATION.md (consumer-facing guide)
 *
 * To update snapshots after intentional changes:
 *   npm test -- redaction-snapshots --updateSnapshot
 */

import {
  verifyPayrollReceipt,
  redactReceiptForExport,
  ReceiptVerificationCode,
} from "../../src/receipts";
import { redactDeep, redactObject } from "../../src/redaction/RedactionEngine";
import { formatRedactedError } from "../../src/errors";
import {
  DEFAULT_REDACTION_OPTIONS,
  FAILURE_METADATA_DIGEST,
  FAILURE_RECEIPT_OPERATIONAL_VALUES,
  MASK_REDACTION_OPTIONS,
  NESTED_REDACTION_TREE,
  PAYROLL_REDACTION_OPTIONS,
  RAW_ERROR_LOG_ENTRY,
  RAW_ERROR_MESSAGES,
  RECEIPT_FAILED_SETTLEMENT,
  RECEIPT_MALFORMED,
  RECEIPT_SUCCESS_SETTLED,
  REDACTION_SNAPSHOT_SENSITIVE_VALUES,
  REMOVE_REDACTION_OPTIONS,
  SUCCESS_RECEIPT_METADATA,
  SUCCESS_RECEIPT_OPERATIONAL_VALUES,
  SUCCESS_TX_REFERENCE,
} from "../fixtures/redaction-snapshot-fixtures";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** JSON-safe stringify that tolerates BigInt values (replaced by string). */
function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** Every raw sensitive value that must NOT appear anywhere in the payload. */
function assertNoSensitiveValues(payload: unknown): void {
  const serialized = safeStringify(payload);
  for (const sensitive of REDACTION_SNAPSHOT_SENSITIVE_VALUES) {
    expect(serialized).not.toContain(sensitive);
  }
}

/** Operational values that MUST remain present so output stays useful. */
function assertOperationalValuesPresent(payload: unknown, expected: readonly string[]): void {
  const serialized = safeStringify(payload);
  for (const operational of expected) {
    expect(serialized).toContain(operational);
  }
}

/**
 * Stable projection of a ReceiptVerificationResult for snapshotting.
 * `verifiedAt` is wall-clock derived and intentionally excluded.
 */
function projectVerificationResult(result: ReturnType<typeof verifyPayrollReceipt>): {
  isValid: boolean;
  settlementStatus: ReturnType<typeof verifyPayrollReceipt>["settlementStatus"];
  issueCodes: string[];
  verifiedFields: ReturnType<typeof verifyPayrollReceipt>["verifiedFields"];
  receipt: ReturnType<typeof verifyPayrollReceipt>["receipt"];
} {
  return {
    isValid: result.isValid,
    settlementStatus: result.settlementStatus,
    issueCodes: result.issues.map((i) => i.code),
    verifiedFields: result.verifiedFields,
    receipt: result.receipt,
  };
}

// ─── Success receipts ───────────────────────────────────────────────────────

describe("Redaction Snapshots — success receipts", () => {
  it("redacts a settled receipt with default engine options", () => {
    const redacted = redactReceiptForExport(RECEIPT_SUCCESS_SETTLED, DEFAULT_REDACTION_OPTIONS);

    // Baseline engine vocabulary (recipients, keys, tokens) never leaks…
    for (const sensitive of [
      "GARECIPIENT111111111111111111111111111111111111111111111111SNAP01",
      "SAPRIVATEKEYSECRETVALUE0000000000000000000000000000000snap",
    ]) {
      expect(safeStringify(redacted)).not.toContain(sensitive);
    }
    // …but operational fields remain useful.
    assertOperationalValuesPresent(redacted, [
      ...SUCCESS_RECEIPT_OPERATIONAL_VALUES,
      "vk_snap_compliance_01",
      "GSIGNERSNAPPUBLICKEY000000000000000000000000000000000000sn0",
    ]);
    expect(redacted.redacted).toBe(true);
    expect((redacted.transactionReference as { ledger: number }).ledger).toBe(1234567);

    expect(redacted).toMatchSnapshot("settled receipt / default redaction");
  });

  it("hides payroll aggregates only when the payroll preset is used", () => {
    const baseline = redactReceiptForExport(RECEIPT_SUCCESS_SETTLED, DEFAULT_REDACTION_OPTIONS);
    const payroll = redactReceiptForExport(RECEIPT_SUCCESS_SETTLED, PAYROLL_REDACTION_OPTIONS);

    // Policy note locked as a test: `totalAmount` / `salaryBand` are NOT part
    // of the engine defaults; exports must opt into the payroll preset.
    expect(baseline.totalAmount).toBe("12500000");
    expect(payroll.totalAmount).toBe("[REDACTED]");
    expect(payroll.metadata?.lineItems).toEqual([
      expect.objectContaining({ salaryBand: "L5", recipient: "[REDACTED]", amount: "[REDACTED]" }),
      expect.objectContaining({ salaryBand: "L3", recipient: "[REDACTED]", amount: "[REDACTED]" }),
    ]);
  });

  it("snapshots a fully redacted settled receipt with the payroll preset", () => {
    const redacted = redactReceiptForExport(RECEIPT_SUCCESS_SETTLED, PAYROLL_REDACTION_OPTIONS);

    assertNoSensitiveValues(redacted);
    assertOperationalValuesPresent(redacted, [
      ...SUCCESS_RECEIPT_OPERATIONAL_VALUES,
      "runLabel",
      "Engineering",
      "batch_snap_001",
      "kv/payroll/testnet/signer",
    ]);

    expect(redacted).toMatchSnapshot("settled receipt / payroll preset");
  });

  it("masks values while preserving shapes", () => {
    const masked = redactReceiptForExport(RECEIPT_SUCCESS_SETTLED, MASK_REDACTION_OPTIONS);

    assertNoSensitiveValues(masked);
    const disbursement = masked.metadata?.disbursement as Record<string, unknown>;
    expect(disbursement.recipient).toMatch(/^GA\*+01$/);
    expect(disbursement.amount).toMatch(/^12\*+00$/);
    expect(masked.settlementStatus).toBe("settled");

    expect(masked).toMatchSnapshot("settled receipt / mask mode");
  });

  it("drops sensitive keys entirely in remove mode", () => {
    const removed = redactReceiptForExport(RECEIPT_SUCCESS_SETTLED, REMOVE_REDACTION_OPTIONS);

    assertNoSensitiveValues(removed);
    const metadata = removed.metadata as Record<string, unknown>;
    expect(metadata.secret).toBeUndefined();
    expect(metadata.disbursement).toEqual({ batchId: "batch_snap_001", currency: "XLM" });
    expect(removed.totalAmount).toBeUndefined();
    expect(metadata.runLabel).toBe("August 2026 payroll cycle");

    expect(removed).toMatchSnapshot("settled receipt / remove mode");
  });

  it("snapshots the sanitized receipt returned by verifyPayrollReceipt", () => {
    const result = verifyPayrollReceipt(RECEIPT_SUCCESS_SETTLED, {
      expectedPayrollId: RECEIPT_SUCCESS_SETTLED.payrollId,
      expectedTransactionHash: SUCCESS_TX_REFERENCE.txHash,
      redactionOptions: PAYROLL_REDACTION_OPTIONS,
    });

    expect(result.isValid).toBe(true);
    expect(result.issues.map((i) => i.code)).toEqual([]);

    const projected = projectVerificationResult(result);
    assertNoSensitiveValues(projected);
    assertOperationalValuesPresent(projected, [
      "rcpt_snap_success_0001",
      SUCCESS_TX_REFERENCE.txHash,
    ]);

    expect(projected).toMatchSnapshot("verification result / settled receipt");
  });
});

// ─── Failure receipts ───────────────────────────────────────────────────────

describe("Redaction Snapshots — failure receipts", () => {
  it("redacts a failed-settlement receipt with the payroll preset", () => {
    const redacted = redactReceiptForExport(RECEIPT_FAILED_SETTLEMENT, PAYROLL_REDACTION_OPTIONS);

    assertNoSensitiveValues(redacted);
    assertOperationalValuesPresent(redacted, [
      ...FAILURE_RECEIPT_OPERATIONAL_VALUES,
      "proof_generation",
      "constraint unsatisfied",
      FAILURE_METADATA_DIGEST,
    ]);
    expect(redacted.settledAt).toBeUndefined();
    expect(redacted.redacted).toBe(true);

    expect(redacted).toMatchSnapshot("failed receipt / payroll preset");
  });

  it("drops payroll-only sensitive keys in remove mode on failure receipts", () => {
    const removed = redactReceiptForExport(RECEIPT_FAILED_SETTLEMENT, REMOVE_REDACTION_OPTIONS);

    assertNoSensitiveValues(removed);
    const metadata = removed.metadata as Record<string, unknown>;
    expect(metadata.salaryAmount).toBeUndefined();
    expect(metadata.employer).toBeUndefined();
    expect(metadata.employee).toBeUndefined();
    expect(metadata.commitmentHash).toBeUndefined();
    expect(metadata.nullifier).toBeUndefined();
    expect(metadata.failureStage).toBe("proof_generation");
    // `witness` belongs to the baseline set — dropped even without payroll fields
    expect(metadata.diagnostics).toEqual([
      { step: "witness_load", status: "ok" },
      { step: "prove", status: "error", detail: "constraint unsatisfied" },
    ]);

    expect(removed).toMatchSnapshot("failed receipt / remove mode");
  });

  it("snapshots verification results for failed and malformed receipts", () => {
    const failed = verifyPayrollReceipt(RECEIPT_FAILED_SETTLEMENT, {
      redactionOptions: PAYROLL_REDACTION_OPTIONS,
    });
    const malformed = verifyPayrollReceipt(RECEIPT_MALFORMED, {
      redactionOptions: PAYROLL_REDACTION_OPTIONS,
    });

    expect(failed.isValid).toBe(false);
    expect(malformed.isValid).toBe(false);
    expect(failed.issues.map((i) => i.code)).toContain(ReceiptVerificationCode.UNSETTLED_STATUS);
    expect(malformed.issues.map((i) => i.code)).toContain(ReceiptVerificationCode.INVALID_SHAPE);

    const projectedFailed = projectVerificationResult(failed);
    const projectedMalformed = projectVerificationResult(malformed);

    assertNoSensitiveValues(projectedFailed);
    assertNoSensitiveValues(projectedMalformed);

    expect(projectedFailed).toMatchSnapshot("verification result / failed receipt");
    expect(projectedMalformed).toMatchSnapshot("verification result / malformed receipt");
  });
});

// ─── Nested objects & arrays ────────────────────────────────────────────────

describe("Redaction Snapshots — nested objects and arrays", () => {
  it("deep-redacts sensitive keys at every depth", () => {
    const { redacted, fieldsRedacted } = redactDeep(NESTED_REDACTION_TREE);

    assertNoSensitiveValues(redacted);
    // Sensitive keys live at depth 1, 2, 3 and inside array elements
    expect([...fieldsRedacted].sort()).toEqual(
      ["amount", "authorization", "recipient", "refresh_token", "seed", "signingKey"].sort()
    );
    const tree = redacted as typeof NESTED_REDACTION_TREE;
    expect(tree.tags).toEqual(["net-90", "ops"]);
    expect(tree.recipients).toHaveLength(2);
    expect(tree.auth.nested.deeper.signingKey).toBe("[redacted]");

    expect({ redacted, fieldsRedacted }).toMatchSnapshot("nested tree / default");
  });

  it("deep-redacts arrays of objects in receipt metadata", () => {
    const { redacted, fieldsRedacted } = redactDeep(SUCCESS_RECEIPT_METADATA);

    assertNoSensitiveValues(redacted);
    const lineItems = (
      redacted as Record<string, unknown> & { lineItems: Array<Record<string, unknown>> }
    ).lineItems;
    expect(lineItems[0].employeeRef).toBe("emp_snap_001");
    expect(lineItems[0].role).toBe("engineer");
    expect(fieldsRedacted).toEqual(
      expect.arrayContaining(["recipient", "amount", "privateKey", "apiKey", "secret"])
    );

    expect({ redacted, fieldsRedacted }).toMatchSnapshot("success metadata tree / default");
  });

  it("catches payroll-only keys only when they are configured", () => {
    const withDefaults = redactDeep(RECEIPT_FAILED_SETTLEMENT.metadata);
    const withPreset = redactDeep(RECEIPT_FAILED_SETTLEMENT.metadata, PAYROLL_REDACTION_OPTIONS);

    // The baseline engine misses salary/employer/employee/commitment/nullifier…
    expect(withDefaults.fieldsRedacted).not.toContain("employer");
    expect(withDefaults.fieldsRedacted).toContain("witness");
    // …the payroll preset catches them all.
    expect(withPreset.fieldsRedacted).toEqual(
      expect.arrayContaining([
        "salaryAmount",
        "employer",
        "employee",
        "commitmentHash",
        "nullifier",
      ])
    );
    assertNoSensitiveValues(withPreset.redacted);

    expect({ withDefaults, withPreset }).toMatchSnapshot("failure metadata trees");
  });
});

// ─── Errors and logs ────────────────────────────────────────────────────────

describe("Redaction Snapshots — errors and logs", () => {
  it("sanitizes inline sensitive values in error messages", () => {
    const formatted = RAW_ERROR_MESSAGES.map((message) => formatRedactedError(new Error(message)));

    assertNoSensitiveValues(formatted);
    for (const entry of formatted) {
      expect(entry.message).toContain("[redacted]");
      expect(entry.code).toBe("UNKNOWN_RPC_ERROR");
    }

    expect(formatted).toMatchSnapshot("inline error messages");
  });

  it("produces an audit-safe error log entry", () => {
    // Exactly what a log sink should do: sanitize message + context before emit
    const { message } = formatRedactedError(new Error(RAW_ERROR_LOG_ENTRY.msg), "[REDACTED]");
    const { redacted: safeContext } = redactObject(RAW_ERROR_LOG_ENTRY.context);

    const loggedPayload = {
      level: RAW_ERROR_LOG_ENTRY.level,
      event: RAW_ERROR_LOG_ENTRY.event,
      msg: message,
      txHash: RAW_ERROR_LOG_ENTRY.txHash,
      context: safeContext,
    };

    assertNoSensitiveValues(loggedPayload);
    assertOperationalValuesPresent(loggedPayload, [
      RAW_ERROR_LOG_ENTRY.txHash,
      "tx_snap_error_0001",
      "settlement_failed",
    ]);

    expect(loggedPayload).toMatchSnapshot("error log entry / redacted");
  });

  it("keeps operational error context intact after shallow redaction", () => {
    const { redacted, fieldsRedacted } = redactObject(RAW_ERROR_LOG_ENTRY.context);

    expect([...fieldsRedacted].sort()).toEqual(["amount", "apiKey", "recipient"].sort());
    expect(redacted.transactionId).toBe("tx_snap_error_0001");
    expect(redacted.network).toBe("testnet");
    expect(redacted.contractId).toBe("CBULKPAYROLLCONTRACTID000000000000000000000000000000snap00");

    expect({ redacted, fieldsRedacted }).toMatchSnapshot("error context object");
  });
});

// ─── Regression tripwires ───────────────────────────────────────────────────

describe("Redaction Snapshots — regression tripwires", () => {
  it("fails if redaction is ever bypassed on receipts", () => {
    const redacted = redactReceiptForExport(RECEIPT_SUCCESS_SETTLED, PAYROLL_REDACTION_OPTIONS);
    const raw = RECEIPT_SUCCESS_SETTLED.metadata as Record<string, unknown>;
    const safe = redacted.metadata as Record<string, unknown>;

    // If these ever equal the raw metadata again, redaction regressed.
    expect(safe).not.toEqual(raw);
    expect(safe.lineItems).not.toEqual(raw.lineItems);
    expect(safe.credentials).not.toEqual(raw.credentials);
  });

  it("locks the exact-match, case-sensitive matching rule of the engine", () => {
    const { fieldsRedacted } = redactObject({
      TotalAmount: "12500000",
      total_amount: "12500000",
      amount: "12500000",
    });
    expect(fieldsRedacted).toEqual(["amount"]);
  });
});
