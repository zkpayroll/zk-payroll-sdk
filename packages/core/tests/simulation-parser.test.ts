import {
  classifySimulationFailure,
  parseSimulationResponse,
  sanitizeSimulationDetail,
  SIMULATION_DETAIL_MAX_LENGTH,
} from "../src/simulation/resultParser";
import type { SimulationResult } from "../src/simulation/types";

// ── Fixtures: representative contract simulation responses ──────────────────
// Deterministic, hardcoded shapes mirroring what the Soroban contract /
// RPC layer returns for each outcome class.

/** Happy path — the simulated batch can proceed. */
const FIXTURE_SUCCESS: SimulationResult = {
  status: "success",
  findings: [],
  canProceed: true,
};

/** Simulated run that passed but tripped a policy limit (advisory). */
const FIXTURE_SUCCESS_WITH_POLICY_WARNING: SimulationResult = {
  status: "success",
  findings: [
    { code: "POLICY_LIMIT_APPROACHED", message: "Batch total is near the policy capacity limit", severity: "warning" },
  ],
  canProceed: true,
};

/** Treasury cannot cover the batch for the requested asset. */
const FIXTURE_FUNDING_FAILURE: SimulationResult = {
  status: "error",
  findings: [
    { code: "INSUFFICIENT_TREASURY", message: "Treasury has insufficient funds for asset native", severity: "error" },
    { code: "BATCH_TOTAL", message: "Required 1250000 stroops but only 1000000 available", severity: "error" },
  ],
  canProceed: false,
};

/** Signer is not authorized for this batch. */
const FIXTURE_AUTH_FAILURE: SimulationResult = {
  status: "error",
  findings: [
    { code: "UNAUTHORIZED_SIGNER", message: "Signer is not authorized to execute this payroll batch", severity: "error" },
  ],
  canProceed: false,
};

/** Proof registry rejected / missing proof. */
const FIXTURE_PROOF_FAILURE: SimulationResult = {
  status: "error",
  findings: [
    { code: "MISSING_PROOF", message: "Proof verification failed: no valid payroll proof attached", severity: "error" },
  ],
  canProceed: false,
};

/** Raw error object as thrown by the contract client wrapper. */
const FIXTURE_ERROR_OBJECT = {
  code: "SIMULATION_FAILED",
  message: "Error(Contract, #1204) unauthorized batch submitter",
};

/** Raw error-like object (name + message, e.g. mapped RPC errors). */
const FIXTURE_ERROR_LIKE = {
  name: "ContractExecutionError",
  message: "Insufficient balance for token transfer of asset CUSDC",
};

/** Plain string as produced by some RPC stacks. */
const FIXTURE_ERROR_STRING = "Error(Contract, #77) MISSING_PROOF: witness absent";

/** Completely unrecognized response — must remain safely inspectable. */
const FIXTURE_UNKNOWN_RESPONSE = { status: 418, body: { weird: true } };

// ── classifySimulationFailure ────────────────────────────────────────────────

describe("classifySimulationFailure", () => {
  it.each([
    ["unauthorized: signer not allowed", "authorization_failure"],
    ["missing signature for batch", "authorization_failure"],
    ["account frozen", "authorization_failure"],
    ["insufficient funds in treasury", "funding_failure"],
    ["treasury balance too low", "funding_failure"],
    ["proof verification failed", "proof_failure"],
    ["no witness provided", "proof_failure"],
    ["policy capacity limit exceeded", "policy_warning"],
    ["settlement window closed", "policy_warning"],
  ])('maps "%s" to %s', (message, expected) => {
    expect(classifySimulationFailure(message)).toBe(expected);
  });

  it("falls back to unknown for unrecognized messages", () => {
    expect(classifySimulationFailure("something exploded badly")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(classifySimulationFailure("UNAUTHORIZED ACCESS")).toBe("authorization_failure");
  });
});

// ── sanitizeSimulationDetail ─────────────────────────────────────────────────

describe("sanitizeSimulationDetail", () => {
  it("strips control characters", () => {
    expect(sanitizeSimulationDetail("line1\nline2\tend\0")).toBe("line1 line2 end");
  });

  it("truncates long details with an ellipsis", () => {
    const long = "x".repeat(SIMULATION_DETAIL_MAX_LENGTH + 50);
    const sanitized = sanitizeSimulationDetail(long);
    expect(sanitized).toHaveLength(SIMULATION_DETAIL_MAX_LENGTH + 1);
    expect(sanitized.endsWith("…")).toBe(true);
  });

  it("leaves short clean text unchanged", () => {
    expect(sanitizeSimulationDetail("all good")).toBe("all good");
  });
});

// ── parseSimulationResponse: success ─────────────────────────────────────────

describe("parseSimulationResponse — success", () => {
  it("produces a stable ready result with no findings", () => {
    const parsed = parseSimulationResponse(FIXTURE_SUCCESS);
    expect(parsed.category).toBe("success");
    expect(parsed.ready).toBe(true);
    expect(parsed.hasWarnings).toBe(false);
    expect(parsed.findings).toEqual([]);
    expect(parsed.diagnostics.source).toBe("simulation_result");
    expect(parsed.diagnostics.codes).toEqual(["SIM_SUCCESS"]);
  });

  it("surfaces advisory policy warnings without blocking readiness", () => {
    const parsed = parseSimulationResponse(FIXTURE_SUCCESS_WITH_POLICY_WARNING);
    expect(parsed.category).toBe("policy_warning");
    expect(parsed.ready).toBe(true);
    expect(parsed.hasWarnings).toBe(true);
    expect(parsed.findings[0].category).toBe("policy_warning");
    expect(parsed.findings[0].severity).toBe("warning");
    expect(parsed.findings[0].code).toBe("POLICY_LIMIT_APPROACHED");
    expect(parsed.findings[0].hint).toBeTruthy();
  });
});

// ── parseSimulationResponse: typed failures ──────────────────────────────────

describe("parseSimulationResponse — typed failures", () => {
  it("maps a treasury funding failure to funding_failure and blocks readiness", () => {
    const parsed = parseSimulationResponse(FIXTURE_FUNDING_FAILURE);
    expect(parsed.category).toBe("funding_failure");
    expect(parsed.ready).toBe(false);
    expect(parsed.hasWarnings).toBe(false);
    expect(parsed.findings.map((f) => f.category)).toEqual(["funding_failure", "funding_failure"]);
    expect(parsed.findings[0].code).toBe("INSUFFICIENT_TREASURY");
    expect(parsed.findings[0].message).toContain("insufficient funds");
    expect(parsed.diagnostics.codes).toEqual(["INSUFFICIENT_TREASURY", "BATCH_TOTAL"]);
  });

  it("maps an authorization failure from a SimulationResult", () => {
    const parsed = parseSimulationResponse(FIXTURE_AUTH_FAILURE);
    expect(parsed.category).toBe("authorization_failure");
    expect(parsed.ready).toBe(false);
    expect(parsed.findings[0].hint).toMatch(/authenticat|signature/i);
  });

  it("maps a proof failure and preserves the stable code", () => {
    const parsed = parseSimulationResponse(FIXTURE_PROOF_FAILURE);
    expect(parsed.category).toBe("proof_failure");
    expect(parsed.ready).toBe(false);
    expect(parsed.findings[0].code).toBe("MISSING_PROOF");
    expect(parsed.findings[0].category).toBe("proof_failure");
  });

  it("parses raw error objects thrown by contract clients", () => {
    const parsed = parseSimulationResponse(FIXTURE_ERROR_OBJECT);
    expect(parsed.category).toBe("authorization_failure");
    expect(parsed.ready).toBe(false);
    expect(parsed.diagnostics.source).toBe("error");
    expect(parsed.diagnostics.codes).toContain("SIMULATION_FAILED");
  });

  it("parses error-like objects (name + message)", () => {
    const parsed = parseSimulationResponse(FIXTURE_ERROR_LIKE);
    expect(parsed.category).toBe("funding_failure");
    expect(parsed.diagnostics.source).toBe("error");
    expect(parsed.findings[0].message).toContain("Insufficient balance");
  });

  it("parses plain error strings from RPC stacks", () => {
    const parsed = parseSimulationResponse(FIXTURE_ERROR_STRING);
    expect(parsed.category).toBe("proof_failure");
    expect(parsed.diagnostics.source).toBe("string");
    expect(parsed.findings[0].code).toBe("SIM_PROOF_FAILURE");
  });

  it("synthesizes stable codes when the response carries none", () => {
    const parsed = parseSimulationResponse("insufficient balance");
    expect(parsed.findings[0].code).toBe("SIM_FUNDING_FAILURE");
  });
});

// ── parseSimulationResponse: unknown responses & safety ──────────────────────

describe("parseSimulationResponse — unknown and safe diagnostics", () => {
  it("maps unrecognized responses to the unknown category, still inspectable", () => {
    for (const response of [FIXTURE_UNKNOWN_RESPONSE, {}, 42, null, undefined]) {
      const parsed = parseSimulationResponse(response);
      expect(parsed.category).toBe("unknown");
      expect(parsed.ready).toBe(false);
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].category).toBe("unknown");
      expect(parsed.diagnostics.source).toBe("unparseable");
      expect(typeof parsed.diagnostics.detail).toBe("string");
    }
  });

  it("never embeds raw response objects in diagnostics", () => {
    const parsed = parseSimulationResponse(FIXTURE_UNKNOWN_RESPONSE);
    expect(parsed.diagnostics.detail).not.toContain('"weird":true');
    expect(parsed.diagnostics.detail).toMatch(/object with keys/);
  });

  it("sanitizes control characters out of preserved messages", () => {
    const parsed = parseSimulationResponse({
      success: false,
      findings: [{ code: "WEIRD", message: "bad\nstuff\0here", severity: "error" }],
    });
    expect(parsed.findings[0].message).toBe("bad stuff here");
  });

  it("is deterministic: identical responses produce identical parsed objects", () => {
    const a = parseSimulationResponse(FIXTURE_FUNDING_FAILURE);
    const b = parseSimulationResponse(FIXTURE_FUNDING_FAILURE);
    expect(a).toEqual(b);
  });

  it("keeps aggregate outcome stable regardless of finding order", () => {
    const reversed: SimulationResult = {
      status: "error",
      findings: [...FIXTURE_FUNDING_FAILURE.findings].reverse(),
      canProceed: false,
    };
    const forward = parseSimulationResponse(FIXTURE_FUNDING_FAILURE);
    const backward = parseSimulationResponse(reversed);
    expect(backward.category).toBe(forward.category);
    expect(backward.ready).toBe(forward.ready);
    expect(backward.hasWarnings).toBe(forward.hasWarnings);
    // Same set of codes, even though the order follows the input.
    expect([...backward.diagnostics.codes].sort()).toEqual([...forward.diagnostics.codes].sort());
  });
});