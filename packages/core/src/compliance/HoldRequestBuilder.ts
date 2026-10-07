import { ComplianceHoldValidationError, HoldReleaseAuthorizationError } from "./errors";
import type {
  HoldReasonCode,
  HoldScope,
  HoldTarget,
  PlaceHoldRequest,
  ReleaseHoldRequest,
} from "./types";

const VALID_SCOPES: readonly HoldScope[] = ["employer", "period", "batch", "employee"];

const VALID_REASON_CODES: readonly HoldReasonCode[] = [
  "KYC_REVIEW_PENDING",
  "SANCTIONS_SCREENING",
  "TAX_WITHHOLDING_DISCREPANCY",
  "REGULATORY_INVESTIGATION",
  "DUPLICATE_PAYMENT_SUSPECTED",
  "MANUAL_REVIEW_REQUESTED",
  "OTHER",
];

const MAX_NOTE_LENGTH = 500;
const MIN_AUTHORIZATION_TOKEN_LENGTH = 8;

/** A single validation problem found on a hold request. */
export interface HoldValidationIssue {
  field: string;
  message: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validateTarget(target: HoldTarget | undefined): HoldValidationIssue[] {
  const issues: HoldValidationIssue[] = [];

  if (!target) {
    issues.push({ field: "target", message: "A hold target (scope + id) is required." });
    return issues;
  }

  if (!VALID_SCOPES.includes(target.scope)) {
    issues.push({
      field: "target.scope",
      message: `Scope must be one of: ${VALID_SCOPES.join(", ")}.`,
    });
  }

  if (!isNonEmptyString(target.id)) {
    issues.push({ field: "target.id", message: "Target id is required." });
  }

  return issues;
}

/**
 * Validates a {@link PlaceHoldRequest} without throwing.
 * Returns an array of issues; an empty array means the request is valid.
 */
export function validatePlaceHoldRequest(input: PlaceHoldRequest): HoldValidationIssue[] {
  const issues = validateTarget(input.target);

  if (!VALID_REASON_CODES.includes(input.reasonCode)) {
    issues.push({
      field: "reasonCode",
      message: `Reason code must be one of: ${VALID_REASON_CODES.join(", ")}.`,
    });
  }

  if (!isNonEmptyString(input.placedBy)) {
    issues.push({
      field: "placedBy",
      message: "placedBy is required to identify who placed the hold.",
    });
  }

  if (input.note !== undefined && input.note.length > MAX_NOTE_LENGTH) {
    issues.push({
      field: "note",
      message: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.`,
    });
  }

  return issues;
}

/**
 * Validates and normalizes a request to place a compliance hold.
 *
 * @throws {ComplianceHoldValidationError} If the request fails validation.
 */
export function buildPlaceHoldRequest(input: PlaceHoldRequest): PlaceHoldRequest {
  const issues = validatePlaceHoldRequest(input);
  if (issues.length > 0) {
    throw new ComplianceHoldValidationError(
      `Compliance hold request failed validation with ${issues.length} error(s): ${issues[0].message}`,
      issues[0].field,
      { issues }
    );
  }

  return {
    ...input,
    target: { ...input.target },
  };
}

/**
 * Validates the authorization inputs on a {@link ReleaseHoldRequest} without
 * throwing. Returns an array of issues; an empty array means the request is
 * authorized to proceed.
 *
 * This only validates the *shape* of the authorization inputs (present,
 * non-empty, minimally well-formed) -- it does not itself verify the token
 * against an authorization service. Callers are expected to perform that
 * check separately (or via a contract call) before honoring the release.
 */
export function validateReleaseAuthorization(input: ReleaseHoldRequest): HoldValidationIssue[] {
  const issues: HoldValidationIssue[] = [];

  if (!isNonEmptyString(input.holdId)) {
    issues.push({ field: "holdId", message: "holdId is required to release a hold." });
  }

  if (!isNonEmptyString(input.releasedBy)) {
    issues.push({
      field: "releasedBy",
      message: "releasedBy is required to identify who authorized the release.",
    });
  }

  if (
    !isNonEmptyString(input.authorizationToken) ||
    input.authorizationToken.trim().length < MIN_AUTHORIZATION_TOKEN_LENGTH
  ) {
    issues.push({
      field: "authorizationToken",
      message: `A valid authorization token (min ${MIN_AUTHORIZATION_TOKEN_LENGTH} characters) is required to release a hold.`,
    });
  }

  return issues;
}

/**
 * Asserts that a {@link ReleaseHoldRequest} carries valid authorization
 * inputs.
 *
 * @throws {HoldReleaseAuthorizationError} If any authorization input is
 * missing or malformed. The thrown error's context never includes the raw
 * `authorizationToken`.
 */
export function assertValidReleaseAuthorization(input: ReleaseHoldRequest): void {
  const issues = validateReleaseAuthorization(input);
  if (issues.length > 0) {
    throw new HoldReleaseAuthorizationError(
      `Hold release authorization failed with ${issues.length} error(s): ${issues[0].message}`,
      issues[0].field,
      { issues, holdId: input.holdId }
    );
  }
}

/**
 * Validates and normalizes a request to release a compliance hold.
 *
 * @throws {HoldReleaseAuthorizationError} If the authorization inputs are invalid.
 */
export function buildReleaseHoldRequest(input: ReleaseHoldRequest): ReleaseHoldRequest {
  assertValidReleaseAuthorization(input);
  return { ...input };
}
