/**
 * Deterministic fixtures for transaction receipt redaction snapshot tests.
 *
 * Follows the shared fixture contract (see `tests/fixtures/index.ts`):
 * every value is hardcoded — no `Date.now()`, no random IDs, no runtime
 * hashing — so snapshots are byte-identical across runs and processes.
 *
 * Fixtures deliberately mix sensitive payroll fields (recipients, amounts,
 * keys, commitments) with non-sensitive operational fields (receipt IDs,
 * ledger numbers, networks, statuses) so snapshot tests can prove that:
 *
 *   1. Sensitive values never survive redaction,
 *   2. Operational fields remain useful for debugging/audit trails,
 *   3. Nested objects and arrays are traversed recursively,
 *   4. Any redaction regression changes the stored snapshot.
 */

import { PayrollReceipt } from "../../src/receipts/types";
import { RedactionOptions } from "../../src/redaction/types";

// ── Raw sensitive values used across all fixtures ───────────────────────────

/**
 * Every raw sensitive value embedded in the fixtures below.
 *
 * Snapshot tests iterate this list and assert none of these values appear in
 * any redacted output. Adding a new sensitive value to a fixture MUST be
 * accompanied by adding it here, otherwise it is not covered by the leak
 * assertions.
 */
export const REDACTION_SNAPSHOT_SENSITIVE_VALUES: readonly string[] = [
  // Recipient / employer / employee Stellar addresses
  "GARECIPIENT111111111111111111111111111111111111111111111111SNAP01",
  "GARECIPIENT222222222222222222222222222222222222222222222222SNAP02",
  "GEMPLOYER0000000000000000000000000000000000000000000000000SNAP0",
  "GEMPLOYEE00000000000000000000000000000000000000000000000000SNAP0",
  // Secret key material
  "SAPRIVATEKEYSECRETVALUE0000000000000000000000000000000snap",
  "SADMINKEYSECRETVALUE0000000000000000000000000000000000snap0",
  "sk_live_apikey_snapshots_51f3a9c7d2e84b60",
  "bearer_token_snap_9f8e7d6c5b4a",
  "refresh_snap_44aa55bb",
  "signing_key_snap_zz99",
  "seed_phrase_snap_alpha_one",
  "mnemonic_snap_donor_harbor_lantern_vault_pony_cactus",
  // ZK material
  "witness_material_snap_a1b2",
  "commitment_hash_snap_3f9c1e77aa02bb45",
  "nullifier_snap_81bd4f20ce97a512",
];

/** Convenience lookup by role so test failures read clearly. */
export const REDACTION_SNAPSHOT_VALUES_BY_ROLE: Record<string, string> = {
  primaryRecipient: "GARECIPIENT111111111111111111111111111111111111111111111111SNAP01",
  secondaryRecipient: "GARECIPIENT222222222222222222222222222222222222222222222222SNAP02",
  employer: "GEMPLOYER0000000000000000000000000000000000000000000000000SNAP0",
  employee: "GEMPLOYEE00000000000000000000000000000000000000000000000000SNAP0",
  privateKey: "SAPRIVATEKEYSECRETVALUE0000000000000000000000000000000snap",
  adminKey: "SADMINKEYSECRETVALUE0000000000000000000000000000000000snap0",
  apiKey: "sk_live_apikey_snapshots_51f3a9c7d2e84b60",
  accessToken: "bearer_token_snap_9f8e7d6c5b4a",
  refreshToken: "refresh_snap_44aa55bb",
  signingKey: "signing_key_snap_zz99",
  seed: "seed_phrase_snap_alpha_one",
  mnemonic: "mnemonic_snap_donor_harbor_lantern_vault_pony_cactus",
  witness: "witness_material_snap_a1b2",
  commitmentHash: "commitment_hash_snap_3f9c1e77aa02bb45",
  nullifier: "nullifier_snap_81bd4f20ce97a512",
};

// ── Non-sensitive operational values that must survive redaction ────────────

/**
 * Values that MUST remain present in redacted receipt payloads so logs and
 * audit exports stay useful (identifiers, chain references, statuses).
 */
export const RECEIPT_OPERATIONAL_VALUES: readonly string[] = [
  "pr_snap_run_2026_08",
  "testnet",
  "CBULKPAYROLLCONTRACTID000000000000000000000000000000snap00",
];

/** Operational values specific to the settled (success) receipt fixture. */
export const SUCCESS_RECEIPT_OPERATIONAL_VALUES: readonly string[] = [
  ...RECEIPT_OPERATIONAL_VALUES,
  "rcpt_snap_success_0001",
  "settled",
  "2f1c9be47d0a83ff55e21cc709ba66de41a2d58893cf10b7ee54a19d83027fc4",
  "XLM",
];

/** Operational values specific to the failed-settlement receipt fixture. */
export const FAILURE_RECEIPT_OPERATIONAL_VALUES: readonly string[] = [
  ...RECEIPT_OPERATIONAL_VALUES,
  "rcpt_snap_failure_0002",
  "failed",
  "8be14a90c7d25361ffa0927be4c11d5860fa39ce72b0441d95ac6e08bf31d270",
  "USDC",
];

// ── Shared transaction references ───────────────────────────────────────────

export const SUCCESS_TX_REFERENCE = {
  txHash: "2f1c9be47d0a83ff55e21cc709ba66de41a2d58893cf10b7ee54a19d83027fc4",
  ledger: 1234567,
  network: "testnet",
  submittedAt: "2026-08-20T09:15:00Z",
  confirmedAt: "2026-08-20T09:15:07Z",
  contractId: "CBULKPAYROLLCONTRACTID000000000000000000000000000000snap00",
} as const;

export const FAILURE_TX_REFERENCE = {
  txHash: "8be14a90c7d25361ffa0927be4c11d5860fa39ce72b0441d95ac6e08bf31d270",
  ledger: 1234570,
  network: "testnet",
  submittedAt: "2026-08-21T14:02:00Z",
  contractId: "CBULKPAYROLLCONTRACTID000000000000000000000000000000snap00",
} as const;

// ── Receipt metadata payloads (nested objects & arrays) ─────────────────────

/**
 * Metadata for the success receipt.
 *
 * Mixes:
 *  - top-level sensitive keys (`secret`),
 *  - nested-object sensitive keys (`disbursement.recipient`),
 *  - arrays of objects with per-element sensitive keys (`lineItems[].amount`),
 *  - deeply nested credentials (`credentials.apiKey`),
 *  - non-sensitive operational context (`department`, `runDate`, counts).
 */
export const SUCCESS_RECEIPT_METADATA = {
  runLabel: "August 2026 payroll cycle",
  department: "Engineering",
  runDate: "2026-08-20",
  recipientCount: 2,
  secretRefNote: "rotation scheduled",
  secret: "SADMINKEYSECRETVALUE0000000000000000000000000000000000snap0",
  disbursement: {
    batchId: "batch_snap_001",
    currency: "XLM",
    recipient: "GARECIPIENT111111111111111111111111111111111111111111111111SNAP01",
    amount: "12500000",
  },
  lineItems: [
    {
      employeeRef: "emp_snap_001",
      role: "engineer",
      recipient: "GARECIPIENT111111111111111111111111111111111111111111111111SNAP01",
      amount: "7500000",
      salaryBand: "L5",
    },
    {
      employeeRef: "emp_snap_002",
      role: "designer",
      recipient: "GARECIPIENT222222222222222222222222222222222222222222222222SNAP02",
      amount: "5000000",
      salaryBand: "L3",
    },
  ],
  credentials: {
    vaultPath: "kv/payroll/testnet/signer",
    privateKey: "SAPRIVATEKEYSECRETVALUE0000000000000000000000000000000snap",
    apiKey: "sk_live_apikey_snapshots_51f3a9c7d2e84b60",
  },
} as const;

/**
 * Metadata for the failure receipt, including payroll-only sensitive fields
 * (`salaryAmount`, `employer`, `employee`, `commitmentHash`, `nullifier`)
 * that require the payroll redaction preset's `additionalFields` to catch.
 */
export const FAILURE_RECEIPT_METADATA = {
  failureStage: "proof_generation",
  retryCount: 2,
  salaryAmount: "120000",
  employer: "GEMPLOYER0000000000000000000000000000000000000000000000000SNAP0",
  employee: "GEMPLOYEE00000000000000000000000000000000000000000000000000SNAP0",
  commitmentHash: "commitment_hash_snap_3f9c1e77aa02bb45",
  nullifier: "nullifier_snap_81bd4f20ce97a512",
  diagnostics: [
    { step: "witness_load", status: "ok", witness: "witness_material_snap_a1b2" },
    { step: "prove", status: "error", detail: "constraint unsatisfied" },
  ],
} as const;

// ── Receipts ────────────────────────────────────────────────────────────────

/**
 * SHA-256 digests of the canonicalized metadata constants above,
 * precomputed offline so fixtures stay deterministic and hardcoded.
 */
export const SUCCESS_METADATA_DIGEST =
  "84b44419c3214720eb58ba0cc778602cf2f82b1bfb1816f212b972f9840f20d3";
export const FAILURE_METADATA_DIGEST =
  "290a2f0b857389a462a8f4260c8656e8cea86a7dc60b1b76d81fd311434579a4";

/** Fully populated settled receipt (the "success" scenario). */
export const RECEIPT_SUCCESS_SETTLED: PayrollReceipt = {
  receiptId: "rcpt_snap_success_0001",
  payrollId: "pr_snap_run_2026_08",
  settlementStatus: "settled",
  transactionReference: { ...SUCCESS_TX_REFERENCE },
  metadataDigest: SUCCESS_METADATA_DIGEST,
  metadata: { ...SUCCESS_RECEIPT_METADATA },
  totalAmount: "12500000",
  currency: "XLM",
  recipientCount: 2,
  issuedAt: "2026-08-20T09:15:08Z",
  settledAt: "2026-08-20T09:16:00Z",
  viewKeyId: "vk_snap_compliance_01",
  complianceHash: "compliance_hash_snap_5e4d3c2b1a00",
  signature: "sig_snap_success_base64placeholder==",
  signerPublicKey: "GSIGNERSNAPPUBLICKEY000000000000000000000000000000000000sn0",
  redacted: false,
};

/** Failed-settlement receipt with payroll-specific sensitive metadata. */
export const RECEIPT_FAILED_SETTLEMENT: PayrollReceipt = {
  receiptId: "rcpt_snap_failure_0002",
  payrollId: "pr_snap_run_2026_08",
  settlementStatus: "failed",
  transactionReference: { ...FAILURE_TX_REFERENCE },
  metadataDigest: FAILURE_METADATA_DIGEST,
  metadata: { ...FAILURE_RECEIPT_METADATA },
  totalAmount: "120000",
  currency: "USDC",
  recipientCount: 1,
  issuedAt: "2026-08-21T14:03:30Z",
  viewKeyId: "vk_snap_compliance_01",
  redacted: false,
};

/** Malformed receipt missing required fields (verifier INVALID_SHAPE path). */
export const RECEIPT_MALFORMED: Record<string, unknown> = {
  receiptId: "rcpt_snap_malformed_0003",
  settlementStatus: "unknown",
  metadataDigest: "not-a-real-digest",
  issuedAt: "2026-08-22T00:00:00Z",
  note: "payrollId and transactionReference intentionally omitted",
};

// ── Standalone nested tree for deep-redaction snapshots ─────────────────────

/**
 * A deeply nested structure combining objects, arrays, arrays-of-objects and
 * arrays-of-arrays with sensitive keys present at every depth level.
 */
export const NESTED_REDACTION_TREE = {
  run: { id: "run_snap_deep", network: "testnet" },
  recipients: [
    {
      recipient: "GARECIPIENT111111111111111111111111111111111111111111111111SNAP01",
      amount: "7500000",
      payments: [{ memo: "september", seed: "seed_phrase_snap_alpha_one" }],
    },
    {
      recipient: "GARECIPIENT222222222222222222222222222222222222222222222222SNAP02",
      amount: "5000000",
      payments: [],
    },
  ],
  auth: {
    authorization: "Bearer bearer_token_snap_9f8e7d6c5b4a",
    refresh_token: "refresh_snap_44aa55bb",
    nested: { deeper: { signingKey: "signing_key_snap_zz99" } },
  },
  tags: ["net-90", "ops"],
} as const;

// ── Error / log fixtures ────────────────────────────────────────────────────

/** Error context carrying secrets alongside operational identifiers. */
export const ERROR_CONTEXT_WITH_SECRETS: Record<string, unknown> = {
  transactionId: "tx_snap_error_0001",
  contractId: "CBULKPAYROLLCONTRACTID000000000000000000000000000000snap00",
  network: "testnet",
  recipient: "GARECIPIENT111111111111111111111111111111111111111111111111SNAP01",
  amount: "7500000",
  apiKey: "sk_live_apikey_snapshots_51f3a9c7d2e84b60",
};

/** Error messages with inline sensitive `field=value` pairs. */
export const RAW_ERROR_MESSAGES: readonly string[] = [
  "Payment failed: recipient=GARECIPIENT111111111111111111111111111111111111111111111111SNAP01 is invalid",
  "Overflow: amount=7500000 exceeds max",
  "Auth rejected: apiKey=sk_live_apikey_snapshots_51f3a9c7d2e84b60 not authorized",
  "Simulation failed after witness=witness_material_snap_a1b2 load",
  "Wallet unlock failed: mnemonic=mnemonic_snap_donor_harbor_lantern_vault_pony_cactus provided twice",
];

/** Error log entry exactly as an unredacted sink would receive it. */
export const RAW_ERROR_LOG_ENTRY = {
  level: "error",
  event: "settlement_failed",
  msg: "Contract reverted: recipient=GARECIPIENT222222222222222222222222222222222222222222222222SNAP02 amount=5000000",
  txHash: "8be14a90c7d25361ffa0927be4c11d5860fa39ce72b0441d95ac6e08bf31d270",
  context: { ...ERROR_CONTEXT_WITH_SECRETS },
} as const;

// ── Redaction option presets under test ─────────────────────────────────────

/**
 * Payroll-specific vocabulary the generic engine does not know about
 * (matching is exact-match and case-sensitive — see README policy table).
 * Receipt exports MUST pass these via `additionalFields`.
 */
export const PAYROLL_ADDITIONAL_SENSITIVE_FIELDS: readonly string[] = [
  "salary",
  "salaryAmount",
  "employer",
  "employee",
  "commitmentHash",
  "nullifier",
  "totalAmount",
];

/** SDK defaults: placeholder mode, built-in sensitive field set only. */
export const DEFAULT_REDACTION_OPTIONS: RedactionOptions = {};

/**
 * Payroll preset (the canonical export policy): engine defaults plus
 * payroll-only fields such as aggregates (`totalAmount`), compensation
 * (`salary`, `salaryAmount`) and ZK material (`commitmentHash`, `nullifier`).
 */
export const PAYROLL_REDACTION_OPTIONS: RedactionOptions = {
  additionalFields: [...PAYROLL_ADDITIONAL_SENSITIVE_FIELDS],
};

/** Masking preset: preserves shape while hiding values. */
export const MASK_REDACTION_OPTIONS: RedactionOptions = {
  mode: "mask",
  additionalFields: [...PAYROLL_ADDITIONAL_SENSITIVE_FIELDS],
};

/** Removal preset: drops every sensitive key (defaults + payroll set). */
export const REMOVE_REDACTION_OPTIONS: RedactionOptions = {
  mode: "remove",
  additionalFields: [...PAYROLL_ADDITIONAL_SENSITIVE_FIELDS],
};
