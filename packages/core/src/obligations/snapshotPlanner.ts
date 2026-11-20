import { createHash } from 'node:crypto';
import { hashEmployeeReferenceId } from '../privacy/redaction';

export interface RawObligationInput {
  employeeId: string;
  amount: bigint;
  asset: string;
  destinationAddress: string;
}

export interface RedactedObligationItem {
  hashedEmployeeId: string;
  amount: string;
  asset: string;
  destinationAddress: string;
}

export interface ObligationSnapshotPlan {
  planId: string;
  snapshotHash: string;
  totalCommitment: string;
  recipientCount: number;
  items: RedactedObligationItem[];
  createdAt: number;
}

export function buildObligationSnapshotPlan(
  planId: string,
  obligations: RawObligationInput[],
  salt?: string
): ObligationSnapshotPlan {
  if (!Array.isArray(obligations) || obligations.length === 0) {
    throw new Error('Obligations list cannot be empty');
  }

  let total = 0n;
  const items: RedactedObligationItem[] = obligations.map((ob) => {
    total += ob.amount;
    return {
      hashedEmployeeId: hashEmployeeReferenceId(ob.employeeId, salt),
      amount: ob.amount.toString(),
      asset: ob.asset,
      destinationAddress: ob.destinationAddress,
    };
  });

  const canonicalPayload = JSON.stringify({
    planId,
    total: total.toString(),
    count: items.length,
    items,
  });

  const snapshotHash = createHash('sha256').update(canonicalPayload).digest('hex');

  return {
    planId,
    snapshotHash,
    totalCommitment: total.toString(),
    recipientCount: items.length,
    items,
    createdAt: Date.now(),
  };
}
