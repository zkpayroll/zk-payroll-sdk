import { TreasuryCheckpoint, parseTreasuryCheckpoints, RawCheckpointRecord } from '../treasury/checkpoints';

export interface TreasuryReconciliationReport {
  totalAllocated: string;
  totalDisbursed: string;
  variance: string;
  isReconciled: boolean;
  checkpoints: Array<{
    id: string;
    allocated: string;
    disbursed: string;
    timestamp: number;
    status: 'verified' | 'discrepancy' | 'pending';
  }>;
  generatedAt: number;
}

/**
 * Builds a treasury reconciliation report from raw or parsed checkpoint data.
 * Computes totals, variance, and overall reconciliation state.
 */
export function generateTreasuryReconciliationReport(
  records: RawCheckpointRecord[] | TreasuryCheckpoint[]
): TreasuryReconciliationReport {
  const checkpoints: TreasuryCheckpoint[] = Array.isArray(records) && records.length > 0 && 'allocated' in records[0]
    ? (records as TreasuryCheckpoint[])
    : parseTreasuryCheckpoints(records as RawCheckpointRecord[]);

  let totalAllocated = 0n;
  let totalDisbursed = 0n;

  const formattedCheckpoints = checkpoints.map((cp) => {
    totalAllocated += cp.allocated;
    totalDisbursed += cp.disbursed;
    return {
      id: cp.id,
      allocated: cp.allocated.toString(),
      disbursed: cp.disbursed.toString(),
      timestamp: cp.timestamp,
      status: cp.status,
    };
  });

  const variance = totalAllocated - totalDisbursed;
  const isReconciled = variance === 0n && checkpoints.every((c) => c.status === 'verified');

  return {
    totalAllocated: totalAllocated.toString(),
    totalDisbursed: totalDisbursed.toString(),
    variance: variance.toString(),
    isReconciled,
    checkpoints: formattedCheckpoints,
    generatedAt: Date.now(),
  };
}
