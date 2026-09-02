import { describeContractError, CONTRACT_ERROR_MAP } from "../src/errors/contractErrors";

describe("describeContractError", () => {
  it("maps a known error code to its descriptor", () => {
    expect(describeContractError("PAUSED")).toEqual(CONTRACT_ERROR_MAP.PAUSED);
  });

  it("is case-insensitive", () => {
    expect(describeContractError("paused")).toEqual(CONTRACT_ERROR_MAP.PAUSED);
  });

  it("falls back to a safe descriptor for unknown codes", () => {
    const result = describeContractError("SOME_UNKNOWN_CODE");
    expect(result.code).toBe("UNKNOWN_CONTRACT_ERROR");
    expect(result.remediation).toBeTruthy();
  });

  it("falls back safely for null/undefined codes", () => {
    expect(describeContractError(null).code).toBe("UNKNOWN_CONTRACT_ERROR");
    expect(describeContractError(undefined).code).toBe("UNKNOWN_CONTRACT_ERROR");
  });
});
