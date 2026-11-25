import { AssetRegistryClass } from "../src/assets/AssetRegistry";
import {
  PaymentAssetUnauthorizedError,
  assertPaymentAssetAuthorized,
  isPaymentAssetUnauthorizedError,
  PAYMENT_ASSET_UNAUTHORIZED_ERROR_CODE,
} from "../src/assets/paymentAssetAuthorization";
import { ValidationError } from "../src/core/errors";

const CUSTOM_TOKEN_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const UNREGISTERED_TOKEN_ID = "CAKZGMMMJOHMSZ5V3DYKCUDNTIWBG57MAMFJDSVICNWUNVXLX6EZN3NC";

function makeRegistry(): AssetRegistryClass {
  const registry = new AssetRegistryClass();
  registry.register({
    id: CUSTOM_TOKEN_ID,
    symbol: "AUTHTKN",
    label: "Authorized Token",
    decimals: 7,
  });
  return registry;
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to throw");
}

describe("PaymentAssetUnauthorizedError", () => {
  it("exposes the rejection reason and asset ID as frozen, structured details", () => {
    const err = captureError(() =>
      assertPaymentAssetAuthorized(UNREGISTERED_TOKEN_ID, { registry: makeRegistry() })
    );

    expect(err).toBeInstanceOf(PaymentAssetUnauthorizedError);
    expect(err).toBeInstanceOf(ValidationError);
    expect(isPaymentAssetUnauthorizedError(err)).toBe(true);

    const typed = err as PaymentAssetUnauthorizedError;
    expect(typed.code).toBe(PAYMENT_ASSET_UNAUTHORIZED_ERROR_CODE);
    expect(typed.field).toBe("asset");
    expect(typed.details).toEqual({
      authorizationCode: "unregistered",
      assetId: UNREGISTERED_TOKEN_ID,
    });
    expect(Object.isFrozen(typed.details)).toBe(true);
  });

  it("reports the not_allowlisted reason for a registered asset outside the allowlist", () => {
    const err = captureError(() =>
      assertPaymentAssetAuthorized(CUSTOM_TOKEN_ID, {
        registry: makeRegistry(),
        allowedAssetIds: ["native"],
      })
    ) as PaymentAssetUnauthorizedError;

    expect(err.details.authorizationCode).toBe("not_allowlisted");
    expect(err.details.assetId).toBe(CUSTOM_TOKEN_ID);
    expect(err.context).toMatchObject({ authorizationCode: "not_allowlisted" });
  });

  it("never echoes non-string identifiers, only their type", () => {
    const err = captureError(() =>
      assertPaymentAssetAuthorized(42, { registry: makeRegistry() })
    ) as PaymentAssetUnauthorizedError;

    expect(err.details).toEqual({ authorizationCode: "not_payment_compatible", assetId: "<number>" });
    expect(err.message).not.toContain("42");
  });

  it("bounds long identifiers so arbitrary payloads cannot bloat errors or logs", () => {
    const longValue = "x".repeat(500);
    const err = captureError(() =>
      assertPaymentAssetAuthorized(longValue, { registry: makeRegistry() })
    ) as PaymentAssetUnauthorizedError;

    expect(err.details.assetId).toBe(`${"x".repeat(64)}…`);
    expect(JSON.stringify(err.details)).not.toContain("x".repeat(65));
  });

  it("does not match generic ValidationErrors in the type guard", () => {
    expect(isPaymentAssetUnauthorizedError(new ValidationError("boom", "asset"))).toBe(false);
  });
});
