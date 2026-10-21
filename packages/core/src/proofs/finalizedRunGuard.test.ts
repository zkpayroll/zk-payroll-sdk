import {
  FinalizedRunProofError,
  isRunFinalized,
  assertRunNotFinalized,
} from "./finalizedRunGuard";
import { ZkPayrollError } from "../core/errors";

describe("isRunFinalized (#758)", () => {
  it("returns true for terminal statuses", () => {
    expect(isRunFinalized("executed")).toBe(true);
    expect(isRunFinalized("cancelled")).toBe(true);
    expect(isRunFinalized("failed")).toBe(true);
  });

  it("returns false for non-terminal statuses", () => {
    expect(isRunFinalized("pending")).toBe(false);
    expect(isRunFinalized("approved")).toBe(false);
  });

  it("returns false for unrecognised or null input", () => {
    expect(isRunFinalized(null)).toBe(false);
    expect(isRunFinalized("UNKNOWN_STATUS")).toBe(false);
    expect(isRunFinalized(42)).toBe(false);
  });
});

describe("assertRunNotFinalized (#758)", () => {
  it("does not throw for non-terminal status", () => {
    expect(() => assertRunNotFinalized("pending")).not.toThrow();
  });

  it("throws FinalizedRunProofError for terminal status", () => {
    expect(() => assertRunNotFinalized("executed")).toThrow(FinalizedRunProofError);
  });

  it("FinalizedRunProofError is a ZkPayrollError", () => {
    try {
      assertRunNotFinalized("cancelled");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ZkPayrollError);
      expect(err).toBeInstanceOf(FinalizedRunProofError);
      expect((err as FinalizedRunProofError).code).toBe("PROOF_SUBMISSION_FINALIZED_RUN");
    }
  });

  it("attaches context to the thrown error", () => {
    try {
      assertRunNotFinalized("failed", { runId: "run-001" });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as FinalizedRunProofError).context).toMatchObject({ runId: "run-001" });
    }
  });
});
