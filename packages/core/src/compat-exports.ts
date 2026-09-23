/**
 * Backward-compatibility re-exports for public API surface.
 *
 * Preserves access to symbols that were relocated or modularized.
 */

// ── Asset & Amount Parsing ──────────────────────────────────────────────────
export { AmountParseError, AmountParseErrorCode, RoundingMode } from "./assets/amountParsing";
export { AssetRegistryClass, AssetRegistry } from "./assets/AssetRegistry";

// ── Archive & Pagination ────────────────────────────────────────────────────
export { ArchiveFilterBuilder } from "./archived/ArchiveFilterBuilder";
export { getArchivedPayrollPage, archiveIterator } from "./archived/query";
export { buildArchiveSummaryReport } from "./archived/summary";
export { filterArchivedRecords } from "./archived/filters";
export type {
  ArchivedRecord,
  ArchivedRecordFilter,
  ArchiveQuery,
  ArchiveSummaryReport,
} from "./archived/types";
export type { PaginatedResult, PaginationMeta } from "./pagination";

// ── Draft Payroll ───────────────────────────────────────────────────────────
export { DraftBuilder } from "./draft/DraftBuilder";
export { DraftValidationFailedError } from "./draft/DraftValidationFailedError";
export { createDraft, exportDraft, importDraft } from "./draft/DraftSerializer";

// ── Receipt & Verification ──────────────────────────────────────────────────
export type { PayrollReceipt } from "./receipts/types";
export { ReceiptVerificationCode } from "./receipts/types";
export { PayrollReceiptVerificationError } from "./receipts/errors";
export {
  assertValidPayrollReceipt,
  createPayrollReceipt,
  redactReceiptForExport,
  verifyPayrollReceipt,
  verifyPayrollReceiptAsync,
  verifyPayrollReceiptBatch,
} from "./receipts/receiptVerifier";
export {
  canonicalizeMetadata,
  computeMetadataDigest,
  computeMetadataDigestAsync,
  isValidHexDigest,
  verifyMetadataDigestMatch,
} from "./receipts/digest";
