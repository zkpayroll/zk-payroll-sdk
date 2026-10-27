import {
  ProofFormatErrorCode,
  SUPPORTED_PROOF_FORMATS,
  UNSUPPORTED_PROOF_FORMAT_REMEDIATION,
  UnsupportedProofFormatError,
  getUnsupportedProofFormatRemediation,
  isUnsupportedProofFormatError,
  mapUnsupportedProofFormatError,
  validateProofFormat,
} from "../src/errors/contractErrors";
import { ZkPayrollError } from "../src/core/errors";

describe("UnsupportedProofFormatError (#852)", () => {
  it("validates supported proof formats and normalizes casing", () => {
    expect(validateProofFormat("groth16")).toBe("groth16");
    expect(validateProofFormat("  PLONK ")).toBe("plonk");
    expect(SUPPORTED_PROOF_FORMATS).toEqual(["groth16", "plonk"]);
  });

  it("throws a typed UnsupportedProofFormatError for unknown or empty proof formats", () => {
    let caught: unknown;
    try {
      validateProofFormat("bulletproofs-v1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UnsupportedProofFormatError);
    expect(caught).toBeInstanceOf(ZkPayrollError);
    expect(isUnsupportedProofFormatError(caught)).toBe(true);
    const typed = caught as UnsupportedProofFormatError;
    expect(typed.code).toBe(ProofFormatErrorCode.UNSUPPORTED_PROOF_FORMAT);
    expect(typed.receivedFormat).toBe("bulletproofs-v1");
    expect(typed.supportedFormats).toEqual(["groth16", "plonk"]);

    expect(() => validateProofFormat("")).toThrow(UnsupportedProofFormatError);
    expect(() => validateProofFormat(null)).toThrow(UnsupportedProofFormatError);
  });

  it("detects and maps contract revert errors for unsupported proof formats", () => {
    const revertError = new Error(
      "HostError: Error(Contract, #9) UnsupportedProofFormat: invalid proof scheme"
    );

    expect(isUnsupportedProofFormatError(revertError)).toBe(true);
    expect(getUnsupportedProofFormatRemediation(revertError)).toBe(
      UNSUPPORTED_PROOF_FORMAT_REMEDIATION
    );

    const mapped = mapUnsupportedProofFormatError(revertError, {
      contractId: "CCONTRACT123",
    });
    expect(mapped).toBeInstanceOf(UnsupportedProofFormatError);
    expect(mapped.code).toBe(ProofFormatErrorCode.UNSUPPORTED_PROOF_FORMAT);
    expect(mapped.context.contractId).toBe("CCONTRACT123");
  });

  it("redacts sensitive payroll witness, recipient, amount, and raw proof hex bytes", () => {
    const rawError = new Error(
      "UNSUPPORTED_PROOF_FORMAT recipient=GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37 amount=95000000000 proof=0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );

    const mapped = mapUnsupportedProofFormatError(rawError, {
      recipient: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      amount: "95000000000",
      witness: { salary: 9500 },
      network: "testnet",
    });

    expect(mapped.message).not.toContain("GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37");
    expect(mapped.message).not.toContain("95000000000");
    expect(mapped.message).not.toContain("0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    expect(mapped.context.recipient).toBe("[REDACTED]");
    expect(mapped.context.amount).toBe("[REDACTED]");
    expect(mapped.context.witness).toBe("[REDACTED]");
    expect(mapped.context.network).toBe("testnet");
  });
});
