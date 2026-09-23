/**
 * Contract error remediation mapper.
 *
 * Translates SDK/contract error codes into actionable, audience-specific
 * next steps for admins, contributors, SDK users, and auditors.
 *
 * ```ts
 * import { mapErrorToRemediation, RemediationAudience } from "@zk-payroll/core";
 *
 * const guidance = mapErrorToRemediation(err, RemediationAudience.ADMIN);
 * ```
 */
export * from "./types";
export * from "./registry";
export * from "./mapper";
