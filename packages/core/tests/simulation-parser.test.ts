import { parseSimulationResponse } from "../src/simulation/parser";
describe("simulation parser (#339)", () => {
  it("parses success", () => {
    const r = parseSimulationResponse({ status: "success", findings: [], canProceed: true });
    expect(r.category).toBe("ready");
    expect(r.canProceed).toBe(true);
  });
  it("maps auth failure", () => {
    const r = parseSimulationResponse({ status: "error", code: "UNAUTHORIZED", message: "not authorized", findings: [{ code: "AUTH", message: "bad sig" }] });
    expect(r.category).toBe("authFailure");
    expect(r.canProceed).toBe(false);
  });
  it("maps funding failure", () => {
    const r = parseSimulationResponse({ status: "error", message: "insufficient treasury balance", findings: [] });
    expect(r.category).toBe("fundingFailure");
  });
  it("maps proof failure", () => {
    const r = parseSimulationResponse({ status: "error", message: "proof generation failed: circuit", findings: [] });
    expect(r.category).toBe("proofFailure");
  });
  it("keeps warnings inspectable", () => {
    const r = parseSimulationResponse({ status: "warning", findings: [{ code: "LOW_AMOUNT", message: "low" }], canProceed: true });
    expect(r.category).toBe("policyWarning");
    expect(r.canProceed).toBe(true);
    expect(r.findings).toHaveLength(1);
  });
  it("handles unknown safely", () => {
    const r = parseSimulationResponse({ weird: 1 });
    expect(r.category).toBe("unknownFailure");
    expect(r.canProceed).toBe(false);
    expect(r.raw).toBeDefined();
  });
});
