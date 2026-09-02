type ContractErrorDescriptor = {
  code: string;
  remediation: string;
  message?: string;
};

const CONTRACT_ERROR_MAP = {
  PAUSED: {
    code: "PAUSED",
    message: "The contract is paused.",
    remediation:
      "Wait for the contract to be unpaused or resume the operation after the required state change.",
  },
} satisfies Record<string, ContractErrorDescriptor>;

function describeContractError(code?: string | null): ContractErrorDescriptor {
  const normalizedCode = String(code ?? "")
    .trim()
    .toUpperCase();

  if (normalizedCode in CONTRACT_ERROR_MAP) {
    return CONTRACT_ERROR_MAP[normalizedCode as keyof typeof CONTRACT_ERROR_MAP];
  }

  return {
    code: "UNKNOWN_CONTRACT_ERROR",
    remediation: "Review the contract state and retry with a valid action.",
  };
}

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
