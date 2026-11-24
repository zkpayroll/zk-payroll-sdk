import {
  PUBLIC_INPUT_MAX_BYTES,
  PublicInputLengthError,
  parsePublicInputs,
} from "../src/proofs/publicInputLength";

describe("public proof input length", () => {
  it("parses a short public input array", () => {
    expect(parsePublicInputs("[\"1\",\"2\"]")).toEqual(["1", "2"]);
  });

  it("rejects an empty payload before parsing", () => {
    expect(() => parsePublicInputs("")).toThrow(PublicInputLengthError);
  });

  it("rejects a payload one byte past the limit and a boundary-sized array", () => {
    const over = "x".repeat(PUBLIC_INPUT_MAX_BYTES + 1);
    expect(() => parsePublicInputs(over)).toThrow(PublicInputLengthError);
    const boundary = JSON.stringify(["1"]);
    expect(boundary.length).toBeLessThanOrEqual(PUBLIC_INPUT_MAX_BYTES);
    expect(parsePublicInputs(boundary)).toEqual(["1"]);
    expect(() => parsePublicInputs("[")).toThrow(PublicInputLengthError);
  });

  it("does not include the payload in the error", () => {
    expect(() => parsePublicInputs("salary-secret")).toThrow(/could not be read|exceeds the allowed length|empty/);
  });
});
