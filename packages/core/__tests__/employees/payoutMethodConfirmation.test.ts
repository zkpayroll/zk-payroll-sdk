import { confirmPayoutMethod } from "../../src/employees/payoutMethodConfirmation";

const VALID_DESTINATION = "GBRVV2NZ7HKCHKJZKLXWXYZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";

describe("confirmPayoutMethod", () => {
  it("confirms a matching destination", () => {
    const result = confirmPayoutMethod({
      destination: VALID_DESTINATION,
      confirmation: VALID_DESTINATION,
    });
    expect(result).toEqual({
      ok: true,
      destination: VALID_DESTINATION,
      kind: "account",
    });
  });

  it("rejects a mismatched confirmation", () => {
    const result = confirmPayoutMethod({
      destination: VALID_DESTINATION,
      confirmation: "GBBRVVNZ7HKCHKJZKLXWXYZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIRMATION_MISMATCH");
      expect(result.message).not.toContain(VALID_DESTINATION);
    }
  });

  it("requires a confirmation value", () => {
    const result = confirmPayoutMethod({
      destination: VALID_DESTINATION,
      confirmation: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIRMATION_REQUIRED");
    }
  });

  it("surfaces destination validation errors", () => {
    const result = confirmPayoutMethod({
      destination: " ",
      confirmation: " ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DESTINATION_WHITESPACE");
    }
  });
});
