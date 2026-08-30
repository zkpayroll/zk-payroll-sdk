import type { RedactionOptions } from "../redaction/types";

/**
 * Valid settlement lifecycle states for a payroll receipt.
 */
export type PayrollSettlementStatus =
  "settled" | "confirmed" | "pending" | "failed" | "rejected" | "unknown";

/**
 * Structured on-chain transaction reference attached to a payroll receipt.
 */
export interface PayrollTransactionReference {
  /** The Stellar or Soroban transaction hash / ID (64-character hex string or XDR hash) */
  txHash: string;
  /** Ledger sequence number in which the transaction was included */
  ledger?: number;
  /** Network name (e.g. "testnet", "mainnet", "standalone", "futurenet") */
  network?: string;
  /** Timestamp when transaction was submitted to the network (ms epoch or ISO string) */
  submittedAt?: number | string;
  /** Timestamp when transaction was confirmed on ledger (ms epoch or ISO string) */
  confirmedAt?: number | string;
  /** Target contract ID involved in execution */
  contractId?: string;
}

/**
 * Core Payroll Receipt data model.
 *
 * Represents an immutable, verifiable proof-of-payment record generated after a payroll
 * execution run or single private payment.
 */
export interface PayrollReceipt {
  /** Unique receipt identifier (e.g. "rcpt_12345" or UUID) */
  receiptId: string;
  /** Associated payroll run or record ID (e.g. "pr_98765" or "run-2026-08") */
  payrollId: string;
  /** Settlement status of the payroll transaction */
  settlementStatus: PayrollSettlementStatus;
  /** On-chain transaction reference (structured object or raw txHash string) */
  transactionReference: PayrollTransactionReference | string;
  /** Lowercase 64-character SHA-256 hex digest of the canonicalized metadata */
  metadataDigest: string;
  /** Optional raw or sanitized metadata payload associated with this payroll record */
  metadata?: Record<string, unknown>;
  /** Total payment amount (stroops or formatted token units, or redacted) */
  totalAmount?: string | bigint;
  /** Currency / Asset symbol or contract address (e.g. "XLM", "USDC") */
  currency?: string;
  /** Number of recipients included in this payroll run */
  recipientCount?: number;
  /** Epoch timestamp (ms) or ISO-8601 string when receipt was created */
  issuedAt: number | string;
  /** Epoch timestamp (ms) or ISO-8601 string when transaction settled */
  settledAt?: number | string;
  /** Compliance or audit view-key ID for selective decryption */
  viewKeyId?: string;
  /** Optional compliance hash matching audit package standards */
  complianceHash?: string;
  /** Optional cryptographic signature verifying authenticity of the receipt */
  signature?: string;
  /** Public key of the entity that signed the receipt */
  signerPublicKey?: string;
  /** Whether sensitive personal identifiable information (PII) has been redacted */
  redacted?: boolean;
}

/**
 * Error / Warning codes emitted during receipt verification.
 */
export const ReceiptVerificationCode = {
  INVALID_SHAPE: "RECEIPT_INVALID_SHAPE",
  PAYROLL_ID_MISSING: "RECEIPT_PAYROLL_ID_MISSING",
  PAYROLL_ID_MISMATCH: "RECEIPT_PAYROLL_ID_MISMATCH",
  SETTLEMENT_STATUS_MISSING: "RECEIPT_SETTLEMENT_STATUS_MISSING",
  SETTLEMENT_STATUS_NOT_ALLOWED: "RECEIPT_SETTLEMENT_STATUS_NOT_ALLOWED",
  UNSETTLED_STATUS: "RECEIPT_UNSETTLED",
  TRANSACTION_REFERENCE_MISSING: "RECEIPT_TRANSACTION_REFERENCE_MISSING",
  TRANSACTION_REFERENCE_INVALID: "RECEIPT_TRANSACTION_REFERENCE_INVALID",
  TRANSACTION_HASH_MISMATCH: "RECEIPT_TRANSACTION_HASH_MISMATCH",
  METADATA_DIGEST_MISSING: "RECEIPT_METADATA_DIGEST_MISSING",
  METADATA_DIGEST_INVALID: "RECEIPT_METADATA_DIGEST_INVALID",
  METADATA_DIGEST_MISMATCH: "RECEIPT_METADATA_DIGEST_MISMATCH",
  ISSUED_AT_MISSING: "RECEIPT_ISSUED_AT_MISSING",
  ISSUED_AT_INVALID: "RECEIPT_ISSUED_AT_INVALID",
  EXPIRED: "RECEIPT_EXPIRED",
  FUTURE_TIMESTAMP: "RECEIPT_FUTURE_TIMESTAMP",
  SIGNATURE_MISSING: "RECEIPT_SIGNATURE_MISSING",
  SIGNATURE_INVALID: "RECEIPT_SIGNATURE_INVALID",
  CUSTOM_VALIDATION_FAILED: "RECEIPT_CUSTOM_VALIDATION_FAILED",
} as const;

export type ReceiptVerificationCode =
  (typeof ReceiptVerificationCode)[keyof typeof ReceiptVerificationCode];

/**
 * Diagnostic issue identified during verification.
 */
export interface ReceiptVerificationIssue {
  /** Stable error code identifying the exact check that failed */
  code: ReceiptVerificationCode;
  /** Name of the field causing the issue, if applicable */
  field?: string;
  /** Human-readable description of the issue (never exposes sensitive PII) */
  message: string;
  /** Issue severity */
  severity: "error" | "warning";
  /** Whether this issue causes verification to fail */
  critical: boolean;
}

/**
 * Options configuring payroll receipt verification rules.
 */
export interface ReceiptVerificationOptions {
  /** Expected payroll ID to match against receipt.payrollId */
  expectedPayrollId?: string;
  /** Whitelist of acceptable settlement statuses (default: ["settled", "confirmed"]) */
  allowedSettlementStatuses?: PayrollSettlementStatus[];
  /** If true (default: true), requires status to be "settled" or "confirmed" */
  requireSettled?: boolean;
  /** Expected transaction hash to match against receipt transaction reference */
  expectedTransactionHash?: string;
  /** Expected metadata digest to verify against receipt.metadataDigest */
  expectedMetadataDigest?: string;
  /**
   * Raw metadata object. If provided, the verifier computes its canonical SHA-256 digest
   * and verifies that it matches receipt.metadataDigest.
   */
  metadata?: Record<string, unknown>;
  /** Maximum allowable age of the receipt in milliseconds (replay & freshness protection) */
  maxAgeMs?: number;
  /** Allowable clock skew in milliseconds (default: 60,000 ms = 1 minute) */
  toleranceMs?: number;
  /** Current timestamp (ms epoch or Date or ISO string) to use for expiration and freshness checks */
  currentTimestamp?: number | string | Date;
  /** If true, treats all warnings as fatal errors (default: false) */
  strict?: boolean;
  /** List of trusted signer public keys. If provided, receipt.signerPublicKey must be in this list */
  trustedSigners?: string[];
  /** If true, requires the receipt to have a valid signature (default: false) */
  requireSignature?: boolean;
  /** Optional custom validator hooks for domain-specific checks */
  customValidators?: Array<
    (
      receipt: PayrollReceipt
    ) =>
      | Promise<ReceiptVerificationIssue | null | undefined>
      | ReceiptVerificationIssue
      | null
      | undefined
  >;
  /** Optional redaction options when producing sanitized output */
  redactionOptions?: RedactionOptions;
}

/**
 * Field-level verification status breakdown.
 */
export interface ReceiptVerifiedFields {
  /** True if payrollId is present and matches expectedPayrollId */
  payrollId: boolean;
  /** True if settlementStatus is present and permitted */
  settlementStatus: boolean;
  /** True if transactionReference has a valid txHash and matches expected hash */
  transactionReference: boolean;
  /** True if metadataDigest format is valid and matches metadata / expected digest */
  metadataDigest: boolean;
  /** True if issuedAt / settledAt is within allowed freshness window */
  freshness?: boolean;
  /** True if cryptographic signature is verified against a trusted signer */
  signature?: boolean;
}

/**
 * Comprehensive verification verdict returned by `verifyPayrollReceipt`.
 */
export interface ReceiptVerificationResult {
  /** Overall verification verdict: true only if no critical errors occurred */
  isValid: boolean;
  /** Verified receipt ID (or "unknown" if missing) */
  receiptId: string;
  /** Verified payroll ID (or "unknown" if missing) */
  payrollId: string;
  /** Verified settlement status */
  settlementStatus: PayrollSettlementStatus;
  /** Detailed field-by-field verification checklist */
  verifiedFields: ReceiptVerifiedFields;
  /** Structured list of all issues (errors and warnings) detected */
  issues: ReceiptVerificationIssue[];
  /** List of actionable error messages (safe for UI feedback and logging) */
  errors: string[];
  /** List of warning messages */
  warnings: string[];
  /** High-level user/auditor-facing summary message */
  summary: string;
  /** Timestamp when verification was conducted (ms epoch) */
  verifiedAt: number;
  /**
   * Sanitized copy of the receipt with sensitive fields redacted,
   * safe for telemetry, logging, and audit exports.
   */
  receipt: PayrollReceipt;
}

/**
 * Parameters for building a new PayrollReceipt instance.
 */
export interface CreatePayrollReceiptParams {
  receiptId?: string;
  payrollId: string;
  settlementStatus?: PayrollSettlementStatus;
  transactionReference: PayrollTransactionReference | string;
  metadata?: Record<string, unknown>;
  metadataDigest?: string;
  totalAmount?: string | bigint;
  currency?: string;
  recipientCount?: number;
  issuedAt?: number | string;
  settledAt?: number | string;
  viewKeyId?: string;
  complianceHash?: string;
  signature?: string;
  signerPublicKey?: string;
  redacted?: boolean;
}
