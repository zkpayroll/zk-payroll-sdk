import { buildObligationSnapshotPlan } from './snapshotPlanner';

describe('Payroll Obligation Snapshot Planner (#403)', () => {
  const obligations = [
    { employeeId: 'EMP-001', amount: 10000n, asset: 'USDC', destinationAddress: 'GAAA...' },
    { employeeId: 'EMP-002', amount: 20000n, asset: 'USDC', destinationAddress: 'GBBB...' },
  ];

  it('builds a deterministic obligation snapshot plan with hashed employee refs', () => {
    const plan1 = buildObligationSnapshotPlan('plan-1', obligations, 'salt-key');
    const plan2 = buildObligationSnapshotPlan('plan-1', obligations, 'salt-key');

    expect(plan1.snapshotHash).toBe(plan2.snapshotHash);
    expect(plan1.totalCommitment).toBe('30000');
    expect(plan1.recipientCount).toBe(2);
    expect(plan1.items[0].hashedEmployeeId).not.toBe('EMP-001');
    expect(plan1.items[0].hashedEmployeeId.length).toBe(16);
  });

  it('throws error when obligations list is empty', () => {
    expect(() => buildObligationSnapshotPlan('plan-2', [])).toThrow('Obligations list cannot be empty');
  });
});
