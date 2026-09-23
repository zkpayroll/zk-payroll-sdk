import { redactDeep } from "../redaction/RedactionEngine";
import type { RedactionOptions } from "../redaction/types";
import { computeMetadataDigest, computeMetadataDigestAsync, isValidHexDigest } from "./digest";
import { PayrollReceiptVerificationError } from "./errors";
import {
  CreatePayrollReceiptParams,
  PayrollReceipt,
  PayrollSettlementStatus,
  ReceiptVerificationCode,
  ReceiptVerificationIssue,
  ReceiptVerificationOptions,
  ReceiptVerificationResult,
  ReceiptVerifiedFields,
} from "./types";

const DEFAULT_ALLOWED_STATUSES: PayrollSettlementStatus[] = ["settled", "confirmed"];
const DEFAULT_TOLERANCE_MS = 60_000; // 1 minute clock skew tolerance

/**
 * Validates that an unknown object structurally conforms to the PayrollReceipt schema.
 */
export function validatePayrollReceiptShape(data: unknown): data is PayrollReceipt {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.receiptId !== "string" || obj.receiptId.trim().length === 0) {
    return false;
  }
  if (typeof obj.payrollId !== "string" || obj.payrollId.trim().length === 0) {
    return false;
  }
  if (typeof obj.settlementStatus !== "string" || obj.settlementStatus.trim().length === 0) {
    return false;
  }
  if (typeof obj.metadataDigest !== "string" || obj.metadataDigest.trim().length === 0) {
    return false;
  }

  // transactionReference can be a non-empty string or an object with a non-empty string txHash
  if (typeof obj.transactionReference === "string") {
    if (obj.transactionReference.trim().length === 0) return false;
  } else if (typeof obj.transactionReference === "object" && obj.transactionReference !== null) {
    const txRef = obj.transactionReference as Record<string, unknown>;
    if (typeof txRef.txHash !== "string" || txRef.txHash.trim().length === 0) {
      return false;
    }
  } else {
    return false;
  }

  // issuedAt must be a valid number or string
  if (typeof obj.issuedAt !== "number" && typeof obj.issuedAt !== "string") {
    return false;
  }

  return true;
}

/**
 * Extracts normalized transaction hash from a receipt.
 */
export function extractReceiptTxHash(receipt: PayrollReceipt): string {
  if (typeof receipt.transactionReference === "string") {
    return receipt.transactionReference.trim();
  }
  if (typeof receipt.transactionReference === "object" && receipt.transactionReference !== null) {
    return receipt.transactionReference.txHash ? receipt.transactionReference.txHash.trim() : "";
  }
  return "";
}

/**
 * Parses timestamp input into epoch milliseconds.
 */
function parseTimestampToMs(timestamp: number | string | Date | undefined): number | undefined {
  if (timestamp === undefined || timestamp === null) return undefined;
  if (timestamp instanceof Date) return timestamp.getTime();
  if (typeof timestamp === "number") {
    // If timestamp is in seconds (e.g. standard unix epoch < 10000000000), convert to ms
    return timestamp < 10000000000 ? timestamp * 1000 : timestamp;
  }
  if (typeof timestamp === "string") {
    const parsedNumber = Number(timestamp);
    if (!isNaN(parsedNumber) && timestamp.trim().length > 0) {
      return parsedNumber < 10000000000 ? parsedNumber * 1000 : parsedNumber;
    }
    const dateMs = new Date(timestamp).getTime();
    return isNaN(dateMs) ? undefined : dateMs;
  }
  return undefined;
}

/**
 * Synchronously verifies a payroll receipt against defined integrity, settlement,
 * transaction, metadata, and freshness constraints.
 *
 * @param receiptCandidate - The receipt object or unknown payload to verify.
 * @param options          - Verification options (expected IDs, hashes, statuses, time limits).
 * @returns Comprehensive  `ReceiptVerificationResult` with field breakdowns and actionable errors.
 */
export function verifyPayrollReceipt(
  receiptCandidate: PayrollReceipt | unknown,
  options: ReceiptVerificationOptions = {}
): ReceiptVerificationResult {
  const verifiedAt = Date.now();
  const issues: ReceiptVerificationIssue[] = [];

  const verifiedFields: ReceiptVerifiedFields = {
    payrollId: false,
    settlementStatus: false,
    transactionReference: false,
    metadataDigest: false,
  };

  // 1. Structural validation
  if (!validatePayrollReceiptShape(receiptCandidate)) {
    issues.push({
      code: ReceiptVerificationCode.INVALID_SHAPE,
      message:
        "Receipt is malformed or missing required fields (receiptId, payrollId, settlementStatus, transactionReference, metadataDigest, issuedAt).",
      severity: "error",
      critical: true,
    });

    const candidateObj =
      typeof receiptCandidate === "object" && receiptCandidate !== null
        ? (receiptCandidate as Record<string, unknown>)
        : {};

    const fallbackReceipt: PayrollReceipt = {
      receiptId: String(candidateObj.receiptId || "unknown"),
      payrollId: String(candidateObj.payrollId || "unknown"),
      settlementStatus: (candidateObj.settlementStatus as PayrollSettlementStatus) || "unknown",
      transactionReference: String(candidateObj.transactionReference || "unknown"),
      metadataDigest: String(candidateObj.metadataDigest || "unknown"),
      issuedAt: 0,
    };

    return buildResult(
      fallbackReceipt,
      false,
      verifiedFields,
      issues,
      verifiedAt,
      options.redactionOptions
    );
  }

  const receipt = receiptCandidate as PayrollReceipt;

  // 2. Payroll ID validation
  if (!receipt.payrollId || receipt.payrollId.trim().length === 0) {
    issues.push({
      code: ReceiptVerificationCode.PAYROLL_ID_MISSING,
      field: "payrollId",
      message: "Receipt is missing payrollId.",
      severity: "error",
      critical: true,
    });
  } else if (
    options.expectedPayrollId &&
    receipt.payrollId.trim() !== options.expectedPayrollId.trim()
  ) {
    issues.push({
      code: ReceiptVerificationCode.PAYROLL_ID_MISMATCH,
      field: "payrollId",
      message: `Receipt payrollId '${receipt.payrollId}' does not match expected payrollId '${options.expectedPayrollId}'.`,
      severity: "error",
      critical: true,
    });
  } else {
    verifiedFields.payrollId = true;
  }

  // 3. Settlement Status validation
  const allowedStatuses =
    options.allowedSettlementStatuses ??
    (options.requireSettled === false ? undefined : DEFAULT_ALLOWED_STATUSES);

  if (!receipt.settlementStatus) {
    issues.push({
      code: ReceiptVerificationCode.SETTLEMENT_STATUS_MISSING,
      field: "settlementStatus",
      message: "Receipt is missing settlementStatus.",
      severity: "error",
      critical: true,
    });
  } else if (allowedStatuses && !allowedStatuses.includes(receipt.settlementStatus)) {
    const isUnsettled =
      receipt.settlementStatus === "pending" ||
      receipt.settlementStatus === "failed" ||
      receipt.settlementStatus === "rejected";

    issues.push({
      code: isUnsettled
        ? ReceiptVerificationCode.UNSETTLED_STATUS
        : ReceiptVerificationCode.SETTLEMENT_STATUS_NOT_ALLOWED,
      field: "settlementStatus",
      message: `Receipt settlement status '${receipt.settlementStatus}' is not allowed (acceptable: ${allowedStatuses.join(", ")}).`,
      severity: "error",
      critical: true,
    });
  } else {
    verifiedFields.settlementStatus = true;
  }

  // 4. Transaction Reference validation
  const txHash = extractReceiptTxHash(receipt);
  if (!txHash || txHash.length === 0) {
    issues.push({
      code: ReceiptVerificationCode.TRANSACTION_REFERENCE_MISSING,
      field: "transactionReference",
      message: "Receipt is missing transaction reference or txHash.",
      severity: "error",
      critical: true,
    });
  } else if (options.expectedTransactionHash) {
    if (txHash.toLowerCase() !== options.expectedTransactionHash.toLowerCase().trim()) {
      issues.push({
        code: ReceiptVerificationCode.TRANSACTION_HASH_MISMATCH,
        field: "transactionReference",
        message: `Transaction hash in receipt does not match expected transaction hash.`,
        severity: "error",
        critical: true,
      });
    } else {
      verifiedFields.transactionReference = true;
    }
  } else {
    verifiedFields.transactionReference = true;
  }

  // 5. Metadata Digest validation
  if (!receipt.metadataDigest || receipt.metadataDigest.trim().length === 0) {
    issues.push({
      code: ReceiptVerificationCode.METADATA_DIGEST_MISSING,
      field: "metadataDigest",
      message: "Receipt is missing metadataDigest.",
      severity: "error",
      critical: true,
    });
  } else if (!isValidHexDigest(receipt.metadataDigest)) {
    issues.push({
      code: ReceiptVerificationCode.METADATA_DIGEST_INVALID,
      field: "metadataDigest",
      message: "Receipt metadataDigest is not a valid 64-character hexadecimal SHA-256 string.",
      severity: "error",
      critical: true,
    });
  } else {
    let digestValid = true;

    if (options.expectedMetadataDigest) {
      if (
        receipt.metadataDigest.trim().toLowerCase() !==
        options.expectedMetadataDigest.trim().toLowerCase()
      ) {
        issues.push({
          code: ReceiptVerificationCode.METADATA_DIGEST_MISMATCH,
          field: "metadataDigest",
          message: "Receipt metadataDigest does not match the expected metadata digest.",
          severity: "error",
          critical: true,
        });
        digestValid = false;
      }
    }

    const metadataToVerify = options.metadata !== undefined ? options.metadata : receipt.metadata;
    if (metadataToVerify !== undefined && digestValid) {
      const computedDigest = computeMetadataDigest(metadataToVerify);
      if (receipt.metadataDigest.trim().toLowerCase() !== computedDigest.toLowerCase()) {
        issues.push({
          code: ReceiptVerificationCode.METADATA_DIGEST_MISMATCH,
          field: "metadataDigest",
          message:
            "Receipt metadataDigest does not match the computed hash of the metadata payload.",
          severity: "error",
          critical: true,
        });
        digestValid = false;
      }
    }

    if (digestValid) {
      verifiedFields.metadataDigest = true;
    }
  }

  // 6. Freshness & Timestamp validation
  const issuedAtMs = parseTimestampToMs(receipt.issuedAt);
  const nowMs = parseTimestampToMs(options.currentTimestamp) ?? verifiedAt;
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS;

  if (issuedAtMs === undefined) {
    issues.push({
      code: ReceiptVerificationCode.ISSUED_AT_INVALID,
      field: "issuedAt",
      message: `Receipt issuedAt timestamp '${receipt.issuedAt}' is unparseable.`,
      severity: "error",
      critical: true,
    });
    verifiedFields.freshness = false;
  } else {
    let freshnessValid = true;

    // Check future timestamp beyond tolerance
    if (issuedAtMs > nowMs + toleranceMs) {
      issues.push({
        code: ReceiptVerificationCode.FUTURE_TIMESTAMP,
        field: "issuedAt",
        message: `Receipt issuedAt is in the future beyond acceptable clock tolerance (${toleranceMs} ms).`,
        severity: "error",
        critical: true,
      });
      freshnessValid = false;
    }

    // Check maximum age (expiration)
    if (options.maxAgeMs !== undefined && options.maxAgeMs > 0) {
      const ageMs = nowMs - issuedAtMs;
      if (ageMs > options.maxAgeMs + toleranceMs) {
        issues.push({
          code: ReceiptVerificationCode.EXPIRED,
          field: "issuedAt",
          message: `Receipt has expired (age ${Math.round(ageMs / 1000)}s exceeds allowed maxAge ${Math.round(options.maxAgeMs / 1000)}s).`,
          severity: "error",
          critical: true,
        });
        freshnessValid = false;
      }
    }

    verifiedFields.freshness = freshnessValid;
  }

  // 7. Signature & Signer verification
  if (options.requireSignature && !receipt.signature) {
    issues.push({
      code: ReceiptVerificationCode.SIGNATURE_MISSING,
      field: "signature",
      message: "Receipt requires a cryptographic signature, but none was present.",
      severity: "error",
      critical: true,
    });
    verifiedFields.signature = false;
  } else if (options.trustedSigners && options.trustedSigners.length > 0) {
    if (!receipt.signerPublicKey || !options.trustedSigners.includes(receipt.signerPublicKey)) {
      issues.push({
        code: ReceiptVerificationCode.SIGNATURE_INVALID,
        field: "signerPublicKey",
        message: "Receipt signer public key is missing or not included in trustedSigners list.",
        severity: "error",
        critical: true,
      });
      verifiedFields.signature = false;
    } else {
      verifiedFields.signature = true;
    }
  } else if (receipt.signature) {
    verifiedFields.signature = true;
  }

  // 8. Custom synchronous validators
  if (options.customValidators) {
    for (const validator of options.customValidators) {
      try {
        const issue = validator(receipt);
        if (issue && typeof (issue as Promise<unknown>).then !== "function") {
          const resolvedIssue = issue as ReceiptVerificationIssue;
          if (resolvedIssue) {
            issues.push(resolvedIssue);
          }
        }
      } catch (err: unknown) {
        issues.push({
          code: ReceiptVerificationCode.CUSTOM_VALIDATION_FAILED,
          message: `Custom validator failed: ${err instanceof Error ? err.message : String(err)}`,
          severity: "error",
          critical: true,
        });
      }
    }
  }

  const criticalIssues = issues.filter((i) =>
    options.strict ? true : i.critical || i.severity === "error"
  );
  const isValid = criticalIssues.length === 0;

  return buildResult(
    receipt,
    isValid,
    verifiedFields,
    issues,
    verifiedAt,
    options.redactionOptions
  );
}

/**
 * Asynchronously verifies a payroll receipt, supporting asynchronous custom validators
 * and WebCrypto digest verification.
 */
export async function verifyPayrollReceiptAsync(
  receiptCandidate: PayrollReceipt | unknown,
  options: ReceiptVerificationOptions = {}
): Promise<ReceiptVerificationResult> {
  const result = verifyPayrollReceipt(receiptCandidate, options);

  if (!validatePayrollReceiptShape(receiptCandidate)) {
    return result;
  }

  const receipt = receiptCandidate as PayrollReceipt;
  const issues = [...result.issues];

  // Async custom validators
  if (options.customValidators) {
    for (const validator of options.customValidators) {
      try {
        const issueOrPromise = validator(receipt);
        const issue =
          issueOrPromise && typeof (issueOrPromise as Promise<unknown>).then === "function"
            ? await issueOrPromise
            : (issueOrPromise as ReceiptVerificationIssue | null | undefined);

        if (
          issue &&
          !issues.some(
            (existing) => existing.code === issue.code && existing.message === issue.message
          )
        ) {
          issues.push(issue);
        }
      } catch (err: unknown) {
        issues.push({
          code: ReceiptVerificationCode.CUSTOM_VALIDATION_FAILED,
          message: `Custom validator failed: ${err instanceof Error ? err.message : String(err)}`,
          severity: "error",
          critical: true,
        });
      }
    }
  }

  // WebCrypto async metadata digest check if needed
  const metadataToVerify = options.metadata !== undefined ? options.metadata : receipt.metadata;
  if (metadataToVerify !== undefined && isValidHexDigest(receipt.metadataDigest)) {
    const asyncDigest = await computeMetadataDigestAsync(metadataToVerify);
    if (receipt.metadataDigest.trim().toLowerCase() !== asyncDigest.toLowerCase()) {
      if (!issues.some((i) => i.code === ReceiptVerificationCode.METADATA_DIGEST_MISMATCH)) {
        issues.push({
          code: ReceiptVerificationCode.METADATA_DIGEST_MISMATCH,
          field: "metadataDigest",
          message:
            "Receipt metadataDigest does not match the computed hash of the metadata payload.",
          severity: "error",
          critical: true,
        });
      }
    }
  }

  const criticalIssues = issues.filter((i) =>
    options.strict ? true : i.critical || i.severity === "error"
  );
  const isValid = criticalIssues.length === 0;

  return buildResult(
    receipt,
    isValid,
    result.verifiedFields,
    issues,
    result.verifiedAt,
    options.redactionOptions
  );
}

/**
 * Asserts that a payroll receipt is valid, throwing `PayrollReceiptVerificationError` if not.
 *
 * @param receiptCandidate - The receipt to verify.
 * @param options          - Verification options.
 * @returns The sanitized `PayrollReceipt` if valid.
 * @throws PayrollReceiptVerificationError if verification fails.
 */
export function assertValidPayrollReceipt(
  receiptCandidate: PayrollReceipt | unknown,
  options: ReceiptVerificationOptions = {}
): PayrollReceipt {
  const result = verifyPayrollReceipt(receiptCandidate, options);
  if (!result.isValid) {
    const firstCode = result.issues[0]?.code ?? ReceiptVerificationCode.INVALID_SHAPE;
    throw new PayrollReceiptVerificationError(result, firstCode);
  }
  return result.receipt;
}

/**
 * Verifies an array of payroll receipts in batch.
 *
 * @param receipts - Array of receipts to verify.
 * @param options  - Common verification options applied to all receipts.
 * @returns Array of `ReceiptVerificationResult`s matching the input array order.
 */
export function verifyPayrollReceiptBatch(
  receipts: (PayrollReceipt | unknown)[],
  options: ReceiptVerificationOptions = {}
): ReceiptVerificationResult[] {
  if (!Array.isArray(receipts)) {
    return [];
  }
  return receipts.map((receipt) => verifyPayrollReceipt(receipt, options));
}

/**
 * Creates a compliant `PayrollReceipt` object from input parameters.
 * Automatically computes `metadataDigest` if omitted and metadata is provided.
 */
export function createPayrollReceipt(params: CreatePayrollReceiptParams): PayrollReceipt {
  const metadata = params.metadata ?? {};
  const metadataDigest =
    params.metadataDigest && isValidHexDigest(params.metadataDigest)
      ? params.metadataDigest.trim().toLowerCase()
      : computeMetadataDigest(metadata);

  const receipt: PayrollReceipt = {
    receiptId:
      params.receiptId ?? `rcpt_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
    payrollId: params.payrollId,
    settlementStatus: params.settlementStatus ?? "settled",
    transactionReference: params.transactionReference,
    metadataDigest,
    metadata: params.metadata,
    totalAmount: params.totalAmount,
    currency: params.currency,
    recipientCount: params.recipientCount,
    issuedAt: params.issuedAt ?? Date.now(),
    settledAt: params.settledAt,
    viewKeyId: params.viewKeyId,
    complianceHash: params.complianceHash,
    signature: params.signature,
    signerPublicKey: params.signerPublicKey,
    redacted: params.redacted ?? false,
  };

  return receipt;
}

/**
 * Returns a sanitized copy of a `PayrollReceipt` with PII and sensitive values redacted,
 * safe for export, telemetry, logs, or UI display.
 */
export function redactReceiptForExport(
  receipt: PayrollReceipt,
  options: RedactionOptions = {}
): PayrollReceipt {
  const { redacted: safeReceipt } = redactDeep(receipt, {
    placeholder: "[REDACTED]",
    ...options,
  }) as { redacted: PayrollReceipt };

  return {
    ...safeReceipt,
    redacted: true,
  };
}

function buildResult(
  receipt: PayrollReceipt,
  isValid: boolean,
  verifiedFields: ReceiptVerifiedFields,
  issues: ReceiptVerificationIssue[],
  verifiedAt: number,
  redactionOptions?: RedactionOptions
): ReceiptVerificationResult {
  const errors = issues.filter((i) => i.severity === "error").map((i) => i.message);
  const warnings = issues.filter((i) => i.severity === "warning").map((i) => i.message);

  let summary: string;
  if (isValid) {
    summary = `Payroll receipt '${receipt.receiptId}' (payroll: '${receipt.payrollId}') verified successfully with status '${receipt.settlementStatus}'.`;
  } else {
    const errorSummary = errors.length > 0 ? errors.join("; ") : "Integrity checks failed";
    summary = `Payroll receipt verification failed: ${errorSummary}`;
  }

  const safeReceipt = redactReceiptForExport(receipt, redactionOptions);

  return {
    isValid,
    receiptId: receipt.receiptId,
    payrollId: receipt.payrollId,
    settlementStatus: receipt.settlementStatus,
    verifiedFields,
    issues,
    errors,
    warnings,
    summary,
    verifiedAt,
    receipt: safeReceipt,
  };
}
