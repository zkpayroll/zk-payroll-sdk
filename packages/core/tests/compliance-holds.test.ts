/**
 * Tests for compliance hold client helpers (#320).
 */
import {
  buildPlaceHoldRequest,
  buildReleaseHoldRequest,
  validatePlaceHoldRequest,
  validateReleaseAuthorization,
  assertValidReleaseAuthorization,
  parseHoldStatus,
  explainHold,
  findBlockingHold,
  isPayrollActionBlocked,
  ComplianceHoldValidationError,
  HoldReleaseAuthorizationError,
  ZkPayrollError,
  type ComplianceHold,
  type PlaceHoldRequest,
  type ReleaseHoldRequest,
} from "../src";

function activeHold(overrides: Partial<ComplianceHold> = {}): ComplianceHold {
  return {
    holdId: "hold-1",
    target: { scope: "employer", id: "employer-1" },
    state: "active",
    reasonCode: "KYC_REVIEW_PENDING",
    placedBy: "compliance-officer-1",
    placedAt: 1000,
    ...overrides,
  };
}

describe("parseHoldStatus", () => {
  it("parses a well-formed active hold", () => {
    const raw = {
      holdId: "hold-1",
      scope: "employee",
      targetId: "emp-42",
      state: "active",
      reasonCode: "SANCTIONS_SCREENING",
      placedBy: "officer-a",
      placedAt: 1700000000000,
      note: "internal note",
    };

    const hold = parseHoldStatus(raw);

    expect(hold).toEqual({
      holdId: "hold-1",
      target: { scope: "employee", id: "emp-42" },
      state: "active",
      reasonCode: "SANCTIONS_SCREENING",
      placedBy: "officer-a",
      placedAt: 1700000000000,
      note: "internal note",
    });
  });

  it("parses a well-formed released hold, including release metadata", () => {
    const raw = {
      holdId: "hold-2",
      scope: "batch",
      targetId: "batch-9",
      state: "released",
      reasonCode: "DUPLICATE_PAYMENT_SUSPECTED",
      placedBy: "officer-b",
      placedAt: 1000,
      releasedBy: "officer-c",
      releasedAt: 2000,
      releaseReason: "Confirmed not a duplicate",
    };

    const hold = parseHoldStatus(raw);

    expect(hold.state).toBe("released");
    expect(hold.releasedBy).toBe("officer-c");
    expect(hold.releasedAt).toBe(2000);
    expect(hold.releaseReason).toBe("Confirmed not a duplicate");
  });

  it("falls back to 'unknown' state when the scope is missing", () => {
    const hold = parseHoldStatus({
      holdId: "hold-3",
      targetId: "employer-1",
      state: "active",
      reasonCode: "OTHER",
      placedBy: "officer-a",
      placedAt: 1000,
    });

    expect(hold.state).toBe("unknown");
  });

  it("falls back to 'unknown' state when the target id is missing", () => {
    const hold = parseHoldStatus({
      holdId: "hold-4",
      scope: "employer",
      state: "active",
      reasonCode: "OTHER",
      placedBy: "officer-a",
      placedAt: 1000,
    });

    expect(hold.state).toBe("unknown");
  });

  it("falls back to 'unknown' state when the raw state is unrecognized", () => {
    const hold = parseHoldStatus({
      holdId: "hold-5",
      scope: "employer",
      targetId: "employer-1",
      state: "on_hold_forever",
      reasonCode: "OTHER",
      placedBy: "officer-a",
      placedAt: 1000,
    });

    expect(hold.state).toBe("unknown");
  });

  it("falls back to 'unknown' state for null, undefined, or non-object input without throwing", () => {
    expect(parseHoldStatus(null).state).toBe("unknown");
    expect(parseHoldStatus(undefined).state).toBe("unknown");
    expect(parseHoldStatus("not an object").state).toBe("unknown");
    expect(parseHoldStatus(42).state).toBe("unknown");
  });

  it("defaults an unrecognized reason code to 'OTHER' rather than throwing", () => {
    const hold = parseHoldStatus({
      holdId: "hold-6",
      scope: "employer",
      targetId: "employer-1",
      state: "active",
      reasonCode: "SOME_NEW_CODE_NOT_YET_KNOWN",
      placedBy: "officer-a",
      placedAt: 1000,
    });

    expect(hold.reasonCode).toBe("OTHER");
  });

  it("omits release metadata for a non-released hold even if present in the raw payload", () => {
    const hold = parseHoldStatus({
      holdId: "hold-7",
      scope: "employer",
      targetId: "employer-1",
      state: "active",
      reasonCode: "OTHER",
      placedBy: "officer-a",
      placedAt: 1000,
      releasedBy: "someone",
      releasedAt: 5000,
    });

    expect(hold.releasedBy).toBeUndefined();
    expect(hold.releasedAt).toBeUndefined();
  });
});

describe("explainHold", () => {
  it("explains an active hold with its reason and scope", () => {
    const hold = activeHold({ reasonCode: "TAX_WITHHOLDING_DISCREPANCY" });
    const explanation = explainHold(hold);

    expect(explanation).toContain("tax withholding");
    expect(explanation).toContain('employer "employer-1"');
    expect(explanation).toContain("hold-1");
  });

  it("explains a released hold as no longer blocking", () => {
    const hold = activeHold({ state: "released", releasedBy: "officer-z" });
    const explanation = explainHold(hold);

    expect(explanation).toContain("released");
    expect(explanation).toContain("officer-z");
    expect(explanation).toContain("no longer blocks payroll");
  });

  it("explains an unknown-state hold as indeterminate and treated as blocked", () => {
    const hold = activeHold({ state: "unknown" });
    const explanation = explainHold(hold);

    expect(explanation).toContain("could not be determined");
    expect(explanation).toContain("blocked");
  });

  it("never surfaces the hold's free-text note", () => {
    const hold = activeHold({ note: "sensitive investigation detail" });
    expect(explainHold(hold)).not.toContain("sensitive investigation detail");
  });
});

describe("findBlockingHold / isPayrollActionBlocked", () => {
  it("findBlockingHold returns the matching hold directly", () => {
    const hold = activeHold({ target: { scope: "employer", id: "employer-1" } });
    expect(findBlockingHold({ employer: "employer-1" }, [hold])).toBe(hold);
  });

  it("findBlockingHold returns undefined when nothing blocks", () => {
    expect(findBlockingHold({ employer: "employer-1" }, [])).toBeUndefined();
  });

  it("reports not blocked when no holds apply", () => {
    const result = isPayrollActionBlocked({ employer: "employer-1" }, []);
    expect(result.blocked).toBe(false);
    expect(result.hold).toBeUndefined();
  });

  it("blocks on an active employer-scope hold", () => {
    const hold = activeHold({ target: { scope: "employer", id: "employer-1" } });
    const result = isPayrollActionBlocked({ employer: "employer-1" }, [hold]);

    expect(result.blocked).toBe(true);
    expect(result.hold).toBe(hold);
  });

  it("blocks on an active period-scope hold", () => {
    const hold = activeHold({ target: { scope: "period", id: "period-3" } });
    const result = isPayrollActionBlocked({ employer: "employer-1", period: "period-3" }, [hold]);

    expect(result.blocked).toBe(true);
    expect(result.hold?.target.scope).toBe("period");
  });

  it("blocks on an active batch-scope hold", () => {
    const hold = activeHold({ target: { scope: "batch", id: "batch-7" } });
    const result = isPayrollActionBlocked({ employer: "employer-1", batch: "batch-7" }, [hold]);

    expect(result.blocked).toBe(true);
    expect(result.hold?.target.scope).toBe("batch");
  });

  it("blocks on an active employee-scope hold", () => {
    const hold = activeHold({ target: { scope: "employee", id: "emp-9" } });
    const result = isPayrollActionBlocked({ employer: "employer-1", employee: "emp-9" }, [hold]);

    expect(result.blocked).toBe(true);
    expect(result.hold?.target.scope).toBe("employee");
  });

  it("does not block on a released hold at any scope", () => {
    const holds = [
      activeHold({ target: { scope: "employer", id: "employer-1" }, state: "released" }),
      activeHold({ target: { scope: "employee", id: "emp-9" }, state: "released" }),
    ];

    const result = isPayrollActionBlocked({ employer: "employer-1", employee: "emp-9" }, holds);

    expect(result.blocked).toBe(false);
  });

  it("treats an unknown-state hold as blocking (fails closed)", () => {
    const hold = activeHold({ target: { scope: "employee", id: "emp-9" }, state: "unknown" });
    const result = isPayrollActionBlocked({ employer: "employer-1", employee: "emp-9" }, [hold]);

    expect(result.blocked).toBe(true);
    expect(result.hold?.state).toBe("unknown");
  });

  it("does not block on a hold for a different scope id", () => {
    const hold = activeHold({ target: { scope: "employee", id: "emp-other" } });
    const result = isPayrollActionBlocked({ employer: "employer-1", employee: "emp-9" }, [hold]);

    expect(result.blocked).toBe(false);
  });

  it("prioritizes the broadest matching scope (employer over employee)", () => {
    const employerHold = activeHold({
      holdId: "hold-employer",
      target: { scope: "employer", id: "employer-1" },
    });
    const employeeHold = activeHold({
      holdId: "hold-employee",
      target: { scope: "employee", id: "emp-9" },
    });

    const result = isPayrollActionBlocked({ employer: "employer-1", employee: "emp-9" }, [
      employeeHold,
      employerHold,
    ]);

    expect(result.hold?.holdId).toBe("hold-employer");
  });

  it("ignores scopes that were not provided on the target", () => {
    const periodHold = activeHold({ target: { scope: "period", id: "period-3" } });
    const result = isPayrollActionBlocked({ employer: "employer-1" }, [periodHold]);

    expect(result.blocked).toBe(false);
  });
});

describe("validatePlaceHoldRequest / buildPlaceHoldRequest", () => {
  const validRequest: PlaceHoldRequest = {
    target: { scope: "employer", id: "employer-1" },
    reasonCode: "KYC_REVIEW_PENDING",
    placedBy: "officer-a",
  };

  it("accepts a valid request with no issues", () => {
    expect(validatePlaceHoldRequest(validRequest)).toEqual([]);
    expect(() => buildPlaceHoldRequest(validRequest)).not.toThrow();
  });

  it("flags a missing target id", () => {
    const issues = validatePlaceHoldRequest({
      ...validRequest,
      target: { scope: "employer", id: "" },
    });
    expect(issues.some((i) => i.field === "target.id")).toBe(true);
  });

  it("flags an invalid scope", () => {
    const issues = validatePlaceHoldRequest({
      ...validRequest,
      target: { scope: "department" as never, id: "d-1" },
    });
    expect(issues.some((i) => i.field === "target.scope")).toBe(true);
  });

  it("flags an unrecognized reason code", () => {
    const issues = validatePlaceHoldRequest({
      ...validRequest,
      reasonCode: "MADE_UP_REASON" as never,
    });
    expect(issues.some((i) => i.field === "reasonCode")).toBe(true);
  });

  it("flags a missing placedBy", () => {
    const issues = validatePlaceHoldRequest({ ...validRequest, placedBy: "  " });
    expect(issues.some((i) => i.field === "placedBy")).toBe(true);
  });

  it("flags a note that exceeds the max length", () => {
    const issues = validatePlaceHoldRequest({ ...validRequest, note: "x".repeat(501) });
    expect(issues.some((i) => i.field === "note")).toBe(true);
  });

  it("throws ComplianceHoldValidationError with all issues attached when building an invalid request", () => {
    try {
      buildPlaceHoldRequest({
        target: { scope: "employer", id: "" },
        reasonCode: "MADE_UP_REASON" as never,
        placedBy: "",
      });
      throw new Error("expected buildPlaceHoldRequest to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ComplianceHoldValidationError);
      expect(err).toBeInstanceOf(ZkPayrollError);
      const validationErr = err as ComplianceHoldValidationError;
      expect(validationErr.code).toBe("COMPLIANCE_HOLD_VALIDATION_FAILED");
      expect((validationErr.context.issues as unknown[]).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns a defensive copy rather than the original object references", () => {
    const built = buildPlaceHoldRequest(validRequest);
    expect(built).not.toBe(validRequest);
    expect(built.target).not.toBe(validRequest.target);
    expect(built).toEqual(validRequest);
  });
});

describe("validateReleaseAuthorization / assertValidReleaseAuthorization / buildReleaseHoldRequest", () => {
  const validRelease: ReleaseHoldRequest = {
    holdId: "hold-1",
    releasedBy: "officer-a",
    authorizationToken: "a-valid-token-123",
  };

  it("accepts a valid release request with no issues", () => {
    expect(validateReleaseAuthorization(validRelease)).toEqual([]);
    expect(() => assertValidReleaseAuthorization(validRelease)).not.toThrow();
    expect(() => buildReleaseHoldRequest(validRelease)).not.toThrow();
  });

  it("flags a missing holdId", () => {
    const issues = validateReleaseAuthorization({ ...validRelease, holdId: "" });
    expect(issues.some((i) => i.field === "holdId")).toBe(true);
  });

  it("flags a missing releasedBy", () => {
    const issues = validateReleaseAuthorization({ ...validRelease, releasedBy: "" });
    expect(issues.some((i) => i.field === "releasedBy")).toBe(true);
  });

  it("flags a missing authorizationToken", () => {
    const issues = validateReleaseAuthorization({ ...validRelease, authorizationToken: "" });
    expect(issues.some((i) => i.field === "authorizationToken")).toBe(true);
  });

  it("flags an authorization token that is too short", () => {
    const issues = validateReleaseAuthorization({ ...validRelease, authorizationToken: "short" });
    expect(issues.some((i) => i.field === "authorizationToken")).toBe(true);
  });

  it("throws HoldReleaseAuthorizationError when authorization is missing, without leaking a supplied token value", () => {
    try {
      assertValidReleaseAuthorization({
        holdId: "hold-1",
        releasedBy: "officer-a",
        authorizationToken: "short",
      });
      throw new Error("expected assertValidReleaseAuthorization to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HoldReleaseAuthorizationError);
      expect(err).toBeInstanceOf(ZkPayrollError);
      const authErr = err as HoldReleaseAuthorizationError;
      expect(authErr.code).toBe("COMPLIANCE_HOLD_RELEASE_UNAUTHORIZED");
      expect(authErr.context.holdId).toBe("hold-1");
      expect(JSON.stringify(authErr.context)).not.toContain("short");
    }
  });

  it("buildReleaseHoldRequest throws for an unauthorized release and does not return a request", () => {
    expect(() =>
      buildReleaseHoldRequest({ holdId: "hold-1", releasedBy: "", authorizationToken: "" })
    ).toThrow(HoldReleaseAuthorizationError);
  });

  it("buildReleaseHoldRequest returns a defensive copy for a valid release", () => {
    const built = buildReleaseHoldRequest(validRelease);
    expect(built).not.toBe(validRelease);
    expect(built).toEqual(validRelease);
  });
});
