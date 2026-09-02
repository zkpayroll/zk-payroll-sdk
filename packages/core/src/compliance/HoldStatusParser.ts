import type { ComplianceHold, HoldReasonCode, HoldScope, HoldState } from "./types";

const VALID_SCOPES = new Set<HoldScope>(["employer", "period", "batch", "employee"]);
const VALID_STATES = new Set<HoldState>(["active", "released", "unknown"]);
const VALID_REASON_CODES = new Set<HoldReasonCode>([
  "KYC_REVIEW_PENDING",
  "SANCTIONS_SCREENING",
  "TAX_WITHHOLDING_DISCREPANCY",
  "REGULATORY_INVESTIGATION",
  "DUPLICATE_PAYMENT_SUSPECTED",
  "MANUAL_REVIEW_REQUESTED",
  "OTHER",
]);

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Parses a raw compliance hold status response (e.g. a decoded contract
 * query result or a backend JSON payload) into a {@link ComplianceHold}.
 *
 * This never throws. Any response that is missing its scope, target id, or
 * a recognized `state` is parsed with `state: "unknown"` rather than
 * defaulting to `"active"` or `"released"` -- an indeterminate hold status
 * must never be silently treated as "safe to pay" or "safe to ignore".
 * Callers that need a hard failure on malformed input should validate the
 * `state` of the returned hold themselves.
 */
export function parseHoldStatus(raw: unknown): ComplianceHold {
  const record: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  const holdId = asNonEmptyString(record.holdId) ?? "unknown";
  const scope = VALID_SCOPES.has(record.scope as HoldScope)
    ? (record.scope as HoldScope)
    : undefined;
  const targetId = asNonEmptyString(record.targetId);
  const reasonCode = VALID_REASON_CODES.has(record.reasonCode as HoldReasonCode)
    ? (record.reasonCode as HoldReasonCode)
    : "OTHER";
  const placedBy = asNonEmptyString(record.placedBy) ?? "unknown";
  const placedAt = asFiniteNumber(record.placedAt) ?? 0;

  // A hold can only be confidently "active" or "released" when it also
  // carries a well-formed scope and target id; otherwise there's nothing
  // to safely block or unblock, so it's reported as "unknown".
  const state: HoldState =
    scope !== undefined && targetId !== undefined && VALID_STATES.has(record.state as HoldState)
      ? (record.state as HoldState)
      : "unknown";

  const hold: ComplianceHold = {
    holdId,
    target: { scope: scope ?? "employer", id: targetId ?? "unknown" },
    state,
    reasonCode,
    placedBy,
    placedAt,
  };

  const note = asNonEmptyString(record.note);
  if (note !== undefined) hold.note = note;

  if (state === "released") {
    const releasedBy = asNonEmptyString(record.releasedBy);
    const releasedAt = asFiniteNumber(record.releasedAt);
    const releaseReason = asNonEmptyString(record.releaseReason);
    if (releasedBy !== undefined) hold.releasedBy = releasedBy;
    if (releasedAt !== undefined) hold.releasedAt = releasedAt;
    if (releaseReason !== undefined) hold.releaseReason = releaseReason;
  }

  return hold;
}
