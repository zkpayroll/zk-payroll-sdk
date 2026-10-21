/**
 * Funding attestation freshness helper.
 *
 * A funding attestation is the on-chain or off-chain record that a treasury
 * balance is sufficient to cover a payroll run. Attestations expire: submitting
 * a payroll run against an expired attestation can cause contract reverts or
 * double-spend races.
 *
 * This module checks whether a given attestation is still fresh relative to a
 * caller-supplied clock, and returns a structured result that callers can act
 * on without having to parse raw timestamps or handle string-based codes.
 */

/** Input for the freshness check. */
export interface FundingAttestationFreshnessInput {
  /** Epoch timestamp (ms) when the attestation was issued. */
  issuedAt: number;
  /**
   * Epoch timestamp (ms) at which the attestation expires.
   * Must be strictly after `issuedAt`.
   */
  expiresAt: number;
  /**
   * Epoch timestamp (ms) used as "now". Defaults to `Date.now()` when omitted.
   * Injecting this value makes tests deterministic.
   */
  now?: number;
  /**
   * Optional additional freshness window in milliseconds.
   * When set, attestations that will expire within this window are flagged as
   * `EXPIRING_SOON` even though they are technically still valid.
   * Useful for proactively refreshing attestations before submitting long-running batches.
   */
  warnBeforeExpiryMs?: number;
}

/** Stable result codes returned by {@link checkFundingAttestationFreshness}. */
export const FundingAttestationFreshnessCode = {
  /** The attestation is current and safe to use. */
  FRESH: "FRESH",
  /** The attestation is valid but will expire within the warn window. */
  EXPIRING_SOON: "EXPIRING_SOON",
  /** The attestation has expired; refresh it before submitting the run. */
  EXPIRED: "EXPIRED",
  /** `issuedAt` is after `expiresAt` or after `now` — malformed attestation. */
  INVALID_TIMESTAMPS: "INVALID_TIMESTAMPS",
} as const;

export type FundingAttestationFreshnessCode =
  (typeof FundingAttestationFreshnessCode)[keyof typeof FundingAttestationFreshnessCode];

/** Structured result from {@link checkFundingAttestationFreshness}. */
export interface FundingAttestationFreshnessResult {
  /** True only when the attestation is FRESH or EXPIRING_SOON. */
  isFresh: boolean;
  /** Stable result code — use this for branching, not the message string. */
  code: FundingAttestationFreshnessCode;
  /** Milliseconds remaining until expiry; 0 when already expired. */
  remainingMs: number;
  /** Human-readable summary safe for logs and dashboards. Never includes payroll amounts or recipient data. */
  message: string;
}

/**
 * Checks whether a funding attestation is still fresh.
 *
 * @param input - Attestation timestamps and optional clock override.
 * @returns A structured {@link FundingAttestationFreshnessResult}.
 *
 * @example
 * ```typescript
 * const result = checkFundingAttestationFreshness({
 *   issuedAt: Date.now() - 60_000,
 *   expiresAt: Date.now() + 300_000,
 *   warnBeforeExpiryMs: 60_000,
 * });
 * if (!result.isFresh) throw new Error(result.message);
 * ```
 */
export function checkFundingAttestationFreshness(
  input: FundingAttestationFreshnessInput
): FundingAttestationFreshnessResult {
  const now = input.now ?? Date.now();
  const { issuedAt, expiresAt } = input;

  if (
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt ||
    issuedAt > now
  ) {
    return {
      isFresh: false,
      code: FundingAttestationFreshnessCode.INVALID_TIMESTAMPS,
      remainingMs: 0,
      message:
        "Funding attestation has invalid timestamps. Re-fetch the attestation before submitting.",
    };
  }

  if (now >= expiresAt) {
    return {
      isFresh: false,
      code: FundingAttestationFreshnessCode.EXPIRED,
      remainingMs: 0,
      message:
        "Funding attestation has expired. Refresh the attestation before submitting the payroll run.",
    };
  }

  const remainingMs = expiresAt - now;

  if (
    input.warnBeforeExpiryMs !== undefined &&
    Number.isFinite(input.warnBeforeExpiryMs) &&
    input.warnBeforeExpiryMs >= 0 &&
    remainingMs <= input.warnBeforeExpiryMs
  ) {
    return {
      isFresh: true,
      code: FundingAttestationFreshnessCode.EXPIRING_SOON,
      remainingMs,
      message: `Funding attestation expires soon (${Math.ceil(remainingMs / 1000)}s remaining). Consider refreshing before submitting.`,
    };
  }

  return {
    isFresh: true,
    code: FundingAttestationFreshnessCode.FRESH,
    remainingMs,
    message: `Funding attestation is fresh (${Math.ceil(remainingMs / 1000)}s remaining).`,
  };
}
