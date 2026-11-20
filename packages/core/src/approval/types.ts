/**
 * Typed payloads for payroll approval requests.
 *
 * All identifiers are treated as sensitive and are never echoed back
 * in validation errors without masking.
 */
export interface PayrollApprovalRequest {
  readonly approvalId: string;
  readonly payrollRunId: string;
  readonly approverId: string;
  readonly recipientId: string;
  readonly amount: bigint;
  readonly asset: string;
  readonly memo?: string;
  readonly expiresAt: number; // Unix timestamp in milliseconds
  readonly metadata?: Record<string, string>;
}

export interface ApprovalValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly field?: keyof PayrollApprovalRequest;
}

export interface ApprovalValidationResult {
  readonly ok: boolean;
  readonly errors: ApprovalValidationIssue[];
  readonly warnings: ApprovalValidationIssue[];
}
