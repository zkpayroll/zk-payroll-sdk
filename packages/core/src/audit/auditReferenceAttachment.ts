/**
 * Audit Reference Attachment Helper
 *
 * Attaches external audit reference metadata (document URLs, hash digests,
 * labels) to payroll operations for compliance trail purposes.
 *
 * ## Privacy & Security Guarantees
 * - Reference URIs and digests are validated but never echoed in user-facing error messages.
 * - Redacted messages are safe for dashboards, telemetry, and external logs.
 */

/** Supported attachment types */
export type AuditReferenceType = "document" | "receipt" | "proof" | "report" | "external";

/** Input for attaching an audit reference to a payroll operation */
export interface AuditReferenceAttachmentInput {
  /** Unique payroll run or operation identifier */
  operationId: string;
  /** Type of reference being attached */
  referenceType: AuditReferenceType;
  /** Label or short description of the reference */
  label: string;
  /** URI or URL pointing to the reference document */
  uri?: string;
  /** SHA-256 hex digest of the referenced document for integrity verification */
  digest?: string;
  /** ISO 8601 timestamp when the reference was created or issued */
  issuedAt?: string;
  /** Optional non-sensitive metadata */
  metadata?: Record<string, unknown>;
}

/** Validation error codes */
export type AuditReferenceAttachmentErrorCode =
  | "MISSING_OPERATION_ID"
  | "MISSING_LABEL"
  | "INVALID_REFERENCE_TYPE"
  | "INVALID_URI_FORMAT"
  | "INVALID_DIGEST_FORMAT"
  | "INVALID_ISSUED_AT"
  | "LABEL_TOO_LONG";

/** Structured validation error */
export interface AuditReferenceAttachmentError {
  code: AuditReferenceAttachmentErrorCode;
  field: string;
  message: string;
  redactedMessage: string;
}

/** Validation result */
export interface AuditReferenceAttachmentValidationResult {
  isValid: boolean;
  errors: AuditReferenceAttachmentError[];
}

/** Successful attachment result */
export interface AuditReferenceAttachment {
  operationId: string;
  referenceType: AuditReferenceType;
  label: string;
  uri?: string;
  digest?: string;
  issuedAt?: string;
  metadata?: Record<string, unknown>;
  attachedAt: number;
  redactedOperationId: string;
}

// Constants
const VALID_REFERENCE_TYPES: ReadonlySet<string> = new Set([
  "document",
  "receipt",
  "proof",
  "report",
  "external",
]);
const MAX_LABEL_LENGTH = 256;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
const URI_REGEX = /^https?:\/\/.+/;

// Redact helper
export function redactOperationId(id?: string): string {
  if (!id || id.trim().length === 0) return "[ANONYMOUS_OPERATION]";
  const clean = id.trim();
  if (clean.length <= 6) return "[REDACTED_OPERATION]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

// Validate function
export function validateAuditReferenceAttachment(
  input: AuditReferenceAttachmentInput
): AuditReferenceAttachmentValidationResult {
  const errors: AuditReferenceAttachmentError[] = [];

  if (!input.operationId || input.operationId.trim().length === 0) {
    errors.push({
      code: "MISSING_OPERATION_ID",
      field: "operationId",
      message: "Operation ID is required.",
      redactedMessage: "Operation ID is required.",
    });
  }

  if (!input.label || input.label.trim().length === 0) {
    errors.push({
      code: "MISSING_LABEL",
      field: "label",
      message: "A descriptive label is required for the audit reference.",
      redactedMessage: "A descriptive label is required for the audit reference.",
    });
  } else if (input.label.length > MAX_LABEL_LENGTH) {
    errors.push({
      code: "LABEL_TOO_LONG",
      field: "label",
      message: `Label exceeds maximum length of ${MAX_LABEL_LENGTH} characters.`,
      redactedMessage: `Label exceeds maximum length of ${MAX_LABEL_LENGTH} characters.`,
    });
  }

  if (!VALID_REFERENCE_TYPES.has(input.referenceType)) {
    errors.push({
      code: "INVALID_REFERENCE_TYPE",
      field: "referenceType",
      message: `Invalid reference type "${input.referenceType}". Expected one of: ${[...VALID_REFERENCE_TYPES].join(", ")}.`,
      redactedMessage: "Invalid reference type provided.",
    });
  }

  if (input.uri !== undefined && input.uri !== null) {
    if (typeof input.uri !== "string" || !URI_REGEX.test(input.uri.trim())) {
      errors.push({
        code: "INVALID_URI_FORMAT",
        field: "uri",
        message: "URI must be a valid HTTP or HTTPS URL.",
        redactedMessage: "URI must be a valid HTTP or HTTPS URL.",
      });
    }
  }

  if (input.digest !== undefined && input.digest !== null) {
    if (typeof input.digest !== "string" || !SHA256_HEX_REGEX.test(input.digest.trim())) {
      errors.push({
        code: "INVALID_DIGEST_FORMAT",
        field: "digest",
        message: "Digest must be a 64-character lowercase hex SHA-256 hash.",
        redactedMessage: "Digest format is invalid.",
      });
    }
  }

  if (input.issuedAt !== undefined && input.issuedAt !== null) {
    const parsed = Date.parse(input.issuedAt);
    if (isNaN(parsed)) {
      errors.push({
        code: "INVALID_ISSUED_AT",
        field: "issuedAt",
        message: "issuedAt must be a valid ISO 8601 date string.",
        redactedMessage: "issuedAt must be a valid ISO 8601 date string.",
      });
    }
  }

  return { isValid: errors.length === 0, errors };
}

// Main helper
export function attachAuditReference(
  input: AuditReferenceAttachmentInput
): AuditReferenceAttachment {
  const validation = validateAuditReferenceAttachment(input);
  if (!validation.isValid) {
    const redactedMessages = validation.errors.map((e) => e.redactedMessage).join("; ");
    throw new AuditReferenceAttachmentValidationError(validation.errors, redactedMessages);
  }

  return {
    operationId: input.operationId.trim(),
    referenceType: input.referenceType,
    label: input.label.trim(),
    uri: input.uri?.trim(),
    digest: input.digest?.trim().toLowerCase(),
    issuedAt: input.issuedAt,
    metadata: input.metadata,
    attachedAt: Date.now(),
    redactedOperationId: redactOperationId(input.operationId),
  };
}

// Error class
export class AuditReferenceAttachmentValidationError extends Error {
  readonly code = "AUDIT_REFERENCE_VALIDATION_FAILED";
  readonly validationErrors: AuditReferenceAttachmentError[];

  constructor(errors: AuditReferenceAttachmentError[], redactedMessage: string) {
    super(redactedMessage);
    this.name = "AuditReferenceAttachmentValidationError";
    this.validationErrors = errors;
  }
}
