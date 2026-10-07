import { ZkPayrollError, type ErrorContext } from "../core/errors";

/**
 * Thrown when a {@link PlaceHoldRequest} fails local validation (invalid
 * scope, empty target id, unrecognized reason code, etc.).
 */
export class ComplianceHoldValidationError extends ZkPayrollError {
  constructor(
    message: string,
    public readonly field: string,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, "COMPLIANCE_HOLD_VALIDATION_FAILED", context, cause);
    this.name = "ComplianceHoldValidationError";
  }
}

/**
 * Thrown when a {@link ReleaseHoldRequest} is missing the inputs needed to
 * prove the releasing party is authorized (hold id, releasing party, or a
 * valid authorization token).
 */
export class HoldReleaseAuthorizationError extends ZkPayrollError {
  constructor(
    message: string,
    public readonly field: string,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, "COMPLIANCE_HOLD_RELEASE_UNAUTHORIZED", context, cause);
    this.name = "HoldReleaseAuthorizationError";
  }
}
