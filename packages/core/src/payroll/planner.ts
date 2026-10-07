import { buildObligationSnapshotPlan, RawObligationInput, ObligationSnapshotPlan } from '../obligations/snapshotPlanner';

export function createPayrollPlan(
  payrollBatchId: string,
  obligations: RawObligationInput[]
): ObligationSnapshotPlan {
  return buildObligationSnapshotPlan(payrollBatchId, obligations);
}
