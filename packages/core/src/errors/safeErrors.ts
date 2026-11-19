/**
 * Privacy-Preserving Safe Error Types
 *
 * Provides typed, actionable error definitions that protect sensitive payroll, salary,
 * and recipient identification data from being leaked in logs or error traces.
 */

export class SafePayrollError extends Error {
  public readonly code: string;
  public readonly remediation: string;
  public readonly timestamp: number;

  constructor(message: string, code: string, remediation: string) {
    super(message);
    this.name = 'SafePayrollError';
    this.code = code;
    this.remediation = remediation;
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      remediation: this.remediation,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Thrown when a payroll run identifier fails format or canonicalization checks.
 * Never includes raw payload arguments or sensitive employee/salary data in the message.
 */
export class InvalidRunIdentifierError extends SafePayrollError {
  constructor(reason = 'Malformed or invalid payroll run identifier.') {
    super(
      `Invalid payroll run identifier: ${reason}`,
      'ERR_INVALID_RUN_IDENTIFIER',
      'Verify that the run ID follows the canonical 32-character hex or UUID format without sensitive payload fragments.'
    );
    this.name = 'InvalidRunIdentifierError';
  }
}

/**
 * Thrown when an on-chain or off-chain payroll operation is attempted while the
 * smart contract or payroll module is in an administrative pause state.
 */
export class AdministrativePauseError extends SafePayrollError {
  constructor(module = 'PayrollModule') {
    super(
      `Payroll operations are temporarily paused by administrative control (${module}).`,
      'ERR_ADMINISTRATIVE_PAUSE',
      'Wait for the contract administrator to unpause operations before resubmitting the payroll batch.'
    );
    this.name = 'AdministrativePauseError';
  }
}

/**
 * Thrown when an already-settled receipt or duplicate settlement transaction is replayed.
 */
export class SettlementReceiptReplayError extends SafePayrollError {
  constructor(receiptHash?: string) {
    const maskedHash = receiptHash && receiptHash.length > 10
      ? `${receiptHash.slice(0, 6)}...${receiptHash.slice(-4)}`
      : 'redacted';

    super(
      `Settlement receipt replay detected for receipt ${maskedHash}.`,
      'ERR_SETTLEMENT_RECEIPT_REPLAY',
      'This settlement receipt has already been processed and finalized. Replay attempts are rejected to prevent double settlement.'
    );
    this.name = 'SettlementReceiptReplayError';
  }
}
