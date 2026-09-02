/**
 * Treasury Checkpoints Parser (#405)
 */

export interface RawCheckpointRecord {
  checkpointId?: string;
  id?: string;
  allocatedAmount?: string | bigint | number;
  disbursedAmount?: string | bigint | number;
  timestamp?: number | string;
  status?: string;
  employeeSecretId?: string;
  memo?: string;
}

export interface TreasuryCheckpoint {
  id: string;
  allocated: bigint;
  disbursed: bigint;
  timestamp: number;
  status: 'verified' | 'discrepancy' | 'pending';
}

/**
 * Parses raw input into sanitized TreasuryCheckpoint data with redacted sensitive fields.
 */
export function parseTreasuryCheckpoint(raw: RawCheckpointRecord): TreasuryCheckpoint {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid checkpoint record');
  }

  const id = String(raw.checkpointId || raw.id || 'unknown');
  const allocated = BigInt(raw.allocatedAmount ?? 0);
  const disbursed = BigInt(raw.disbursedAmount ?? 0);
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
  
  let status: 'verified' | 'discrepancy' | 'pending' = 'pending';
  if (raw.status === 'verified' || raw.status === 'discrepancy' || raw.status === 'pending') {
    status = raw.status;
  } else {
    status = allocated === disbursed ? 'verified' : 'discrepancy';
  }

  return {
    id,
    allocated,
    disbursed,
    timestamp,
    status,
  };
}

export function parseTreasuryCheckpoints(rawItems: RawCheckpointRecord[]): TreasuryCheckpoint[] {
  if (!Array.isArray(rawItems)) {
    throw new Error('Checkpoints must be an array');
  }
  return rawItems.map(parseTreasuryCheckpoint);
}
