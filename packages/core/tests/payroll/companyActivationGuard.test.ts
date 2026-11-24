/**
 * Tests for Company Activation State Guard (#752)
 *
 * Covers:
 *  - normalizeActivationStatus — status mapping incl. unknown values
 *  - evaluateCompanyActivation — success, rejected, and boundary cases
 *  - assertCompanyCanReserveFunds / guardFundReservation — throwing guards
 *  - Privacy: error messages never expose full company addresses or payroll data
 */

import {
  normalizeActivationStatus,
  evaluateCompanyActivation,
  assertCompanyCanReserveFunds,
  guardFundReservation,
  CompanyNotActivatedError,
  assertCompanyCanSubmitPayroll,
  guardPayrollSubmission,
  validateCompanyActivationForSubmission,
  PayrollSubmissionCompanyNotActivatedError,
} from "../../src/payroll/companyActivationGuard";

const TEST_COMPANY = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGH234567ABCDEF";

describe("normalizeActivationStatus", () => {
  it("maps active-like values to active", () => {
    expect(normalizeActivationStatus("active")).toBe("active");
    expect(normalizeActivationStatus("ACTIVATED")).toBe("active");
    expect(normalizeActivationStatus("enabled")).toBe("active");
  });

  it("maps pending values", () => {
    expect(normalizeActivationStatus("pending")).toBe("pending_activation");
    expect(normalizeActivationStatus("pending_activation")).toBe("pending_activation");
    expect(normalizeActivationStatus("onboarding")).toBe("pending_activation");
    expect(normalizeActivationStatus("Pending Activation")).toBe("pending_activation");
  });

  it("maps suspended values", () => {
    expect(normalizeActivationStatus("suspended")).toBe("suspended");
    expect(normalizeActivationStatus("paused")).toBe("suspended");
  });

  it("maps deactivated values", () => {
    expect(normalizeActivationStatus("deactivated")).toBe("deactivated");
    expect(normalizeActivationStatus("disabled")).toBe("deactivated");
    expect(normalizeActivationStatus("closed")).toBe("deactivated");
  });

  it("maps unknown and empty to unknown", () => {
    expect(normalizeActivationStatus("something_else")).toBe("unknown");
    expect(normalizeActivationStatus("")).toBe("unknown");
    expect(normalizeActivationStatus(undefined)).toBe("unknown");
    expect(normalizeActivationStatus(null)).toBe("unknown");
  });

  it("normalizes hyphens and spaces to underscores", () => {
    expect(normalizeActivationStatus("pending-activation")).toBe("pending_activation");
    expect(normalizeActivationStatus("pending activation")).toBe("pending_activation");
  });
});

describe("evaluateCompanyActivation", () => {
  it("returns canReserveFunds=true for an active company (successful case)", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "active",
    });
    expect(state.status).toBe("active");
    expect(state.canReserveFunds).toBe(true);
    expect(state.blockReason).toBe("none");
  });

  it("returns canReserveFunds=false for pending activation (rejected case)", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "pending",
    });
    expect(state.status).toBe("pending_activation");
    expect(state.canReserveFunds).toBe(false);
    expect(state.blockReason).toBe("COMPANY_PENDING_ACTIVATION");
  });

  it("returns canReserveFunds=false for suspended companies", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "suspended",
    });
    expect(state.canReserveFunds).toBe(false);
    expect(state.blockReason).toBe("COMPANY_SUSPENDED");
  });

  it("returns canReserveFunds=false for deactivated companies", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "deactivated",
    });
    expect(state.canReserveFunds).toBe(false);
    expect(state.blockReason).toBe("COMPANY_DEACTIVATED");
  });

  it("returns canReserveFunds=false for unknown status (boundary case)", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "mystery_state",
    });
    expect(state.status).toBe("unknown");
    expect(state.canReserveFunds).toBe(false);
    expect(state.blockReason).toBe("COMPANY_STATE_UNKNOWN");
  });

  it("handles missing rawStatus as unknown (boundary case)", () => {
    const state = evaluateCompanyActivation({ company: TEST_COMPANY });
    expect(state.status).toBe("unknown");
    expect(state.canReserveFunds).toBe(false);
  });

  it("enforces requireExplicitActivation when set", () => {
    const withoutFlag = evaluateCompanyActivation(
      { company: TEST_COMPANY, rawStatus: "active" },
      { requireExplicitActivation: true }
    );
    expect(withoutFlag.canReserveFunds).toBe(false);
    expect(withoutFlag.blockReason).toBe("COMPANY_NOT_ACTIVATED");

    const withFlag = evaluateCompanyActivation(
      { company: TEST_COMPANY, rawStatus: "active", isActivated: true },
      { requireExplicitActivation: true }
    );
    expect(withFlag.canReserveFunds).toBe(true);
  });

  it("respects custom allowedStatuses", () => {
    const state = evaluateCompanyActivation(
      { company: TEST_COMPANY, rawStatus: "pending" },
      { allowedStatuses: ["active", "pending_activation"] }
    );
    expect(state.canReserveFunds).toBe(true);
  });

  it("includes activatedAt when provided", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "active",
      activatedAt: 1700000000000,
    });
    expect(state.activatedAt).toBe(1700000000000);
  });

  it("masks the company address in redactedCompany", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "active",
    });
    expect(state.redactedCompany).not.toBe(TEST_COMPANY);
    expect(state.redactedCompany.length).toBeLessThan(TEST_COMPANY.length);
    expect(state.redactedCompany).toContain("…");
  });

  it("uses the injected clock for fetchedAt", () => {
    const fixed = 1700000000000;
    const state = evaluateCompanyActivation(
      { company: TEST_COMPANY, rawStatus: "active" },
      { now: () => fixed }
    );
    expect(state.fetchedAt).toBe(fixed);
  });

  it("does not leak payroll data in the state object", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "suspended",
    });
    const json = JSON.stringify(state);
    expect(json.toLowerCase()).not.toContain("salary");
    expect(json.toLowerCase()).not.toContain("amount");
    expect(json.toLowerCase()).not.toContain("recipient");
    expect(state.redactedCompany).not.toBe(TEST_COMPANY);
  });
});

describe("assertCompanyCanReserveFunds", () => {
  it("does not throw for an activated company", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "active",
    });
    expect(() => assertCompanyCanReserveFunds(state)).not.toThrow();
  });

  it("throws CompanyNotActivatedError for inactive companies", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "suspended",
    });
    expect(() => assertCompanyCanReserveFunds(state)).toThrow(CompanyNotActivatedError);
  });

  it("attaches the state and a stable code to the error", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "pending",
    });
    try {
      assertCompanyCanReserveFunds(state);
    } catch (e) {
      expect(e).toBeInstanceOf(CompanyNotActivatedError);
      const err = e as CompanyNotActivatedError;
      expect(err.code).toBe("COMPANY_PENDING_ACTIVATION");
      expect(err.state.status).toBe("pending_activation");
    }
  });

  it("error message is privacy-safe", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "deactivated",
    });
    try {
      assertCompanyCanReserveFunds(state);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain(TEST_COMPANY);
      expect(msg.toLowerCase()).not.toContain("salary");
      expect(msg.toLowerCase()).not.toContain("balance");
    }
  });
});

describe("guardFundReservation", () => {
  it("returns the state when reservation is allowed", () => {
    const state = guardFundReservation({ company: TEST_COMPANY, rawStatus: "active" });
    expect(state.canReserveFunds).toBe(true);
  });

  it("throws when reservation is blocked", () => {
    expect(() => guardFundReservation({ company: TEST_COMPANY, rawStatus: "deactivated" })).toThrow(
      CompanyNotActivatedError
    );
  });

  it("propagates options", () => {
    const state = guardFundReservation(
      { company: TEST_COMPANY, rawStatus: "active", isActivated: true },
      { requireExplicitActivation: true }
    );
    expect(state.canReserveFunds).toBe(true);
  });
});

describe("Payroll Submission Activation Guard (#995)", () => {
  it("allows payroll submission for active companies", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "active",
    });
    expect(state.canSubmitPayroll).toBe(true);
    expect(() => assertCompanyCanSubmitPayroll(state)).not.toThrow();

    const guardedState = guardPayrollSubmission({
      company: TEST_COMPANY,
      rawStatus: "active",
    });
    expect(guardedState.canSubmitPayroll).toBe(true);

    const check = validateCompanyActivationForSubmission({
      company: TEST_COMPANY,
      rawStatus: "active",
    });
    expect(check.canSubmit).toBe(true);
    expect(check.error).toBeUndefined();
  });

  it("blocks payroll submission for pending, suspended, or deactivated companies", () => {
    const statuses = ["pending", "suspended", "deactivated", "unknown"];
    for (const rawStatus of statuses) {
      const state = evaluateCompanyActivation({
        company: TEST_COMPANY,
        rawStatus,
      });
      expect(state.canSubmitPayroll).toBe(false);

      expect(() => assertCompanyCanSubmitPayroll(state)).toThrow(
        PayrollSubmissionCompanyNotActivatedError
      );
      expect(() =>
        guardPayrollSubmission({ company: TEST_COMPANY, rawStatus })
      ).toThrow(PayrollSubmissionCompanyNotActivatedError);

      const check = validateCompanyActivationForSubmission({
        company: TEST_COMPANY,
        rawStatus,
      });
      expect(check.canSubmit).toBe(false);
      expect(check.error).toContain("Complete company activation before submitting payroll");
    }
  });

  it("ensures submission error messages are privacy-safe", () => {
    const state = evaluateCompanyActivation({
      company: TEST_COMPANY,
      rawStatus: "suspended",
    });
    try {
      assertCompanyCanSubmitPayroll(state);
      fail("expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(PayrollSubmissionCompanyNotActivatedError);
      const error = err as PayrollSubmissionCompanyNotActivatedError;
      expect(error.code).toBe("COMPANY_SUSPENDED");
      expect(error.message).toContain("Cannot submit payroll");
      // Protects privacy: no full company address or payroll terms
      expect(error.message).not.toContain(TEST_COMPANY);
      expect(error.message.toLowerCase()).not.toContain("salary");
      expect(error.message.toLowerCase()).not.toContain("employee");
    }
  });
});

