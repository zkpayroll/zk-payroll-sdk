export type SimCategory = "ready" | "authFailure" | "fundingFailure" | "proofFailure" | "policyWarning" | "unknownFailure";
export interface SimDiag { code?: string; message?: string; field?: string; asset?: string; [k: string]: unknown; }
export interface ParsedSim { category: SimCategory; canProceed: boolean; retryable: boolean; findings: SimDiag[]; summary: string; raw?: unknown; }
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) { const v = o[k]; if (v !== undefined) return v; }
  return undefined;
}
function normFindings(v: unknown): SimDiag[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e) => e && typeof e === "object").map((e) => {
    const r = e as Record<string, unknown>;
    const d: SimDiag = {};
    if (typeof r["code"] === "string") d.code = r["code"] as string;
    if (typeof r["message"] === "string") d.message = r["message"] as string;
    if (typeof r["field"] === "string") d.field = r["field"] as string;
    if (typeof r["asset"] === "string") d.asset = r["asset"] as string;
    return d;
  });
}
export function parseSimulationResponse(raw: unknown): ParsedSim {
  if (!raw || typeof raw !== "object") {
    return { category: "unknownFailure", canProceed: false, retryable: false, findings: [{ message: "Empty simulation response" }], summary: "simulation: unknown failure", raw };
  }
  const r = raw as Record<string, unknown>;
  const findings = normFindings(pick(r, ["findings", "errors", "issues"]));
  const status = str(pick(r, ["status", "state", "outcome"])).toLowerCase();
  const code = str(pick(r, ["code", "errorCode", "error_code"])).toUpperCase();
  const msg = str(pick(r, ["message", "error", "reason"])).toLowerCase();
  const canProceedRaw = pick(r, ["canProceed", "can_proceed", "success", "ok"]);
  const canProceed = typeof canProceedRaw === "boolean" ? canProceedRaw : status === "success" || status === "ready";
  const blob = `${status} ${code} ${msg} ${findings.map((f) => `${f.code ?? ""} ${f.message ?? ""}`).join(" ")}`.toLowerCase();
  let category: SimCategory = "unknownFailure";
  if (canProceed && findings.every((f) => !/error|fail/i.test(`${f.code ?? ""}`))) {
    const hasWarn = /warn|policy|low_amount|high_amount|unrecognized_asset/.test(blob);
    category = hasWarn ? "policyWarning" : "ready";
  } else if (/unauthor|auth|forbidden|not_allow|signature|signer|approval/.test(blob)) category = "authFailure";
  else if (/fund|treasury|balance|insufficient|shortfall/.test(blob)) category = "fundingFailure";
  else if (/proof|witness|circuit|groth16|zkey|wasm/.test(blob)) category = "proofFailure";
  else if (/warn|policy/.test(blob)) category = "policyWarning";
  const retryable = category === "ready" || category === "policyWarning" ? true : category === "unknownFailure" ? false : category === "fundingFailure" ? true : category === "authFailure" ? false : category === "proofFailure" ? false : false;
  const ok = category === "ready" || category === "policyWarning";
  const summary = `simulation: ${category} — ${findings.length} finding(s)`;
  return { category, canProceed: canProceed && ok, retryable, findings, summary, raw };
}
