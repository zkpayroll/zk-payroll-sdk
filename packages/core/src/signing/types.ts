/**
 * Payroll Signing Payload Types
 *
 * The structured, human-reviewable payload an approver (an admin's
 * hardware wallet, a multisig co-signer, a CLI confirmation prompt)
 * is asked to sign before a batch payroll run executes on-chain.
 *
 * Unlike `BatchPayload` (the low-level on-chain entry list), a
 * `PayrollSigningPayload` groups entries by asset and carries the
 * context an approver needs to recognize *what* they're authorizing —
 * employer, pay period, policy version, and a commitment binding the
 * payload to the exact batch — without ever surfacing individual
 * salary amounts in a form meant for display/logging.
 */

/** A single asset's aggregate exposure within a signing payload. */
export interface SigningAssetGroup {
  /** Asset identifier ("native" or a Soroban token contract ID). */
  asset: string;
  /** Number of recipients paid in this asset within the batch. */
  recipientCount: number;
  /** Total amount disbursed in this asset, in stroops. */
  totalAmount: bigint;
}

/**
 * The full payload presented for signing ahead of batch execution.
 *
 * `batchCommitment` binds this summary to the exact underlying
 * `BatchPayload` entries (see `signing/inspector.ts`'s
 * `computeBatchCommitment`) so an approver's signature cannot be
 * replayed against a different, tampered batch.
 */
export interface PayrollSigningPayload {
  /** Stellar public key of the employer authorizing this run. */
  employer: string;
  /** The payroll period this batch covers. */
  periodId: string;
  /** ISO-8601 start date of the pay period. */
  periodStart: string;
  /** ISO-8601 end date of the pay period. */
  periodEnd: string;
  /** Compiled policy schema version this batch was validated against. */
  policyVersion: number;
  /** Per-asset aggregate totals — never per-employee amounts. */
  assetGroups: SigningAssetGroup[];
  /** Total number of recipients across all asset groups. */
  totalRecipients: number;
  /** Deterministic hash binding this payload to its exact batch entries. */
  batchCommitment: string;
}
