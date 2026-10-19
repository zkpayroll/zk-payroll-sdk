/**
 * Stalled payroll run recovery guidance for ZK Payroll SDK.
 *
 * Diagnoses stalled or interrupted payroll execution states and generates
 * actionable recovery plans to resume, retry, or safely abort runs.
 */

export type PayrollRunExecutionStatus =
  | 'INITIALIZING'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'CONFIRMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type StalledRunDiagnosisCode =
  | 'HEALTHY_ACTIVE'
  | 'ALREADY_TERMINATED'
  | 'HEARTBEAT_EXPIRED'
  | 'BATCH_CONFIRMATION_TIMEOUT'
  | 'PARTIAL_EXECUTION_STALLED'
  | 'UNPROCESSED_FAILURES'
  | 'FUNDING_RESERVATION_ORPHANED';

export type RecoveryStrategy =
  | 'NO_ACTION_REQUIRED'
  | 'WAIT_FOR_CONFIRMATION'
  | 'RESUME_FROM_CHECKPOINT'
  | 'RETRY_FAILED_BATCHES'
  | 'REFUND_AND_ABORT'
  | 'MANUAL_INSPECTION';

export interface StalledPayrollRunState {
  runId: string;
  status: PayrollRunExecutionStatus;
  startedAt: string | number;
  lastHeartbeatAt?: string | number;
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  totalEmployees?: number;
  processedEmployees?: number;
  hasActiveFundingReservation?: boolean;
  lastBatchIndex?: number;
  errorMessage?: string;
}

export interface StalledRunDiagnosisOptions {
  /** Inactivity threshold in milliseconds to consider heartbeat expired. Default: 120000 (2m) */
  heartbeatTimeoutMs?: number;
  /** Timeout for confirming on-chain batches in milliseconds. Default: 300000 (5m) */
  confirmationTimeoutMs?: number;
  /** Current time override for deterministic testing */
  currentTime?: string | number;
}

export interface StalledRunRecoveryReport {
  runId: string;
  isStalled: boolean;
  diagnosisCode: StalledRunDiagnosisCode;
  diagnosisDetails: string;
  recommendedStrategy: RecoveryStrategy;
  canAutoResume: boolean;
  resumeFromBatchIndex?: number;
  pendingBatches: number;
  remediationSteps: string[];
  suggestedAction: string;
}

/**
 * Diagnoses a payroll run state and returns actionable recovery guidance.
 */
export function evaluateStalledPayrollRun(
  run: StalledPayrollRunState,
  options: StalledRunDiagnosisOptions = {}
): StalledRunRecoveryReport {
  const now = options.currentTime
    ? typeof options.currentTime === 'number'
      ? options.currentTime
      : new Date(options.currentTime).getTime()
    : Date.now();

  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 120000;
  const confirmationTimeoutMs = options.confirmationTimeoutMs ?? 300000;

  const startedTime = typeof run.startedAt === 'number' ? run.startedAt : new Date(run.startedAt).getTime();
  const heartbeatTime = run.lastHeartbeatAt
    ? typeof run.lastHeartbeatAt === 'number'
      ? run.lastHeartbeatAt
      : new Date(run.lastHeartbeatAt).getTime()
    : startedTime;

  const timeSinceHeartbeat = now - heartbeatTime;
  const pendingBatches = Math.max(0, run.totalBatches - run.completedBatches - run.failedBatches);

  // 1. Terminal states
  if (run.status === 'COMPLETED' || run.status === 'CANCELLED') {
    return {
      runId: run.runId,
      isStalled: false,
      diagnosisCode: 'ALREADY_TERMINATED',
      diagnosisDetails: `Payroll run is in terminal status "${run.status}".`,
      recommendedStrategy: 'NO_ACTION_REQUIRED',
      canAutoResume: false,
      pendingBatches: 0,
      remediationSteps: ['No remediation needed. Run is already terminated.'],
      suggestedAction: 'Archive run or review completed audit records.',
    };
  }

  // 2. Actively confirming within confirmation timeout
  if (run.status === 'CONFIRMING' && timeSinceHeartbeat < confirmationTimeoutMs) {
    return {
      runId: run.runId,
      isStalled: false,
      diagnosisCode: 'HEALTHY_ACTIVE',
      diagnosisDetails: 'Transaction batch is awaiting ledger confirmation within timeout window.',
      recommendedStrategy: 'WAIT_FOR_CONFIRMATION',
      canAutoResume: false,
      pendingBatches,
      remediationSteps: [
        'Allow current Soroban transaction envelope to settle.',
        'Monitor ledger sequence progression via TransactionWatcher.',
      ],
      suggestedAction: 'Wait for ledger confirmation before triggering retry.',
    };
  }

  // 3. Batch confirmation timed out
  if (run.status === 'CONFIRMING' && timeSinceHeartbeat >= confirmationTimeoutMs) {
    return {
      runId: run.runId,
      isStalled: true,
      diagnosisCode: 'BATCH_CONFIRMATION_TIMEOUT',
      diagnosisDetails: `Batch confirmation timed out after ${Math.round(timeSinceHeartbeat / 1000)}s without on-chain finality.`,
      recommendedStrategy: 'RESUME_FROM_CHECKPOINT',
      canAutoResume: true,
      resumeFromBatchIndex: run.completedBatches,
      pendingBatches,
      remediationSteps: [
        `Query transaction hash on Soroban RPC to confirm status.`,
        `If reverted or dropped, resume execution from batch index ${run.completedBatches}.`,
        'Verify employee idempotency keys prevent duplicate payouts.',
      ],
      suggestedAction: `Resume execution at batch index ${run.completedBatches}.`,
    };
  }

  // 4. Failed batches with partial completion
  if (run.failedBatches > 0) {
    return {
      runId: run.runId,
      isStalled: true,
      diagnosisCode: 'UNPROCESSED_FAILURES',
      diagnosisDetails: `Payroll run has ${run.failedBatches} failed batch(es) and ${run.completedBatches} completed batch(es).`,
      recommendedStrategy: 'RETRY_FAILED_BATCHES',
      canAutoResume: false,
      resumeFromBatchIndex: run.completedBatches,
      pendingBatches,
      remediationSteps: [
        'Inspect batch failure logs for recipient address or insufficient balance errors.',
        'Re-simulate failed batch items with updated fee or gas estimates.',
        'Retry remaining batches using retryFailedBatches().',
      ],
      suggestedAction: 'Address batch validation failure reasons and trigger targeted retry.',
    };
  }

  // 5. In-progress run with heartbeat expired
  if (timeSinceHeartbeat >= heartbeatTimeoutMs) {
    if (run.completedBatches > 0 && pendingBatches > 0) {
      return {
        runId: run.runId,
        isStalled: true,
        diagnosisCode: 'PARTIAL_EXECUTION_STALLED',
        diagnosisDetails: `Execution worker heartbeat expired ${Math.round(timeSinceHeartbeat / 1000)}s ago with ${pendingBatches} pending batches remaining.`,
        recommendedStrategy: 'RESUME_FROM_CHECKPOINT',
        canAutoResume: true,
        resumeFromBatchIndex: run.completedBatches,
        pendingBatches,
        remediationSteps: [
          `Resume payroll dispatch from checkpoint index ${run.completedBatches}.`,
          'Verify that already-settled employee payouts are not duplicated.',
          'Check worker resource allocation to prevent future heartbeat timeouts.',
        ],
        suggestedAction: `Resume payroll execution from checkpoint batch index ${run.completedBatches}.`,
      };
    }

    if (run.completedBatches === 0 && run.hasActiveFundingReservation) {
      return {
        runId: run.runId,
        isStalled: true,
        diagnosisCode: 'FUNDING_RESERVATION_ORPHANED',
        diagnosisDetails: 'Run stalled prior to any batch dispatch while treasury reservation remains held.',
        recommendedStrategy: 'REFUND_AND_ABORT',
        canAutoResume: false,
        pendingBatches: run.totalBatches,
        remediationSteps: [
          'Call releaseTreasuryReservation() to unlock held funds.',
          'Mark payroll run as CANCELLED in database.',
          'Notify payroll administrator of cancelled run.',
        ],
        suggestedAction: 'Release held treasury reservation and reset run status.',
      };
    }

    return {
      runId: run.runId,
      isStalled: true,
      diagnosisCode: 'HEARTBEAT_EXPIRED',
      diagnosisDetails: `Execution process lost heartbeat ${Math.round(timeSinceHeartbeat / 1000)}s ago.`,
      recommendedStrategy: 'RESUME_FROM_CHECKPOINT',
      canAutoResume: true,
      resumeFromBatchIndex: run.completedBatches,
      pendingBatches,
      remediationSteps: [
        'Restart payroll worker process.',
        `Resume payroll dispatch from batch index ${run.completedBatches}.`,
      ],
      suggestedAction: 'Restart worker and resume run.',
    };
  }

  // 6. Healthy run in progress
  return {
    runId: run.runId,
    isStalled: false,
    diagnosisCode: 'HEALTHY_ACTIVE',
    diagnosisDetails: 'Payroll run is actively progressing within normal execution parameters.',
    recommendedStrategy: 'NO_ACTION_REQUIRED',
    canAutoResume: false,
    pendingBatches,
    remediationSteps: ['Continue monitoring progress stream.'],
    suggestedAction: 'No intervention required.',
  };
}
