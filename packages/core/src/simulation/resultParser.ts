/**
 * Typed simulation result parser.
 *
 * Raw contract simulation responses come in several shapes — SDK
 * `SimulationResult` objects, error-like objects, plain error strings — and
 * dashboards need a stable, typed view of them. `parseSimulationResponse`
 * converts any of those shapes into a deterministic
 * {@link ParsedSimulationResult} with:
 *
 * - a dominant {@link ParsedSimulationCategory} (`success`,
 *   `authorization_failure`, `funding_failure`, `proof_failure`,
 *   `policy_warning`, or `unknown`),
 * - per-finding typed categories, severities, and actionable hints,
 * - `ready` (can payroll proceed?) and `hasWarnings` flags,
 * - **safe, inspectable diagnostics** — messages are control-character-free
 *   and truncated, and raw response objects are never embedded.
 *
 * @module
 */

import type { SimulationResult } from "./types";

/** Typed categories a parsed simulation result can fall into. */
export type ParsedSimulationCategory =
  | "success"
  | "authorization_failure"
  | "funding_failure"
  | "proof_failure"
  | "policy_warning"
  | "unknown";

/** Severity of a single parsed finding. */
export type ParsedFindingSeverity = "info" | "warning" | "error";

/** One typed finding extracted from a simulation response. */
export interface ParsedSimulationFinding {
  /** Typed category this finding belongs to. */
  category: ParsedSimulationCategory;
  /** Finding severity. */
  severity: ParsedFindingSeverity;
  /** Stable machine-readable code (from the response when present, else synthesized). */
  code: string;
  /** Sanitized human-readable message (control characters stripped, truncated). */
  message: string;
  /** Actionable next step for dashboards/CLI consumers. */
  hint?: string;
  /** Optional input field the finding refers to (preserved when the response provides it). */
  field?: string;
}

/** Safe diagnostic metadata preserved for unknown/unmatched failures. */
export interface ParsedSimulationDiagnostics {
  /** Which response shape the parser recognized. */
  source: "simulation_result" | "error" | "string" | "unparseable";
  /** All stable codes seen in the response, in deterministic order. */
  codes: string[];
  /** Sanitized, truncated detail — inspectable without leaking raw payloads. */
  detail: string;
}

/** Stable, typed view of a simulation response. */
export interface ParsedSimulationResult {
  /** Dominant category for the whole response. */
  category: ParsedSimulationCategory;
  /** True when payroll can proceed (no error findings and not blocked). */
  ready: boolean;
  /** True when any advisory (non-blocking) warnings were reported. */
  hasWarnings: boolean;
  /** Typed findings, in deterministic order. */
  findings: ParsedSimulationFinding[];
  /** Safe diagnostic metadata. */
  diagnostics: ParsedSimulationDiagnostics;
}

/** Maximum length of any sanitized message/detail string. */
export const SIMULATION_DETAIL_MAX_LENGTH = 200;

const CATEGORY_CODES: Record<ParsedSimulationCategory, string> = {
  success: "SIM_SUCCESS",
  authorization_failure: "SIM_AUTHORIZATION_FAILURE",
  funding_failure: "SIM_FUNDING_FAILURE",
  proof_failure: "SIM_PROOF_FAILURE",
  policy_warning: "SIM_POLICY_WARNING",
  unknown: "SIM_UNKNOWN_FAILURE",
};

const CATEGORY_HINTS: Record<ParsedSimulationCategory, string> = {
  success: "Simulation passed; the batch can proceed to submission.",
  authorization_failure:
    "Re-authenticate the signer or attach the missing signatures, then re-run the simulation.",
  funding_failure:
    "Top up the treasury for the affected asset (or reduce the batch amount), then re-run the simulation.",
  proof_failure:
    "Generate and attach a valid ZK proof for the batch before submitting.",
  policy_warning:
    "Review the payroll policy limits and approvals, then adjust the batch or policy.",
  unknown:
    "The failure did not match any known simulation pattern; inspect diagnostics.detail for safe, truncated details.",
};

/**
 * Classifies a raw simulation error message into a typed category.
 *
 * Pattern order is deliberate: authorization is checked before funding so
 * "unauthorized" is never mistaken for a balance problem, and funding before
 * proof/policy so reserve-shortfall messages land on funding.
 *
 * @param message - Raw error text (already expected to be a string).
 * @returns The best-matching failure category, or `"unknown"`.
 */
export function classifySimulationFailure(message: string): ParsedSimulationCategory {
  const text = message.toLowerCase();
  if (/unauthori[sz]ed|bad[_ -]?auth|missing[_ -]?sign(er|ature)|not[_ -]?signed|signature.*(invalid|fail|missing)|auth.*(fail|error|denied)|account.*frozen/.test(text)) {
    return "authorization_failure";
  }
  if (/insufficient|not enough|shortfall|underfunded|overdraft|balance|funds|treasury|stroops|required.*(available|balance)/.test(text)) {
    return "funding_failure";
  }
  if (/proof|witness|snark|groth16|circuit|verifying[_ -]?key|verification[_ -]?key|\bvk\b/.test(text)) {
    return "proof_failure";
  }
  if (/policy|approval|allowance|capacity|limit|settlement window|reserve/.test(text)) {
    return "policy_warning";
  }
  return "unknown";
}

/**
 * Strips control characters and truncates a message to a safe length so it
 * can be surfaced in dashboards and logs without leaking raw payloads.
 */
export function sanitizeSimulationDetail(value: string): string {
  const cleaned = value.replace(/[\x00-\x1F\x7F]/g, " ").trim();
  return cleaned.length > SIMULATION_DETAIL_MAX_LENGTH
    ? cleaned.slice(0, SIMULATION_DETAIL_MAX_LENGTH) + "…"
    : cleaned;
}

/**
 * Parses a raw simulation response into a stable, typed result object.
 *
 * Accepts a typed SDK `SimulationResult`, an error-like object
 * (`message`/`name`/`code`), a raw string, or `null`/`undefined`. The output
 * is always a `ParsedSimulationResult` — never a throw — so dashboards can
 * handle every response uniformly. Unknown responses remain safely
 * inspectable via `diagnostics` (sanitized detail, no raw payload embedding).
 *
 * @param response - The raw response to parse (any shape).
 * @returns A deterministic typed result with a dominant category.
 *
 * @example
 * ```typescript
 * const parsed = parseSimulationResponse(rawResponse);
 * if (parsed.category === "funding_failure") {
 *   showTopUpPrompt(parsed.findings[0].hint);
 * }
 * ```
 */
export function parseSimulationResponse(response: unknown): ParsedSimulationResult {
  if (response === null || response === undefined) {
    return {
      category: "unknown",
      ready: false,
      hasWarnings: false,
      findings: [
        {
          category: "unknown",
          severity: "error",
          code: CATEGORY_CODES.unknown,
          message: "Simulation response was empty",
          hint: CATEGORY_HINTS.unknown,
        },
      ],
      diagnostics: {
        source: "unparseable",
        codes: [CATEGORY_CODES.unknown],
        detail: "null or undefined response",
      },
    };
  }

  if (typeof response === "string") {
    return fromFailureDetail(response, "string");
  }

  if (typeof response === "object") {
    const candidate = response as Record<string, unknown>;

    if (typeof candidate.status === "string" && Array.isArray(candidate.findings)) {
      return fromSimulationResult(response as unknown as SimulationResult);
    }
    // Legacy/compat producers may send only the boolean `success` flag (the
    // canonical `SimulationResult` carries both it and `status`). Normalize
    // that shape instead of dropping it into "unrecognized".
    if (typeof candidate.success === "boolean" && Array.isArray(candidate.findings)) {
      return fromSimulationResult({
        status: candidate.success ? "success" : "error",
        findings: candidate.findings as SimulationResult["findings"],
        canProceed: candidate.success,
      });
    }
    if (
      typeof candidate.message === "string" ||
      typeof candidate.error === "string" ||
      typeof candidate.code === "string" ||
      typeof candidate.name === "string"
    ) {
      const detailMessage =
        typeof candidate.message === "string"
          ? candidate.message
          : typeof candidate.error === "string"
            ? candidate.error
            : typeof candidate.code === "string"
              ? candidate.code
              : (candidate.name as string);
      return fromFailureDetail(
        detailMessage,
        "error",
        typeof candidate.code === "string" ? candidate.code : undefined
      );
    }
  }

  return {
    category: "unknown",
    ready: false,
    hasWarnings: false,
    findings: [
      {
        category: "unknown",
        severity: "error",
        code: CATEGORY_CODES.unknown,
        message: "Unrecognized simulation response shape",
        hint: CATEGORY_HINTS.unknown,
      },
    ],
    diagnostics: {
      source: "unparseable",
      codes: [CATEGORY_CODES.unknown],
      detail: sanitizeSimulationDetail(safeDescribe(response)),
    },
  };
}

/** Builds the typed result for a recognized `SimulationResult` object. */
function fromSimulationResult(result: SimulationResult): ParsedSimulationResult {
  const findings = (Array.isArray(result.findings) ? result.findings : []).map((finding) => {
    const code = typeof finding?.code === "string" ? finding.code : "";
    const message = typeof finding?.message === "string" ? finding.message : safeStringify(finding);
    const category = classifySimulationFailure(`${code} ${message}`);
    const severity: ParsedFindingSeverity =
      finding?.severity === "warning" ? "warning" : finding?.severity === "info" ? "info" : "error";
    return {
      category,
      severity,
      code: code.length > 0 ? code : CATEGORY_CODES[category],
      message: sanitizeSimulationDetail(message),
      hint: CATEGORY_HINTS[category],
      field: typeof finding?.field === "string" ? finding.field : undefined,
    };
  });

  const errorFindings = findings.filter((f) => f.severity === "error");
  const hasErrors = errorFindings.length > 0;
  const hasWarnings = findings.some((f) => f.severity === "warning");

  let category: ParsedSimulationCategory;
  if (hasErrors) {
    category = errorFindings[0].category;
  } else if (hasWarnings || result.status === "warning") {
    category = "policy_warning";
  } else {
    category = "success";
  }

  const ready = result.status === "success" && result.canProceed === true && !hasErrors;
  const codeList = findings.map((f) => f.code);

  return {
    category,
    ready,
    hasWarnings,
    findings,
    diagnostics: {
      source: "simulation_result",
      codes: codeList.length > 0 ? codeList : [CATEGORY_CODES[category]],
      detail: sanitizeSimulationDetail(
        `status=${String(result.status)}; canProceed=${String(result.canProceed)}; ` +
          `${errorFindings.length} error(s), ${findings.length - errorFindings.length} finding(s)`
      ),
    },
  };
}

/** Builds the typed result for an error-like response or raw string. */
function fromFailureDetail(
  message: string,
  source: "string" | "error",
  rawCode?: string
): ParsedSimulationResult {
  const category = classifySimulationFailure(message);
  // Prefer the response's own stable code when present; synthesize otherwise.
  const code = rawCode && rawCode.length > 0 ? rawCode : CATEGORY_CODES[category];
  return {
    category,
    ready: false,
    hasWarnings: false,
    findings: [
      {
        category,
        severity: "error",
        code,
        message: sanitizeSimulationDetail(message),
        hint: CATEGORY_HINTS[category],
      },
    ],
    diagnostics: {
      source,
      codes: [code],
      detail: sanitizeSimulationDetail(message),
    },
  };
}

/** Best-effort JSON stringify that never throws. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One-line description of an arbitrary value, without embedding raw JSON. */
function safeDescribe(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value)
      .slice(0, 10)
      .join(", ");
    return `object with keys [${keys}]`;
  }
  return typeof value;
}