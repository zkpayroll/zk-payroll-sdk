import { Keypair } from "@stellar/stellar-sdk";
import { PayrollValidation } from "../src/core/validation";
import { validatePayoutDestination } from "../src/employees/payoutDestination";

describe("employee payout destination validation", () => {
  const account = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();

  it("accepts a valid destination before payment submission", () => {
    expect(validatePayoutDestination(account)).toEqual({
      ok: true,
      destination: account,
      kind: "account",
    });
    expect(
      PayrollValidation.validatePaymentParams({ recipient: account, amount: 1n, asset: "native" })
        .isValid
    ).toBe(true);
  });

  it("rejects empty and malformed values without echoing them", () => {
    expect(validatePayoutDestination("")).toMatchObject({
      ok: false,
      code: "DESTINATION_REQUIRED",
    });
    const invalid = "private-invalid-destination";
    const result = validatePayoutDestination(invalid);
    expect(result).toMatchObject({ ok: false, code: "DESTINATION_UNSUPPORTED" });
    expect(JSON.stringify(result)).not.toContain(invalid);
    expect(
      PayrollValidation.validatePaymentParams({ recipient: invalid, amount: 1n, asset: "native" })
        .isValid
    ).toBe(false);
  });
});
