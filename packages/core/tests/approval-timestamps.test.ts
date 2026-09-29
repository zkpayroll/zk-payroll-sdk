import {
  validateApprovalTimestamps,
  areApprovalTimestampsValid,
  ApprovalTimestampCode,
  DEFAULT_APPROVAL_CLOCK_SKEW_MS,
  type TimestampedApprovalRequest,
} from "../src/authorization/approvalTimestamps";
import type { SignerInfo } from "../src/authorization/types";

const NOW = 1_757_000_000_000;

function request(overrides: Partial<TimestampedApprovalRequest> = {}): TimestampedApprovalRequest {
  return {
    createdAt: NOW - 60_000,
    expiresAt: NOW + 3_600_000,
    signers: [],
    ...overrides,
  };
}

function signer(overrides: Partial<SignerInfo> = {}): SignerInfo {
  return {
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    role: "payroll_admin",
    state: "pending",
    ...overrides,
  };
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

describe("Approval timestamp validation (#557)", () => {
  describe("valid requests", () => {
    it("accepts a well-formed request with no signers yet", () => {
      const result = validateApprovalTimestamps(request(), { now: NOW });

      expect(result.isValid).toBe(true);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.issues).toHaveLength(0);
      expect(result.summary).toBe("Approval timestamps are valid.");
      expect(result.validatedAt).toBe(NOW);
      expect(result.clockSkewMs).toBe(DEFAULT_APPROVAL_CLOCK_SKEW_MS);
    });

    it("accepts a request with no expiry configured", () => {
      const result = validateApprovalTimestamps(request({ expiresAt: undefined }), { now: NOW });
      expect(result.isValid).toBe(true);
    });

    it("accepts a signed request whose signature falls inside the window", () => {
      const result = validateApprovalTimestamps(
        request({ signers: [signer({ state: "signed", signedAt: NOW - 30_000 })] }),
        { now: NOW }
      );
      expect(result.isValid).toBe(true);
    });

    it("accepts a small forward drift within the clock-skew tolerance", () => {
      const result = validateApprovalTimestamps(
        request({
          createdAt: NOW + 5_000,
          signers: [signer({ state: "signed", signedAt: NOW + 5_000 })],
        }),
        { now: NOW }
      );
      expect(result.isValid).toBe(true);
    });

    it("honours a custom clock-skew tolerance", () => {
      const drifted = request({ createdAt: NOW + 5_000 });

      expect(validateApprovalTimestamps(drifted, { now: NOW, clockSkewMs: 1_000 }).isValid).toBe(
        false
      );
      expect(validateApprovalTimestamps(drifted, { now: NOW, clockSkewMs: 10_000 }).isValid).toBe(
        true
      );
    });
  });

  describe("request-level timestamps", () => {
    it("rejects a missing createdAt", () => {
      const result = validateApprovalTimestamps(
        { expiresAt: NOW + 1000, signers: [] } as unknown as TimestampedApprovalRequest,
        { now: NOW }
      );

      expect(result.isValid).toBe(false);
      expect(codes(result.issues)).toContain(ApprovalTimestampCode.CREATED_AT_INVALID);
      expect(result.issues[0]?.field).toBe("createdAt");
    });

    it("rejects a non-finite, negative, or fractional createdAt", () => {
      const badValues = [Number.NaN, Number.POSITIVE_INFINITY, -5, NOW + 0.5];

      for (const createdAt of badValues) {
        const result = validateApprovalTimestamps(
          { createdAt, expiresAt: NOW + 1000, signers: [] } as TimestampedApprovalRequest,
          { now: NOW }
        );
        expect(codes(result.issues)).toContain(ApprovalTimestampCode.CREATED_AT_INVALID);
      }
    });

    it("rejects a createdAt beyond the allowed clock skew", () => {
      const result = validateApprovalTimestamps(
        request({ createdAt: NOW + DEFAULT_APPROVAL_CLOCK_SKEW_MS + 1 }),
        { now: NOW }
      );

      expect(result.isValid).toBe(false);
      expect(codes(result.issues)).toContain(ApprovalTimestampCode.CREATED_AT_IN_FUTURE);
      expect(result.summary).toMatch(/invalid/i);
    });

    it("rejects an unusable expiresAt", () => {
      const result = validateApprovalTimestamps(
        request({ expiresAt: Number.NaN as unknown as number }),
        { now: NOW }
      );
      expect(codes(result.issues)).toContain(ApprovalTimestampCode.EXPIRES_AT_INVALID);
    });

    it("rejects an expiresAt that precedes createdAt", () => {
      const result = validateApprovalTimestamps(
        request({ createdAt: NOW - 10_000, expiresAt: NOW - 20_000 }),
        { now: NOW }
      );

      expect(result.isValid).toBe(false);
      expect(codes(result.issues)).toContain(ApprovalTimestampCode.EXPIRES_AT_BEFORE_CREATED_AT);
    });
  });

  describe("signer timestamps", () => {
    it("rejects a signature recorded before the request existed", () => {
      const result = validateApprovalTimestamps(
        request({
          createdAt: NOW - 10_000,
          signers: [signer({ state: "signed", signedAt: NOW - 20_000 })],
        }),
        { now: NOW }
      );

      expect(result.isValid).toBe(false);
      expect(codes(result.issues)).toContain(ApprovalTimestampCode.SIGNED_AT_BEFORE_CREATED_AT);
    });

    it("rejects a late signature recorded after the window closed", () => {
      const result = validateApprovalTimestamps(
        request({ expiresAt: NOW - 1_000, signers: [signer({ state: "signed", signedAt: NOW })] }),
        { now: NOW }
      );

      expect(codes(result.issues)).toContain(ApprovalTimestampCode.SIGNED_AT_AFTER_EXPIRY);
    });

    it("rejects a far-future signature", () => {
      const result = validateApprovalTimestamps(
        request({ signers: [signer({ state: "signed", signedAt: NOW + 600_000 })] }),
        { now: NOW }
      );
      expect(codes(result.issues)).toContain(ApprovalTimestampCode.SIGNED_AT_IN_FUTURE);
    });

    it("rejects a signature and rejection recorded together", () => {
      const result = validateApprovalTimestamps(
        request({
          signers: [signer({ state: "signed", signedAt: NOW - 1_000, rejectedAt: NOW - 2_000 })],
        }),
        { now: NOW }
      );

      expect(codes(result.issues)).toContain(ApprovalTimestampCode.SIGNER_TIMESTAMP_CONFLICT);
    });

    it("rejects a rejection recorded before the request existed", () => {
      const result = validateApprovalTimestamps(
        request({
          createdAt: NOW - 10_000,
          signers: [signer({ state: "rejected", rejectedAt: NOW - 20_000 })],
        }),
        { now: NOW }
      );
      expect(codes(result.issues)).toContain(ApprovalTimestampCode.REJECTED_AT_BEFORE_CREATED_AT);
    });

    it("rejects a far-future rejection", () => {
      const result = validateApprovalTimestamps(
        request({ signers: [signer({ state: "rejected", rejectedAt: NOW + 600_000 })] }),
        { now: NOW }
      );
      expect(codes(result.issues)).toContain(ApprovalTimestampCode.REJECTED_AT_IN_FUTURE);
    });

    it("warns when a terminal signer state carries no outcome timestamp", () => {
      const result = validateApprovalTimestamps(
        request({ signers: [signer({ state: "signed" })] }),
        { now: NOW }
      );

      // Non-critical: the signature still verifies, only the audit trail is thin.
      expect(result.isValid).toBe(true);
      expect(result.warningCount).toBe(1);
      expect(codes(result.issues)).toContain(
        ApprovalTimestampCode.SIGNER_OUTCOME_TIMESTAMP_MISSING
      );
      expect(result.summary).toMatch(/warning/i);
    });

    it("promotes that warning to an error under strict mode", () => {
      const result = validateApprovalTimestamps(
        request({ signers: [signer({ state: "signed" })] }),
        {
          now: NOW,
          strict: true,
        }
      );

      expect(result.isValid).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.warningCount).toBe(0);
    });

    it("does not warn for a pending signer with no timestamps", () => {
      const result = validateApprovalTimestamps(request({ signers: [signer()] }), { now: NOW });
      expect(result.isValid).toBe(true);
      expect(result.warningCount).toBe(0);
    });
  });

  describe("diagnostics", () => {
    it("reports the offending signer index as the field", () => {
      const result = validateApprovalTimestamps(
        request({
          signers: [signer(), signer({ state: "signed", signedAt: NOW + 600_000 })],
        }),
        { now: NOW }
      );

      const issue = result.issues.find((i) => i.code === ApprovalTimestampCode.SIGNED_AT_IN_FUTURE);
      expect(issue?.field).toBe("signers[1].signedAt");
    });

    it("orders issues stably for the same input", () => {
      const input = request({
        createdAt: NOW + 600_000,
        signers: [signer({ state: "signed", signedAt: NOW + 600_000 })],
      });

      const first = validateApprovalTimestamps(input, { now: NOW });
      const second = validateApprovalTimestamps(input, { now: NOW });
      expect(codes(first.issues)).toEqual(codes(second.issues));
    });

    it("never includes a signer address or payroll value in its messages", () => {
      const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const result = validateApprovalTimestamps(
        request({ signers: [signer({ address, state: "signed", signedAt: NOW + 600_000 })] }),
        { now: NOW }
      );

      const allText = [...result.errors, ...result.warnings, result.summary].join(" ");
      expect(allText).not.toContain(address);
      expect(allText).not.toMatch(/salary|amount|wage|stroop/i);
    });

    it("marks every error as critical and every warning as non-critical", () => {
      const result = validateApprovalTimestamps(
        request({ signers: [signer({ state: "signed", signedAt: NOW + 600_000 })] }),
        { now: NOW }
      );

      for (const i of result.issues) {
        expect(i.critical).toBe(i.severity === "error");
      }
    });
  });

  describe("areApprovalTimestampsValid", () => {
    it("mirrors the full result for both outcomes", () => {
      expect(areApprovalTimestampsValid(request(), { now: NOW })).toBe(true);
      expect(
        areApprovalTimestampsValid(request({ expiresAt: NOW - 20_000, createdAt: NOW - 10_000 }), {
          now: NOW,
        })
      ).toBe(false);
    });
  });
});
