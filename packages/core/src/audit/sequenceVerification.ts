import { createHash } from 'crypto';

/**
 * Audit event sequence verification for ZK Payroll.
 *
 * Verifies sequence monotonicity, gap detection, chronological ordering,
 * and cryptographic hash-chain continuity across audit event streams.
 */

export type AuditSequenceErrorCode =
  | 'INVALID_EVENT_FORMAT'
  | 'NON_MONOTONIC_SEQUENCE'
  | 'SEQUENCE_GAP_DETECTED'
  | 'DUPLICATE_SEQUENCE'
  | 'CHRONOLOGICAL_INVERSION'
  | 'HASH_CHAIN_MISMATCH'
  | 'HASH_DIGEST_CORRUPTED';

export interface AuditLogEvent {
  id: string;
  sequenceNumber: number;
  timestamp: string | number;
  eventType: string;
  payrollBatchId?: string;
  actor?: string;
  previousHash?: string;
  hash?: string;
  data?: Record<string, unknown>;
}

export interface AuditSequenceViolation {
  index: number;
  sequenceNumber: number;
  code: AuditSequenceErrorCode;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface AuditSequenceVerificationOptions {
  /** Expected starting sequence number. Default: first event's sequence number */
  expectedStartSequence?: number;
  /** Allow sequence gaps (e.g., if querying a filtered subset). Default: false */
  allowGaps?: boolean;
  /** Verify SHA-256 hash chain linkages if hashes are present. Default: true */
  verifyHashChain?: boolean;
  /** Allowable timestamp clock skew in milliseconds. Default: 5000 ms */
  maxClockSkewMs?: number;
}

export interface AuditSequenceVerificationResult {
  valid: boolean;
  totalEvents: number;
  firstSequence?: number;
  lastSequence?: number;
  verifiedHashCount: number;
  violations: AuditSequenceViolation[];
}

/**
 * Computes canonical SHA-256 hash of an audit log event.
 */
export function computeAuditEventHash(event: AuditLogEvent, previousHash?: string): string {
  const payload = {
    id: event.id,
    sequenceNumber: event.sequenceNumber,
    timestamp: typeof event.timestamp === 'number' ? event.timestamp : new Date(event.timestamp).toISOString(),
    eventType: event.eventType,
    payrollBatchId: event.payrollBatchId || null,
    actor: event.actor || null,
    previousHash: previousHash || event.previousHash || '',
    data: event.data || {},
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Verifies an ordered sequence of audit events.
 */
export function verifyAuditEventSequence(
  events: AuditLogEvent[],
  options: AuditSequenceVerificationOptions = {}
): AuditSequenceVerificationResult {
  const allowGaps = options.allowGaps ?? false;
  const verifyHashChain = options.verifyHashChain ?? true;
  const maxClockSkewMs = options.maxClockSkewMs ?? 5000;

  const violations: AuditSequenceViolation[] = [];
  let verifiedHashCount = 0;

  if (!Array.isArray(events) || events.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      verifiedHashCount: 0,
      violations: [],
    };
  }

  let expectedSeq = options.expectedStartSequence ?? events[0].sequenceNumber;
  let previousTimestamp = 0;
  let previousHash: string | undefined = undefined;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Check basic format
    if (!event || typeof event.sequenceNumber !== 'number' || !event.id || !event.eventType) {
      violations.push({
        index: i,
        sequenceNumber: event?.sequenceNumber ?? -1,
        code: 'INVALID_EVENT_FORMAT',
        message: `Event at index ${i} is missing required fields (id, sequenceNumber, or eventType).`,
      });
      continue;
    }

    const currentSeq = event.sequenceNumber;
    const currentTimestamp =
      typeof event.timestamp === 'number' ? event.timestamp : new Date(event.timestamp).getTime();

    // Check sequence numbering
    if (i === 0 && options.expectedStartSequence !== undefined && currentSeq !== options.expectedStartSequence) {
      violations.push({
        index: i,
        sequenceNumber: currentSeq,
        code: 'NON_MONOTONIC_SEQUENCE',
        message: `Initial event has sequence ${currentSeq}, expected ${options.expectedStartSequence}.`,
        expected: options.expectedStartSequence,
        actual: currentSeq,
      });
    } else if (i > 0) {
      const prevSeq = events[i - 1].sequenceNumber;

      if (currentSeq === prevSeq) {
        violations.push({
          index: i,
          sequenceNumber: currentSeq,
          code: 'DUPLICATE_SEQUENCE',
          message: `Duplicate sequence number ${currentSeq} detected at indices ${i - 1} and ${i}.`,
          expected: prevSeq + 1,
          actual: currentSeq,
        });
      } else if (currentSeq < prevSeq) {
        violations.push({
          index: i,
          sequenceNumber: currentSeq,
          code: 'NON_MONOTONIC_SEQUENCE',
          message: `Sequence decreased from ${prevSeq} to ${currentSeq} at index ${i}.`,
          expected: prevSeq + 1,
          actual: currentSeq,
        });
      } else if (!allowGaps && currentSeq > prevSeq + 1) {
        violations.push({
          index: i,
          sequenceNumber: currentSeq,
          code: 'SEQUENCE_GAP_DETECTED',
          message: `Sequence gap detected: expected ${prevSeq + 1}, found ${currentSeq}.`,
          expected: prevSeq + 1,
          actual: currentSeq,
        });
      }
    }

    // Check timestamp causality
    if (Number.isNaN(currentTimestamp)) {
      violations.push({
        index: i,
        sequenceNumber: currentSeq,
        code: 'INVALID_EVENT_FORMAT',
        message: `Event at index ${i} has an invalid timestamp: ${event.timestamp}`,
      });
    } else if (i > 0 && currentTimestamp < previousTimestamp - maxClockSkewMs) {
      violations.push({
        index: i,
        sequenceNumber: currentSeq,
        code: 'CHRONOLOGICAL_INVERSION',
        message: `Timestamp for event ${currentSeq} (${currentTimestamp}) precedes previous timestamp (${previousTimestamp}) beyond allowed skew of ${maxClockSkewMs}ms.`,
        expected: `>= ${previousTimestamp - maxClockSkewMs}`,
        actual: currentTimestamp,
      });
    }

    // Check cryptographic hash chain linkage
    if (verifyHashChain && event.previousHash !== undefined && i > 0) {
      if (previousHash !== undefined && event.previousHash !== previousHash) {
        violations.push({
          index: i,
          sequenceNumber: currentSeq,
          code: 'HASH_CHAIN_MISMATCH',
          message: `Hash chain broken at sequence ${currentSeq}. Expected previousHash "${previousHash}", but got "${event.previousHash}".`,
          expected: previousHash,
          actual: event.previousHash,
        });
      }
    }

    // Check event hash self-consistency if hash is provided
    if (verifyHashChain && event.hash !== undefined) {
      const computed = computeAuditEventHash(event, previousHash);
      if (computed !== event.hash) {
        violations.push({
          index: i,
          sequenceNumber: currentSeq,
          code: 'HASH_DIGEST_CORRUPTED',
          message: `Event ${currentSeq} hash digest does not match computed payload hash.`,
          expected: computed,
          actual: event.hash,
        });
      } else {
        verifiedHashCount++;
      }
    }

    previousTimestamp = currentTimestamp;
    previousHash = event.hash;
    expectedSeq = currentSeq + 1;
  }

  return {
    valid: violations.length === 0,
    totalEvents: events.length,
    firstSequence: events[0]?.sequenceNumber,
    lastSequence: events[events.length - 1]?.sequenceNumber,
    verifiedHashCount,
    violations,
  };
}
