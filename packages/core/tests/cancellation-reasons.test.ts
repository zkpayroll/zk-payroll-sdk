import {
  CANCELLATION_REASONS,
  getCancellationReasonLabel,
  getCancellationReasonDescription,
  isSupportedCancellationReason,
  type CancellationReasonCode,
} from "../src/payroll/cancellation";

describe("cancellation reasons", () => {
  it("exports at least one reason and every reason has a stable label", () => {
    expect(CANCELLATION_REASONS.length).toBeGreaterThan(0);
    for (const reason of CANCELLATION_REASONS) {
      expect(reason.label.length).toBeGreaterThan(0);
      expect(reason.description.length).toBeGreaterThan(0);
    }
  });

  it("includes an 'other' fallback reason", () => {
    expect(CANCELLATION_REASONS.some((r) => r.code === "other")).toBe(true);
  });

  it("returns the correct label for a known code", () => {
    expect(getCancellationReasonLabel("insufficient_funds")).toBe("Insufficient funds");
  });

  it("returns the correct description for a known code", () => {
    expect(getCancellationReasonDescription("duplicate_run")).toContain("duplicate");
  });

  it("falls back to the raw code when given an unrecognized value", () => {
    const unknown = "not_a_real_code" as CancellationReasonCode;
    expect(getCancellationReasonLabel(unknown)).toBe("not_a_real_code");
    expect(getCancellationReasonDescription(unknown)).toBe("");
  });

  it("isSupportedCancellationReason correctly narrows valid and invalid codes", () => {
    expect(isSupportedCancellationReason("compliance_hold")).toBe(true);
    expect(isSupportedCancellationReason("bogus")).toBe(false);
  });

  it("has no duplicate codes", () => {
    const codes = CANCELLATION_REASONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
