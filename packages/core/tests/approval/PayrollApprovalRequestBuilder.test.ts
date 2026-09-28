import {
  PayrollApprovalRequestBuilder,
  PayrollApprovalValidationError,
} from "../../src/approval/PayrollApprovalRequestBuilder";
import { maskIdentifier } from "../../src/approval/masking";

const futureExpiry = () => Date.now() + 86_400_000;

describe("PayrollApprovalRequestBuilder", () => {
  it("builds a valid approval request (happy path)", () => {
    const req = new PayrollApprovalRequestBuilder()
      .withApprovalId("APR-001")
      .withPayrollRunId("RUN-2026-09")
      .withApproverId("GABCDEFGHIJKLMNOP")
      .withRecipientId("GXYZ1234567890ABCD")
      .withAmount(1000n)
      .withAsset("native")
      .withExpiresAt(futureExpiry())
      .build();

    expect(req.approvalId).toBe("APR-001");
    expect(req.amount).toBe(1000n);
    expect(req.asset).toBe("native");
  });

  it("rejects a duplicate recipient with a masked identifier (edge case)", () => {
    const recipient = "GXYZ1234567890ABCD";
    const builder = new PayrollApprovalRequestBuilder()
      .withApprovalId("APR-002")
      .withPayrollRunId("RUN-2026-09")
      .withApproverId("GABCDEFGHIJKLMNOP")
      .withRecipientId(recipient)
      .withRecipientId(recipient) // duplicate
      .withAmount(1000n)
      .withAsset("native")
      .withExpiresAt(futureExpiry());

    const result = builder.validate();
    expect(result.ok).toBe(false);

    const dup = result.errors.find((e) => e.code === "DUPLICATE_RECIPIENT");
    expect(dup).toBeDefined();
    expect(dup!.message).toContain(maskIdentifier(recipient));
    expect(dup!.message).not.toContain(recipient);
  });

  it("throws a sanitized error on build with missing fields", () => {
    const attempt = () => new PayrollApprovalRequestBuilder().build();
    expect(attempt).toThrow(PayrollApprovalValidationError);

    try {
      attempt();
    } catch (e) {
      const err = e as PayrollApprovalValidationError;
      expect(err.code).toBe("PAYROLL_APPROVAL_VALIDATION_FAILED");
      expect(err.message).not.toMatch(/undefined|null|NaN/);
    }
  });

  it("flags warnings without failing the build", () => {
    const longMemo = "a".repeat(200);
    const builder = new PayrollApprovalRequestBuilder()
      .withApprovalId("APR-003")
      .withPayrollRunId("RUN-2026-09")
      .withApproverId("GABCDEFGHIJKLMNOP")
      .withRecipientId("GXYZ1234567890ABCD")
      .withAmount(500n)
      .withAsset("native")
      .withExpiresAt(futureExpiry())
      .withMemo(longMemo);

    const result = builder.validate();
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("LONG_MEMO");
  });

  it("rejects a past expiry timestamp", () => {
    const result = new PayrollApprovalRequestBuilder()
      .withApprovalId("APR-004")
      .withPayrollRunId("RUN-2026-09")
      .withApproverId("GABCDEFGHIJKLMNOP")
      .withRecipientId("GXYZ1234567890ABCD")
      .withAmount(100n)
      .withAsset("native")
      .withExpiresAt(Date.now() - 1000)
      .validate();

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("INVALID_EXPIRY");
  });
});
