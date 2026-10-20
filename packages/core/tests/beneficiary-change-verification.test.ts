import { Keypair } from "@stellar/stellar-sdk";
import {
  requestBeneficiaryChange,
  verifyBeneficiaryChange,
} from "../src/employees/beneficiaryChangeVerification";
import type { BeneficiaryChangeRequest } from "../src/employees/beneficiaryChangeVerification";

const CURRENT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 21)).publicKey();
const PROPOSED = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 22)).publicKey();

const BASE_REQUEST_INPUT = {
  requestId: "req-1",
  employeeId: "EMP-001",
  currentDestination: CURRENT,
  proposedDestination: PROPOSED,
  verificationToken: "tok-correct",
  expiresAt: 10_000,
};

describe("requestBeneficiaryChange", () => {
  it("creates a pending request for a valid, changed destination", () => {
    const result = requestBeneficiaryChange(BASE_REQUEST_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.requestId).toBe("req-1");
      expect(result.request.employeeId).toBe("EMP-001");
      expect(result.request.expiresAt).toBe(10_000);
      expect(result.request.review.risk).toBe("standard");
      // The request never carries the raw destinations, only the masked review.
      expect(JSON.stringify(result.request)).not.toContain(CURRENT);
      expect(JSON.stringify(result.request)).not.toContain(PROPOSED);
    }
  });

  it("rejects a request with a missing employeeId", () => {
    const result = requestBeneficiaryChange({ ...BASE_REQUEST_INPUT, employeeId: "" });

    expect(result).toMatchObject({ ok: false, code: "EMPLOYEE_ID_REQUIRED" });
  });

  it("rejects a non-finite expiresAt", () => {
    const result = requestBeneficiaryChange({ ...BASE_REQUEST_INPUT, expiresAt: NaN });

    expect(result).toMatchObject({ ok: false, code: "INVALID_EXPIRY" });
  });

  it("rejects an unchanged destination before minting a token", () => {
    const result = requestBeneficiaryChange({
      ...BASE_REQUEST_INPUT,
      proposedDestination: CURRENT,
    });

    expect(result).toMatchObject({ ok: false, code: "DESTINATION_UNCHANGED" });
  });

  it("rejects an invalid proposed destination", () => {
    const result = requestBeneficiaryChange({
      ...BASE_REQUEST_INPUT,
      proposedDestination: "not-a-real-address",
    });

    expect(result).toMatchObject({ ok: false, code: "PROPOSED_DESTINATION_INVALID" });
  });
});

describe("verifyBeneficiaryChange", () => {
  function pendingRequest(expiresAt = 10_000): BeneficiaryChangeRequest {
    const result = requestBeneficiaryChange({ ...BASE_REQUEST_INPUT, expiresAt });
    if (!result.ok) throw new Error("test setup failed to build a pending request");
    return result.request;
  }

  it("succeeds when the correct token is presented before expiry", () => {
    const request = pendingRequest();

    const result = verifyBeneficiaryChange(request, "tok-correct", 5_000);

    expect(result).toEqual({
      ok: true,
      requestId: "req-1",
      employeeId: "EMP-001",
      review: request.review,
    });
  });

  it("accepts verification at any moment strictly before expiresAt", () => {
    const request = pendingRequest(10_000);

    expect(verifyBeneficiaryChange(request, "tok-correct", 9_999).ok).toBe(true);
  });

  it("rejects verification at or after expiresAt, even with the correct token", () => {
    const request = pendingRequest(10_000);

    expect(verifyBeneficiaryChange(request, "tok-correct", 10_000)).toMatchObject({
      ok: false,
      code: "REQUEST_EXPIRED",
    });
    expect(verifyBeneficiaryChange(request, "tok-correct", 10_001)).toMatchObject({
      ok: false,
      code: "REQUEST_EXPIRED",
    });
  });

  it("reports expiry before checking the token, even for a wrong token", () => {
    const request = pendingRequest(10_000);

    const result = verifyBeneficiaryChange(request, "totally-wrong-token", 20_000);

    expect(result).toMatchObject({ ok: false, code: "REQUEST_EXPIRED" });
  });

  it("rejects a missing token", () => {
    const request = pendingRequest();

    expect(verifyBeneficiaryChange(request, undefined, 5_000)).toMatchObject({
      ok: false,
      code: "TOKEN_REQUIRED",
    });
    expect(verifyBeneficiaryChange(request, "", 5_000)).toMatchObject({
      ok: false,
      code: "TOKEN_REQUIRED",
    });
  });

  it("rejects a mismatched token", () => {
    const request = pendingRequest();

    expect(verifyBeneficiaryChange(request, "tok-wrong", 5_000)).toMatchObject({
      ok: false,
      code: "TOKEN_MISMATCH",
    });
  });

  it("every failure result carries the original requestId", () => {
    const request = pendingRequest(10_000);

    const expired = verifyBeneficiaryChange(request, "tok-correct", 10_000);
    const mismatched = verifyBeneficiaryChange(request, "tok-wrong", 5_000);

    expect(expired).toMatchObject({ requestId: "req-1" });
    expect(mismatched).toMatchObject({ requestId: "req-1" });
  });
});
