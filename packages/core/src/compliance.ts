
import { AuthorizationError, AuditAccessRevocationError } from '../errors';

/**
 * Settlement retry compliance and safety utilities.
 *
 * IMPORTANT:
 * This module does not initiate settlements or automatically retry payments.
 * Retry limits and retryable error classifications must be enforced by
 * the settlement execution layer.
 *
 * Never include employee details, salary amounts, payment proofs, secrets,
 * credentials, or personally identifiable information in compliance errors
 * or logs.
 */

export interface SettlementRetryPolicy {
  /** Maximum total settlement attempts, including the initial attempt. */
  maxAttempts: number;

  /** Initial retry delay in milliseconds. */
  initialDelayMs: number;

  /** Maximum retry delay in milliseconds. */
  maxDelayMs: number;

  /** Multiplier applied to the delay after each retry. */
  backoffMultiplier: number;
}

export interface SettlementRetryContext {
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
}

/**
 * Validates retry policy configuration.
 *
 * This validates configuration only; it does not establish the SDK's
 * default retry limits or execute retries.
 */
export function validateSettlementRetryPolicy(
  policy: SettlementRetryPolicy,
): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error('Settlement retry maxAttempts must be a positive integer.');
  }

  if (
    !Number.isFinite(policy.initialDelayMs) ||
    policy.initialDelayMs < 0
  ) {
    throw new Error('Settlement retry initialDelayMs must be non-negative.');
  }

  if (
    !Number.isFinite(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.initialDelayMs
  ) {
    throw new Error(
      'Settlement retry maxDelayMs must be greater than or equal to initialDelayMs.',
    );
  }

  if (
    !Number.isFinite(policy.backoffMultiplier) ||
    policy.backoffMultiplier < 1
  ) {
    throw new Error(
      'Settlement retry backoffMultiplier must be at least 1.',
    );
  }
}

/**
 * Determines whether another retry is permitted by the configured attempt limit.
 *
 * Attempts are counted starting from 1 for the initial settlement attempt.
 * This function does not determine whether the underlying failure is safe
 * to retry.
 */
export function canRetrySettlement(
  context: SettlementRetryContext,
): boolean {
  return (
    context.retryable &&
    Number.isInteger(context.attempt) &&
    Number.isInteger(context.maxAttempts) &&
    context.attempt >= 1 &&
    context.maxAttempts >= 1 &&
    context.attempt < context.maxAttempts
  );
}

/**
 * Calculates exponential backoff delay for a retry.
 *
 * `retryNumber` starts at 1 for the first retry after the initial attempt.
 * The calculated delay is capped by maxDelayMs.
 */
export function calculateSettlementRetryDelay(
  policy: SettlementRetryPolicy,
  retryNumber: number,
): number {
  validateSettlementRetryPolicy(policy);

  if (!Number.isInteger(retryNumber) || retryNumber < 1) {
    throw new Error('Settlement retry number must be a positive integer.');
  }

  const delay =
    policy.initialDelayMs *
    Math.pow(policy.backoffMultiplier, retryNumber - 1);

  return Math.min(delay, policy.maxDelayMs);
}

/**
 * Returns a safe, generic settlement error message.
 *
 * Do not forward raw provider errors to callers when those errors may contain
 * employee information, payroll amounts, proofs, tokens, or internal details.
 */
export function sanitizeSettlementError(
  _error: unknown,
): string {
  return 'Settlement processing failed. Check settlement status before attempting recovery.';
}

/**
 * Checks whether the current caller is authorized to perform a compliance-
 * sensitive operation.
 *
 * Authorization must be checked before settlement retry or recovery actions.
 */
export function assertSettlementRetryAuthorized(
  authorized: boolean,
): void {
  if (!authorized) {
    throw new AuthorizationError(
      'Not authorized to perform settlement recovery.',
    );
  }
}

/**
 * Prevents recovery actions when audit access has been revoked.
 *
 Audit access revocation should be treated as a compliance boundary,
 * not as a transient settlement error.
 */
export function assertSettlementAuditAccess(
  auditAccessGranted: boolean,
): void {
  if (!auditAccessGranted) {
    throw new AuditAccessRevocationError(
      'Audit access revoked. Settlement recovery is restricted.',
    );
  }
}
