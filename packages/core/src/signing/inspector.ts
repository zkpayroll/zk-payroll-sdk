/**
 * Signature Payload Inspector
 *
 * Builds the human-reviewable `PayrollSigningPayload` an approver sees
 * before authorizing a batch payroll run, and verifies a payload's
 * `batchCommitment` against a candidate `BatchPayload` before signing.
 *
 * This closes the "blind signing" gap: without this module, a signer
 * (hardware wallet, multisig co-signer, CLI prompt) has no SDK-provided
 * way to confirm what a raw transaction payload actually authorizes
 * before approving it.
 */
import { createHash } from "crypto";
import type { BatchPayload, BatchPaymentEntry } from "../batch/BatchPayloadBuilder";
import type { PayrollPeriodMetadata } from "../simulation/types";
import type { PayrollSigningPayload, SigningAssetGroup } from "./types";

const COMMITMENT_PREFIX = "zkpayroll-batch-commitment-v1";

/**
 * Computes a deterministic SHA-256 commitment binding a batch's exact
 * entries (recipient, amount, asset — in order) to a single hash.
 *
 * Mirrors the versioned-prefix + `createHash("sha256")` pattern used by
 * `simulation/commitmentGenerator.ts`'s `computeCommitmentHash`, so a
 * tampered entry (reordered, added, removed, or amount-changed) always
 * produces a different commitment.
 */
export function computeBatchCommitment(batch: BatchPayload): string {
  const parts = [COMMITMENT_PREFIX, batch.totalAmount.toString()];
  for (const entry of batch.entries) {
    parts.push(`${entry.recipient}:${entry.amount.toString()}:${entry.asset}`);
  }
  const digest = createHash("sha256").update(parts.join("|")).digest("hex");
  return `commit:${digest}`;
}

/** Groups batch entries by asset into aggregate totals for display. */
function groupByAsset(entries: BatchPaymentEntry[]): SigningAssetGroup[] {
  const groups = new Map<string, { recipientCount: number; totalAmount: bigint }>();
  for (const entry of entries) {
    const existing = groups.get(entry.asset);
    if (existing) {
      existing.recipientCount += 1;
      existing.totalAmount += entry.amount;
    } else {
      groups.set(entry.asset, { recipientCount: 1, totalAmount: entry.amount });
    }
  }
  return Array.from(groups.entries()).map(([asset, agg]) => ({ asset, ...agg }));
}

/**
 * Builds a `PayrollSigningPayload` summarizing a batch for approver review.
 *
 * @param batch - The validated batch entries to summarize (never
 *   individually surfaced — only per-asset aggregates appear).
 * @param employer - Stellar public key of the authorizing employer.
 * @param period - The pay period this batch covers.
 * @param policyVersion - The compiled policy schema version the batch
 *   was validated against (see `policy/types.ts`'s `CompiledPayrollPolicy.schemaVersion`).
 *
 * @example
 * ```ts
 * const payload = buildSigningPayload(batch, employerKey, period, 1);
 * const approved = await wallet.signPayload(payload); // approver reviews aggregates only
 * ```
 */
export function buildSigningPayload(
  batch: BatchPayload,
  employer: string,
  period: PayrollPeriodMetadata,
  policyVersion: number
): PayrollSigningPayload {
  return {
    employer,
    periodId: period.periodId,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    policyVersion,
    assetGroups: groupByAsset(batch.entries),
    totalRecipients: batch.entries.length,
    batchCommitment: computeBatchCommitment(batch),
  };
}

/**
 * Verifies that a `PayrollSigningPayload`'s `batchCommitment` matches
 * the given candidate batch — i.e. that the payload being signed
 * actually corresponds to the batch about to be submitted.
 *
 * Returns `false` (never throws) so callers can decide how to surface
 * a mismatch (abort signing, prompt re-review, log an alert).
 */
export function verifyBatchCommitment(
  payload: PayrollSigningPayload,
  candidateBatch: BatchPayload
): boolean {
  return payload.batchCommitment === computeBatchCommitment(candidateBatch);
}
