import {
  StaleApprovalError,
  StaleApprovalErrorCode,
  STALE_APPROVAL_ERROR_MESSAGES,
  isStaleApprovalError,
  getStaleApprovalErrorMessage,
  mapToStaleApprovalError,
} from "./staleApprovalErrors";
import { ZkPayrollError } from "../core/errors";

describe("StaleApprovalError (#748)", () => {
  it("is an instance of ZkPayrollError", () => {
    const err = new StaleApprovalError("expired", StaleApprovalErrorCode.APPROVAL_EXPIRED);
    expect(err).toBeInstanceOf(ZkPayrollError);
    expect(err).toBeInstanceOf(StaleApprovalError);
    expect(err.name).toBe("StaleApprovalError");
    expect(err.code).toBe(StaleApprovalErrorCode.APPROVAL_EXPIRED);
  });

  it("defaults code to APPROVAL_EXPIRED", () => {
    const err = new StaleApprovalError("msg");
    expect(err.code).toBe(StaleApprovalErrorCode.APPROVAL_EXPIRED);
  });

  it("has a message entry for every code", () => {
    for (const code of Object.values(StaleApprovalErrorCode)) {
      expect(STALE_APPROVAL_ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
});

describe("isStaleApprovalError (#748)", () => {
  it("returns true for StaleApprovalError instance", () => {
    expect(isStaleApprovalError(new StaleApprovalError("x"))).toBe(true);
  });

  it("returns true for plain object with a recognised code", () => {
    expect(isStaleApprovalError({ code: StaleApprovalErrorCode.APPROVAL_SUPERSEDED })).toBe(true);
  });

  it("returns false for unrelated code string", () => {
    expect(isStaleApprovalError({ code: "SOME_OTHER_ERROR" })).toBe(false);
  });

  it("returns false for non-object values", () => {
    expect(isStaleApprovalError(null)).toBe(false);
    expect(isStaleApprovalError("APPROVAL_EXPIRED")).toBe(false);
    expect(isStaleApprovalError(42)).toBe(false);
  });
});

describe("getStaleApprovalErrorMessage (#748)", () => {
  it("returns a known message for a recognised code", () => {
    const msg = getStaleApprovalErrorMessage({ code: StaleApprovalErrorCode.APPROVAL_NOT_FOUND });
    expect(msg).toBe(STALE_APPROVAL_ERROR_MESSAGES[StaleApprovalErrorCode.APPROVAL_NOT_FOUND]);
  });

  it("returns a generic fallback for an unrecognised error", () => {
    const msg = getStaleApprovalErrorMessage({ code: "UNKNOWN_CODE" });
    expect(msg).toMatch(/payroll approval error/i);
  });

  it("returns a generic fallback for null", () => {
    const msg = getStaleApprovalErrorMessage(null);
    expect(msg).toMatch(/payroll approval error/i);
  });
});

describe("mapToStaleApprovalError (#748)", () => {
  it("wraps an unknown error into a StaleApprovalError", () => {
    const original = new Error("storage failure");
    const mapped = mapToStaleApprovalError(original, StaleApprovalErrorCode.APPROVAL_NOT_FOUND);
    expect(mapped).toBeInstanceOf(StaleApprovalError);
    expect(mapped.code).toBe(StaleApprovalErrorCode.APPROVAL_NOT_FOUND);
    expect(mapped.cause).toBe(original);
  });

  it("returns the same StaleApprovalError without re-wrapping", () => {
    const err = new StaleApprovalError("already typed", StaleApprovalErrorCode.APPROVAL_ALREADY_EXECUTED);
    expect(mapToStaleApprovalError(err)).toBe(err);
  });
});
