export interface PayrollRequestEntry {
  recipient: string;
  amount: bigint;
  asset: string;
  memo?: string;
  /**
   * Optional stable employee identifier. When supplied, `PayrollRequestBuilder`
   * rejects requests that reference the same employee more than once.
   */
  employeeId?: string;
}

export interface SubmissionContext {
  network?: string;
  contractId?: string;
  nonce?: string;
}

export interface PayrollRequest {
  entries: PayrollRequestEntry[];
  idempotencyKeys: string[];
  context: SubmissionContext;
}

export interface PayrollRequestValidationEntry {
  index: number;
  field: string;
  code: string;
  message: string;
}

export interface PayrollRequestValidationReport {
  errors: PayrollRequestValidationEntry[];
  isValid: boolean;
}

export type PayrollRequestErrorCode =
  | "EMPTY_REQUEST"
  | "INVALID_RECIPIENT"
  | "INVALID_AMOUNT"
  | "MISSING_ASSET"
  | "DUPLICATE_RECIPIENT"
  | "DUPLICATE_EMPLOYEE_ID";
