/**
 * Errors raised by the payroll policy evaluator.
 *
 * @module
 */

import type { PayrollPolicyEvaluationResult } from "./types";

/** Stable code attached to {@link PayrollPolicyViolationError}. */
export const PAYROLL_POLICY_BLOCKED_CODE = "PAYROLL_POLICY_BLOCKED" as const;

/**
 * Thrown by `assertPayrollPolicies` / `PayrollPolicyEvaluator.evaluateOrThrow`
 * when one or more blocking policy issues are present.
 *
 * The error intentionally exposes only the privacy-safe evaluation result —
 * never the raw payroll request — so it is safe to log and surface in
 * dashboards or telemetry.
 */
export class PayrollPolicyViolationError extends Error {
  public readonly code = PAYROLL_POLICY_BLOCKED_CODE;
  public readonly reasonCodes: string[];
  public readonly result: PayrollPolicyEvaluationResult;

  constructor(message: string, result: PayrollPolicyEvaluationResult) {
    super(message);
    this.name = "PayrollPolicyViolationError";
    this.reasonCodes = [...result.reasonCodes];
    this.result = result;
  }
}
