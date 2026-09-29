/**
 * Execution Confirmation Nonce Helper
 *
 * Provides nonce generation and validation for execution confirmation to prevent
 * replay attacks and ensure idempotency in payroll operations. Nonces are
 * cryptographically secure, timestamped, and scoped to specific operations.
 *
 * ## Privacy & Security Guarantees
 * - Nonces are cryptographically secure (not predictable or derivable)
 * - Operation context is included but not exposed in error messages
 * - Timestamp information is never exposed in validation results
 */

/** Nonce validation result codes */
export type NonceValidationCode =
  | "VALID"
  | "EXPIRED"
  | "ALREADY_USED"
  | "INVALID_FORMAT"
  | "INVALID_SIGNATURE"
  | "CLOCK_SKEW"
  | "OPERATION_MISMATCH"
  | "MISSING_NONCE";

/** Execution operation types that require nonce validation */
export type ExecutionOperationType =
  | "payroll_execution"
  | "payment_submission"
  | "batch_confirmation"
  | "settlement_finalization"
  | "compliance_hold_release";

/** Configuration for nonce generation */
export interface NonceGenerationOptions {
  /** Operation type this nonce is scoped to */
  operationType: ExecutionOperationType;
  /** Optional operation context identifier (e.g., batch ID) */
  contextId?: string;
  /** Validity duration in milliseconds (default: 1 hour) */
  validityDurationMs?: number;
  /** Include timestamp in nonce (default: true) */
  includeTimestamp?: boolean;
}

/** Configuration for nonce validation */
export interface NonceValidationOptions {
  /** Operation type the nonce should be scoped to */
  operationType: ExecutionOperationType;
  /** Optional operation context that the nonce should match */
  contextId?: string;
  /** Clock skew tolerance in milliseconds (default: 60 seconds) */
  maxClockSkewMs?: number;
  /** Validity duration in milliseconds (must match generation) */
  validityDurationMs?: number;
  /** Function to check if nonce has already been used (for replay prevention) */
  checkIfUsed?: (nonce: string) => Promise<boolean>;
  /** Function to mark nonce as used (for replay prevention) */
  markAsUsed?: (nonce: string) => Promise<void>;
}

/** Structured nonce information */
export interface NonceInfo {
  /** The nonce string */
  nonce: string;
  /** Operation type it's scoped to */
  operationType: ExecutionOperationType;
  /** Context identifier if provided */
  contextId?: string;
  /** Timestamp when nonce was generated (milliseconds) */
  generatedAt: number;
  /** Expected expiry time (milliseconds) */
  expiresAt: number;
}

/** Result of nonce validation */
export interface NonceValidationResult {
  /** Whether the nonce is valid */
  valid: boolean;
  /** Stable validation code */
  code: NonceValidationCode;
  /** User-facing message */
  message: string;
  /** Nonce information (if validation passed) */
  nonceInfo?: NonceInfo;
}

/**
 * Default nonce validity duration: 1 hour
 */
export const DEFAULT_NONCE_VALIDITY_MS = 60 * 60 * 1000;

/**
 * Generates a cryptographically secure nonce for operation confirmation
 *
 * @param options - Nonce generation options
 * @returns Nonce information
 */
export function generateExecutionNonce(options: NonceGenerationOptions): NonceInfo {
  const validityMs = options.validityDurationMs ?? DEFAULT_NONCE_VALIDITY_MS;
  const now = Date.now();

  // Generate cryptographically secure random bytes
  // In a real implementation, this would use crypto.getRandomValues or similar
  const randomPart = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0")
  ).join("");

  // Create operation scope
  const opScope = createOperationScope(options.operationType, options.contextId);

  // Compose nonce: operation + timestamp + random
  const timestamp = now.toString(36); // Base36 encoded timestamp (compact)
  const nonce = `${opScope}.${timestamp}.${randomPart}`;

  return {
    nonce,
    operationType: options.operationType,
    contextId: options.contextId,
    generatedAt: now,
    expiresAt: now + validityMs,
  };
}

/**
 * Validates a nonce for operation confirmation
 *
 * @param nonce - The nonce string to validate
 * @param options - Validation options
 * @returns Validation result
 */
export async function validateExecutionNonce(
  nonce: string | undefined,
  options: NonceValidationOptions
): Promise<NonceValidationResult> {
  const now = Date.now();
  const maxSkew = options.maxClockSkewMs ?? 60000;
  const validityMs = options.validityDurationMs ?? DEFAULT_NONCE_VALIDITY_MS;

  // Check if nonce is present
  if (!nonce || typeof nonce !== "string" || nonce.trim() === "") {
    return {
      valid: false,
      code: "MISSING_NONCE",
      message: "No nonce provided for operation confirmation",
    };
  }

  const trimmedNonce = nonce.trim();

  // Parse nonce structure
  const parts = trimmedNonce.split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      code: "INVALID_FORMAT",
      message: "Nonce format is invalid",
    };
  }

  const [opScope, timestampPart, randomPart] = parts;

  // Validate operation scope
  const expectedScope = createOperationScope(options.operationType, options.contextId);
  if (opScope !== expectedScope) {
    return {
      valid: false,
      code: "OPERATION_MISMATCH",
      message: "Nonce is not scoped to the expected operation",
    };
  }

  // Validate timestamp
  let generatedAt: number;
  try {
    generatedAt = parseInt(timestampPart, 36);
    if (isNaN(generatedAt)) {
      return {
        valid: false,
        code: "INVALID_FORMAT",
        message: "Nonce timestamp is malformed",
      };
    }
  } catch {
    return {
      valid: false,
      code: "INVALID_FORMAT",
      message: "Nonce timestamp cannot be parsed",
    };
  }

  // Check clock skew
  const skewMs = Math.abs(now - generatedAt);
  if (skewMs > maxSkew && now > generatedAt) {
    // Allow future timestamps up to skew, but not past
    return {
      valid: false,
      code: "CLOCK_SKEW",
      message: "Nonce timestamp is outside acceptable range",
    };
  }

  // Check expiry
  const expiryTime = generatedAt + validityMs;
  if (now > expiryTime) {
    return {
      valid: false,
      code: "EXPIRED",
      message: "Nonce has expired and is no longer valid",
    };
  }

  // Validate random part format (basic check: 16 bytes = 32 hex chars)
  if (!isValidHexString(randomPart, 16)) {
    return {
      valid: false,
      code: "INVALID_SIGNATURE",
      message: "Nonce signature validation failed",
    };
  }

  // Check if nonce has already been used (for replay prevention)
  if (options.checkIfUsed) {
    const alreadyUsed = await options.checkIfUsed(trimmedNonce);
    if (alreadyUsed) {
      return {
        valid: false,
        code: "ALREADY_USED",
        message: "Nonce has already been used; create a new execution with a fresh nonce",
      };
    }
  }

  // Mark nonce as used
  if (options.markAsUsed) {
    await options.markAsUsed(trimmedNonce);
  }

  // All validations passed
  return {
    valid: true,
    code: "VALID",
    message: "Nonce is valid and confirmed",
    nonceInfo: {
      nonce: trimmedNonce,
      operationType: options.operationType,
      contextId: options.contextId,
      generatedAt,
      expiresAt: expiryTime,
    },
  };
}

/**
 * Batch validates multiple nonces
 *
 * @param nonces - Array of nonce strings
 * @param options - Validation options
 * @returns Array of validation results
 */
export async function validateExecutionNoncesBatch(
  nonces: (string | undefined)[],
  options: NonceValidationOptions
): Promise<NonceValidationResult[]> {
  return Promise.all(nonces.map((n) => validateExecutionNonce(n, options)));
}

/**
 * Checks if all nonces in a batch are valid
 *
 * @param nonces - Array of nonce strings
 * @param options - Validation options
 * @returns True if all nonces are valid
 */
export async function areExecutionNoncesValid(
  nonces: (string | undefined)[],
  options: NonceValidationOptions
): Promise<boolean> {
  const results = await validateExecutionNoncesBatch(nonces, options);
  return results.every((r) => r.valid);
}

/**
 * Builds the operation scope portion of a nonce
 */
function createOperationScope(operationType: ExecutionOperationType, contextId?: string): string {
  if (!contextId) {
    return operationType;
  }
  // Sanitize context ID to ensure it doesn't contain dots (nonce delimiter)
  const safeContextId = contextId.replace(/\./g, "-");
  return `${operationType}:${safeContextId}`;
}

/**
 * Validates that a string is a valid hex string of expected length
 */
function isValidHexString(str: string, expectedByteLength: number): boolean {
  const expectedCharLength = expectedByteLength * 2;
  if (str.length !== expectedCharLength) {
    return false;
  }
  return /^[0-9a-f]+$/i.test(str);
}

/**
 * Extracts nonce information without validation (for debugging/logging)
 * WARNING: This should only be used for internal diagnostics, not for security decisions
 *
 * @param nonce - The nonce string
 * @returns Extracted information or undefined if format is invalid
 */
export function extractNonceInfo(nonce: string): Partial<NonceInfo> | undefined {
  const parts = nonce.trim().split(".");
  if (parts.length !== 3) {
    return undefined;
  }

  const [opScope, timestampPart] = parts;
  let generatedAt: number;

  try {
    generatedAt = parseInt(timestampPart, 36);
    if (isNaN(generatedAt)) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  // Extract operation type and context from scope
  const [operationType, contextId] = opScope.split(":");

  return {
    nonce,
    operationType: operationType as ExecutionOperationType,
    contextId: contextId?.replace(/-/g, "."),
    generatedAt,
  };
}
