import {
  verifyAuditEventSequence,
  computeAuditEventHash,
  AuditLogEvent,
} from '../../src/audit/sequenceVerification';

describe('Audit Event Sequence Verification (#695)', () => {
  it('successfully verifies a strictly monotonic sequence with valid hash chain', () => {
    const rawEvents = [
      {
        id: 'evt-1',
        sequenceNumber: 1,
        timestamp: '2026-10-16T10:00:00Z',
        eventType: 'PAYROLL_BATCH_INITIATED',
        payrollBatchId: 'batch-1',
      },
      {
        id: 'evt-2',
        sequenceNumber: 2,
        timestamp: '2026-10-16T10:01:00Z',
        eventType: 'PAYROLL_PROOF_GENERATED',
        payrollBatchId: 'batch-1',
      },
      {
        id: 'evt-3',
        sequenceNumber: 3,
        timestamp: '2026-10-16T10:02:00Z',
        eventType: 'PAYROLL_BATCH_SETTLED',
        payrollBatchId: 'batch-1',
      },
    ];

    // Build valid hash chain
    const events: AuditLogEvent[] = [];
    let prevHash: string | undefined = undefined;
    for (const raw of rawEvents) {
      const evt: AuditLogEvent = {
        ...raw,
        previousHash: prevHash,
      };
      evt.hash = computeAuditEventHash(evt, prevHash);
      prevHash = evt.hash;
      events.push(evt);
    }

    const result = verifyAuditEventSequence(events, { expectedStartSequence: 1 });
    expect(result.valid).toBe(true);
    expect(result.totalEvents).toBe(3);
    expect(result.verifiedHashCount).toBe(3);
    expect(result.violations).toHaveLength(0);
    expect(result.firstSequence).toBe(1);
    expect(result.lastSequence).toBe(3);
  });

  it('fails verification on sequence gap when gaps are not allowed', () => {
    const events: AuditLogEvent[] = [
      {
        id: 'evt-1',
        sequenceNumber: 1,
        timestamp: 1000,
        eventType: 'EVENT_A',
      },
      {
        id: 'evt-3', // Missing sequence 2
        sequenceNumber: 3,
        timestamp: 2000,
        eventType: 'EVENT_B',
      },
    ];

    const result = verifyAuditEventSequence(events, { allowGaps: false });
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'SEQUENCE_GAP_DETECTED')).toBe(true);
  });

  it('fails verification on duplicate sequence number', () => {
    const events: AuditLogEvent[] = [
      {
        id: 'evt-1',
        sequenceNumber: 1,
        timestamp: 1000,
        eventType: 'EVENT_A',
      },
      {
        id: 'evt-2',
        sequenceNumber: 1, // Duplicate 1
        timestamp: 1500,
        eventType: 'EVENT_B',
      },
    ];

    const result = verifyAuditEventSequence(events);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'DUPLICATE_SEQUENCE')).toBe(true);
  });

  it('detects broken hash chain', () => {
    const event1: AuditLogEvent = {
      id: 'evt-1',
      sequenceNumber: 1,
      timestamp: 1000,
      eventType: 'EVENT_A',
    };
    event1.hash = computeAuditEventHash(event1);

    const event2: AuditLogEvent = {
      id: 'evt-2',
      sequenceNumber: 2,
      timestamp: 2000,
      eventType: 'EVENT_B',
      previousHash: 'corrupted-previous-hash',
    };
    event2.hash = computeAuditEventHash(event2, 'corrupted-previous-hash');

    const result = verifyAuditEventSequence([event1, event2]);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'HASH_CHAIN_MISMATCH')).toBe(true);
  });

  it('detects chronological inversion beyond allowed clock skew', () => {
    const events: AuditLogEvent[] = [
      {
        id: 'evt-1',
        sequenceNumber: 1,
        timestamp: 100000,
        eventType: 'EVENT_A',
      },
      {
        id: 'evt-2',
        sequenceNumber: 2,
        timestamp: 50000, // 50s backwards
        eventType: 'EVENT_B',
      },
    ];

    const result = verifyAuditEventSequence(events, { maxClockSkewMs: 5000, verifyHashChain: false });
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'CHRONOLOGICAL_INVERSION')).toBe(true);
  });

  it('edge case: handles empty event array', () => {
    const result = verifyAuditEventSequence([]);
    expect(result.valid).toBe(true);
    expect(result.totalEvents).toBe(0);
    expect(result.violations).toHaveLength(0);
  });
});
