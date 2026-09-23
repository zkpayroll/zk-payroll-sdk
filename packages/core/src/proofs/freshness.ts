import type { ProofPayload } from "../crypto/IProofGenerator";
import { ValidationError } from "../core/errors";

/** Payroll period that a proof is expected to cover. */
export interface PayrollPeriod {
  /** Inclusive ISO-8601 start date. */
  start: string;
  /** Exclusive ISO-8601 end date. */
  end: string;
}

/** Input required to validate proof freshness before a transaction is built. */
export interface ProofFreshnessInput {
  proof: ProofPayload;
  targetPayrollPeriod: PayrollPeriod;
  /** Reference time used for validation; defaults to the current time. */
  now?: string | number | Date;
  /** Maximum permitted proof age in milliseconds. */
  maxAgeMs?: number;
}

export const ProofFreshnessErrorCode = {
  MISSING_METADATA: "PROOF_FRESHNESS_MISSING_METADATA",
  INVALID_METADATA: "PROOF_FRESHNESS_INVALID_METADATA",
  NOT_YET_VALID: "PROOF_NOT_YET_VALID",
  EXPIRED: "PROOF_EXPIRED",
  TOO_OLD: "PROOF_TOO_OLD",
  PERIOD_MISMATCH: "PROOF_PAYROLL_PERIOD_MISMATCH",
} as const;

export type ProofFreshnessErrorCode =
  (typeof ProofFreshnessErrorCode)[keyof typeof ProofFreshnessErrorCode];

function timestamp(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (typeof value !== "string" || !value.trim() || Number.isNaN(parsed)) {
    throw new ValidationError(
      `Proof ${field} must be a valid ISO-8601 timestamp.`,
      field,
      ProofFreshnessErrorCode.INVALID_METADATA
    );
  }
  return parsed;
}

function freshnessError(message: string, field: string, code: ProofFreshnessErrorCode): never {
  throw new ValidationError(message, field, code);
}

/**
 * Assert that a proof is valid for a target payroll period and safe to submit.
 *
 * This function intentionally returns no proof or payroll data. It throws a
 * typed ValidationError at the first failed freshness rule.
 */
export function validateProofFreshness(input: ProofFreshnessInput): void {
  if (!input || typeof input !== "object" || !input.proof) {
    freshnessError(
      "Proof metadata is required before submission.",
      "proof.metadata",
      ProofFreshnessErrorCode.MISSING_METADATA
    );
  }

  const metadata = input.proof.metadata;
  if (!metadata) {
    freshnessError(
      "Proof metadata is required before submission.",
      "proof.metadata",
      ProofFreshnessErrorCode.MISSING_METADATA
    );
  }

  if (!input.targetPayrollPeriod || typeof input.targetPayrollPeriod !== "object") {
    freshnessError(
      "Target payroll period is required for proof validation.",
      "targetPayrollPeriod",
      ProofFreshnessErrorCode.INVALID_METADATA
    );
  }

  const createdAt = timestamp(metadata.createdAt, "creation time");
  const expiresAt = timestamp(metadata.expiresAt, "expiry time");
  const periodStart = timestamp(metadata.payrollPeriodStart, "payroll period start");
  const periodEnd = timestamp(metadata.payrollPeriodEnd, "payroll period end");
  const targetStart = timestamp(input.targetPayrollPeriod.start, "target payroll period start");
  const targetEnd = timestamp(input.targetPayrollPeriod.end, "target payroll period end");
  const now = input.now === undefined ? Date.now() : new Date(input.now).getTime();

  if (Number.isNaN(now)) {
    freshnessError(
      "Validation time must be a valid timestamp.",
      "now",
      ProofFreshnessErrorCode.INVALID_METADATA
    );
  }
  if (expiresAt <= createdAt) {
    freshnessError(
      "Proof expiry time must be after its creation time.",
      "proof.metadata",
      ProofFreshnessErrorCode.INVALID_METADATA
    );
  }
  if (periodEnd <= periodStart || targetEnd <= targetStart) {
    freshnessError(
      "Payroll period end must be after its start.",
      "payrollPeriod",
      ProofFreshnessErrorCode.INVALID_METADATA
    );
  }
  if (createdAt > now) {
    freshnessError(
      "Proof creation time is in the future.",
      "proof.metadata.createdAt",
      ProofFreshnessErrorCode.NOT_YET_VALID
    );
  }
  if (now >= expiresAt) {
    freshnessError(
      "Proof has expired and must be regenerated.",
      "proof.metadata.expiresAt",
      ProofFreshnessErrorCode.EXPIRED
    );
  }
  if (input.maxAgeMs !== undefined && (!Number.isFinite(input.maxAgeMs) || input.maxAgeMs < 0)) {
    freshnessError(
      "Maximum proof age must be a non-negative finite number.",
      "maxAgeMs",
      ProofFreshnessErrorCode.INVALID_METADATA
    );
  }
  if (input.maxAgeMs !== undefined && now - createdAt > input.maxAgeMs) {
    freshnessError(
      "Proof is older than the allowed freshness window.",
      "proof.metadata.createdAt",
      ProofFreshnessErrorCode.TOO_OLD
    );
  }
  if (periodStart !== targetStart || periodEnd !== targetEnd) {
    freshnessError(
      "Proof does not cover the requested payroll period.",
      "targetPayrollPeriod",
      ProofFreshnessErrorCode.PERIOD_MISMATCH
    );
  }
}

/** Alias emphasizing the throw-on-failure behavior for submission guards. */
export const assertProofFresh = validateProofFreshness;
