/**
 * SDK request identifier propagation.
 *
 * A request ID lets integrators correlate one payroll operation across
 * transaction submission, confirmation polling, emitted events, network
 * timing records and outbound HTTP requests. IDs are produced by
 * {@link RunIdentifier} (`req_…`, `corr_…`, `run_…`) or supplied by the
 * caller's own tracing system.
 *
 * Security: a request ID is an opaque correlation token. It is validated
 * against a strict charset so it can never carry free-form text (e.g. an
 * employee name or salary), and validation errors never echo the rejected
 * value back.
 *
 * @module
 */

import { ValidationError } from "./errors";

/** HTTP header used to propagate the request ID on outbound requests. */
export const REQUEST_ID_HEADER = "X-Request-Id";

/** Maximum accepted request ID length. */
export const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Letters, digits and `._:-` only. Covers RunIdentifier formats, UUIDs and
 * common tracing IDs, while excluding whitespace, control characters
 * (header/log injection) and anything that could carry readable payroll data.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** True if `value` is an acceptable request identifier. */
export function isValidRequestIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID_PATTERN.test(value)
  );
}

/**
 * Validates an optional caller-supplied request ID.
 *
 * @returns The ID unchanged, or `undefined` when none was supplied.
 * @throws ValidationError (`INVALID_REQUEST_ID`) when an ID is supplied but
 *   malformed. The message explains the expected format without echoing the
 *   rejected value.
 */
export function normalizeRequestId(requestId: string | undefined | null): string | undefined {
  if (requestId === undefined || requestId === null) return undefined;
  if (!isValidRequestIdentifier(requestId)) {
    throw new ValidationError(
      `Invalid requestId: expected 1-${MAX_REQUEST_ID_LENGTH} characters of letters, digits, ".", "_", ":" or "-" ` +
        `(use RunIdentifier.generateRequestId() or RunIdentifier.generateCorrelationId()).`,
      "requestId",
      "INVALID_REQUEST_ID"
    );
  }
  return requestId;
}

/**
 * Returns a copy of `headers` with {@link REQUEST_ID_HEADER} set, or the
 * original headers when no request ID is given. An explicit header already
 * present (any casing) is preserved.
 */
export function withRequestIdHeader<H extends Record<string, unknown>>(
  headers: H | undefined,
  requestId: string | undefined
): H | Record<string, unknown> | undefined {
  const id = normalizeRequestId(requestId);
  if (!id) return headers;
  const existing = headers
    ? Object.keys(headers).some((k) => k.toLowerCase() === REQUEST_ID_HEADER.toLowerCase())
    : false;
  if (existing) return headers;
  return { ...(headers ?? {}), [REQUEST_ID_HEADER]: id };
}
