import { explainHold } from "./explanations";
import type { ComplianceHold, HoldCheckResult, HoldScope, PayrollActionScope } from "./types";

const NOT_BLOCKED_EXPLANATION =
  "No active or unresolved compliance holds apply to this payroll action.";

/**
 * Scopes checked from broadest to narrowest -- an employer-wide hold blocks
 * every period/batch/employee underneath it, so it takes priority when a
 * payroll action is covered by holds at multiple scopes.
 */
const SCOPE_CHECK_ORDER: Array<{
  scope: HoldScope;
  getId: (target: PayrollActionScope) => string | undefined;
}> = [
  { scope: "employer", getId: (t) => t.employer },
  { scope: "period", getId: (t) => t.period },
  { scope: "batch", getId: (t) => t.batch },
  { scope: "employee", getId: (t) => t.employee },
];

/**
 * A hold blocks payroll unless it has been explicitly released. An
 * indeterminate ("unknown") status is treated as blocking so callers fail
 * closed rather than paying out under an unresolved hold.
 */
function isBlocking(hold: ComplianceHold): boolean {
  return hold.state === "active" || hold.state === "unknown";
}

/**
 * Finds the highest-priority hold that blocks a payroll action, checking
 * employer, then period, then batch, then employee scope. Returns
 * `undefined` when no blocking hold applies.
 */
export function findBlockingHold(
  target: PayrollActionScope,
  holds: readonly ComplianceHold[]
): ComplianceHold | undefined {
  for (const { scope, getId } of SCOPE_CHECK_ORDER) {
    const id = getId(target);
    if (id === undefined) continue;

    const match = holds.find(
      (h) => h.target.scope === scope && h.target.id === id && isBlocking(h)
    );
    if (match) return match;
  }

  return undefined;
}

/**
 * Determines whether a payroll action is blocked by a compliance hold,
 * checking employer, period, batch, and employee scopes.
 *
 * @param target The scope ids the payroll action touches. `employer` is
 *   always required; `period`, `batch`, and `employee` are checked only
 *   when provided.
 * @param holds  Candidate holds to check against (e.g. all holds returned
 *   for the employer in question).
 */
export function isPayrollActionBlocked(
  target: PayrollActionScope,
  holds: readonly ComplianceHold[]
): HoldCheckResult {
  const hold = findBlockingHold(target, holds);
  if (!hold) {
    return { blocked: false, explanation: NOT_BLOCKED_EXPLANATION };
  }

  return { blocked: true, hold, explanation: explainHold(hold) };
}
