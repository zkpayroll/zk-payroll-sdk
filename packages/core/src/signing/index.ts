/**
 * Payroll Signing Payload Inspector
 *
 * Builds and verifies the human-reviewable payload an approver signs
 * before a batch payroll run executes on-chain.
 *
 * Usage:
 * ```ts
 * import { buildSigningPayload, verifyBatchCommitment } from "@zk-payroll/core";
 *
 * const payload = buildSigningPayload(batch, employer, period, policyVersion);
 * // present payload to the approver (aggregates only, no per-employee amounts)
 * ```
 */

export { buildSigningPayload, computeBatchCommitment, verifyBatchCommitment } from "./inspector";

export type { PayrollSigningPayload, SigningAssetGroup } from "./types";
