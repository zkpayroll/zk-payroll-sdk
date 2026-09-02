import { describe, it, expect } from 'vitest';
import { parseTreasuryCheckpoint, parseTreasuryCheckpoints } from '../treasury/checkpoints';
import { generateTreasuryReconciliationReport } from './report';

describe('Treasury Reconciliation Checkpoint Report Parser (#405)', () => {
  it('parses raw checkpoint record and redacts sensitive employee notes', () => {
    const raw = {
      checkpointId: 'cp-101',
      allocatedAmount: '50000',
      disbursedAmount: '50000',
      employeeSecretId: 'SECRET-EMP-999',
      memo: 'Confidential salary data',
    };
    const parsed = parseTreasuryCheckpoint(raw);
    expect(parsed.id).toBe('cp-101');
    expect(parsed.allocated).toBe(50000n);
    expect(parsed.disbursed).toBe(50000n);
    expect(parsed.status).toBe('verified');
    expect(parsed).not.toHaveProperty('employeeSecretId');
    expect(parsed).not.toHaveProperty('memo');
  });

  it('generates a balanced treasury reconciliation report', () => {
    const records = [
      { id: 'cp-1', allocatedAmount: '1000', disbursedAmount: '1000', status: 'verified' },
      { id: 'cp-2', allocatedAmount: '2000', disbursedAmount: '2000', status: 'verified' },
    ];
    const report = generateTreasuryReconciliationReport(records);
    expect(report.totalAllocated).toBe('3000');
    expect(report.totalDisbursed).toBe('3000');
    expect(report.variance).toBe('0');
    expect(report.isReconciled).toBe(true);
    expect(report.checkpoints.length).toBe(2);
  });

  it('detects variance mismatch and marks report as unreconciled', () => {
    const records = [
      { id: 'cp-1', allocatedAmount: '5000', disbursedAmount: '4000' },
    ];
    const report = generateTreasuryReconciliationReport(records);
    expect(report.totalAllocated).toBe('5000');
    expect(report.totalDisbursed).toBe('4000');
    expect(report.variance).toBe('1000');
    expect(report.isReconciled).toBe(false);
    expect(report.checkpoints[0].status).toBe('discrepancy');
  });
});
