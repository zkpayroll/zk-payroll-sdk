import {
  evaluateStalledPayrollRun,
  StalledPayrollRunState,
} from '../../src/recovery/stalledRunRecovery';

describe('Stalled Payroll Run Recovery Guidance (#696)', () => {
  const baseTime = 1700000000000;

  it('correctly reports healthy status for an active run with fresh heartbeat', () => {
    const run: StalledPayrollRunState = {
      runId: 'run-101',
      status: 'IN_PROGRESS',
      startedAt: baseTime - 60000,
      lastHeartbeatAt: baseTime - 10000, // 10s ago
      totalBatches: 5,
      completedBatches: 2,
      failedBatches: 0,
    };

    const report = evaluateStalledPayrollRun(run, {
      currentTime: baseTime,
      heartbeatTimeoutMs: 120000,
    });

    expect(report.isStalled).toBe(false);
    expect(report.diagnosisCode).toBe('HEALTHY_ACTIVE');
    expect(report.recommendedStrategy).toBe('NO_ACTION_REQUIRED');
  });

  it('identifies terminal runs and requires no action', () => {
    const run: StalledPayrollRunState = {
      runId: 'run-102',
      status: 'COMPLETED',
      startedAt: baseTime - 500000,
      totalBatches: 3,
      completedBatches: 3,
      failedBatches: 0,
    };

    const report = evaluateStalledPayrollRun(run, { currentTime: baseTime });
    expect(report.isStalled).toBe(false);
    expect(report.diagnosisCode).toBe('ALREADY_TERMINATED');
    expect(report.recommendedStrategy).toBe('NO_ACTION_REQUIRED');
  });

  it('diagnoses partially executed stalled run and recommends checkpoint resume', () => {
    const run: StalledPayrollRunState = {
      runId: 'run-103',
      status: 'IN_PROGRESS',
      startedAt: baseTime - 600000,
      lastHeartbeatAt: baseTime - 300000, // 5m ago (heartbeat expired)
      totalBatches: 10,
      completedBatches: 4,
      failedBatches: 0,
    };

    const report = evaluateStalledPayrollRun(run, {
      currentTime: baseTime,
      heartbeatTimeoutMs: 120000,
    });

    expect(report.isStalled).toBe(true);
    expect(report.diagnosisCode).toBe('PARTIAL_EXECUTION_STALLED');
    expect(report.recommendedStrategy).toBe('RESUME_FROM_CHECKPOINT');
    expect(report.canAutoResume).toBe(true);
    expect(report.resumeFromBatchIndex).toBe(4);
    expect(report.pendingBatches).toBe(6);
    expect(report.remediationSteps.length).toBeGreaterThan(0);
  });

  it('diagnoses failed batches and recommends targeted retry', () => {
    const run: StalledPayrollRunState = {
      runId: 'run-104',
      status: 'IN_PROGRESS',
      startedAt: baseTime - 60000,
      lastHeartbeatAt: baseTime - 10000,
      totalBatches: 6,
      completedBatches: 3,
      failedBatches: 2,
    };

    const report = evaluateStalledPayrollRun(run, { currentTime: baseTime });
    expect(report.isStalled).toBe(true);
    expect(report.diagnosisCode).toBe('UNPROCESSED_FAILURES');
    expect(report.recommendedStrategy).toBe('RETRY_FAILED_BATCHES');
    expect(report.canAutoResume).toBe(false);
  });

  it('diagnoses orphaned funding reservation when stalled before first batch dispatch', () => {
    const run: StalledPayrollRunState = {
      runId: 'run-105',
      status: 'PENDING',
      startedAt: baseTime - 300000,
      lastHeartbeatAt: baseTime - 250000,
      totalBatches: 4,
      completedBatches: 0,
      failedBatches: 0,
      hasActiveFundingReservation: true,
    };

    const report = evaluateStalledPayrollRun(run, {
      currentTime: baseTime,
      heartbeatTimeoutMs: 120000,
    });

    expect(report.isStalled).toBe(true);
    expect(report.diagnosisCode).toBe('FUNDING_RESERVATION_ORPHANED');
    expect(report.recommendedStrategy).toBe('REFUND_AND_ABORT');
  });

  it('handles in-flight confirmation timeout', () => {
    const run: StalledPayrollRunState = {
      runId: 'run-106',
      status: 'CONFIRMING',
      startedAt: baseTime - 400000,
      lastHeartbeatAt: baseTime - 350000, // 350s ago (exceeds 300s confirmation timeout)
      totalBatches: 2,
      completedBatches: 1,
      failedBatches: 0,
    };

    const report = evaluateStalledPayrollRun(run, {
      currentTime: baseTime,
      confirmationTimeoutMs: 300000,
    });

    expect(report.isStalled).toBe(true);
    expect(report.diagnosisCode).toBe('BATCH_CONFIRMATION_TIMEOUT');
    expect(report.recommendedStrategy).toBe('RESUME_FROM_CHECKPOINT');
  });
});
