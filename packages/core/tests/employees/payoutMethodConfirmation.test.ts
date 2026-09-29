import { confirmPayoutMethod } from "../../src/employees/payoutMethodConfirmation";

const VALID_DESTINATION = "GAJFUKFHCREUWXRQRQVKKHHBQRZ2COH64HLGYM3ZB6J5PPKNCREGQCCN";
const MISMATCHED_DESTINATION = "GAJFUKFHCREUWXRQRQVKKHHBQRZ2COH64HLGYM3ZB6J5PPKNCREGQCCM";

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
      confirmation: MISMATCHED_DESTINATION,
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

  it("reports a missing destination before a missing confirmation", () => {
    const result = confirmPayoutMethod({ destination: "", confirmation: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DESTINATION_REQUIRED");
    }
  });

  it("rejects a well-formed but non-Stellar destination", () => {
    const result = confirmPayoutMethod({
      destination: "not-a-stellar-account",
      confirmation: "not-a-stellar-account",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DESTINATION_UNSUPPORTED");
    }
  });

  it("treats a whitespace-padded confirmation as matching", () => {
    const result = confirmPayoutMethod({
      destination: VALID_DESTINATION,
      confirmation: `  ${VALID_DESTINATION}  `,
    });
    expect(result).toEqual({
      ok: true,
      destination: VALID_DESTINATION,
      kind: "account",
    });
  });

  it("never echoes the confirmation value in a failure message", () => {
    const secret = MISMATCHED_DESTINATION;
    const result = confirmPayoutMethod({
      destination: VALID_DESTINATION,
      confirmation: secret,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain(secret);
      expect(result.message).not.toContain(VALID_DESTINATION);
    }
  });
});
