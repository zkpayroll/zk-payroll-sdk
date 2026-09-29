import type { EmployeeRecord as BatchEmployeeRecord } from "../batch/employeeBatchSchemaValidator";
import type {
  EmployeeEligibilityRecord,
  EmployeeEligibilityResult,
  EligibilityEvaluationOptions,
} from "../eligibility/types";

export type { BatchEmployeeRecord };

/**
 * Supported payout method kinds for employee compensation distribution.
 */
export type EmployeePayoutMethodKind = "account" | "address";

/**
 * Status of a payout method confirmation.
 * - `pending`: confirmation has not been requested or is awaiting action.
 * - `confirmed`: the method is verified and may be used for payouts.
 * - `expired`: the confirmation window elapsed and must be renewed.
 * - `revoked`: the method was explicitly disabled and cannot be used.
 */
export type EmployeePayoutMethodStatus = "pending" | "confirmed" | "expired" | "revoked";

export interface EmployeePayoutMethod {
  /** Stable identifier for the payout method within an employee's profile. */
  id: string;
  /** Whether the method refers to a named account or a raw address. */
  kind: EmployeePayoutMethodKind;
  /** Asset ticker or identifier the method settles in (e.g. `XYZ`). */
  asset: string;
  /** Chain or settlement network identifier (e.g. `stellar`). */
  network?: string;
  /** Opaque payout destination (account id or address). */
  destination: string;
  /** Optional human-readable label for the method. */
  label?: string;
  /** Current confirmation status of the method. */
  status: EmployeePayoutMethodStatus;
  /** Timestamp (ms) when the method was created. */
  createdAt?: number;
  /** Timestamp (ms) when the method was last updated. */
  updatedAt?: number;
  /** Timestamp (ms) when the method was confirmed, if applicable. */
  confirmedAt?: number;
  /** Timestamp (ms) when the confirmation expires, if applicable. */
  expiresAt?: number;
  /** Opaque nonce used to bind a confirmation request to this method. */
  confirmationNonce?: string;
}

export interface EmployeePayoutMethodConfirmationRequest {
  /** Employee the payout method belongs to. */
  employeeId: string;
  /** Identifier of the payout method to confirm. */
  methodId: string;
  /** Opaque nonce issued when the confirmation was requested. */
  confirmationNonce: string;
  /** Optional expiry override in milliseconds. */
  expiresInMs?: number;
}

export interface EmployeePayoutMethodConfirmationResult {
  /** Whether the confirmation succeeded. */
  confirmed: boolean;
  /** The updated payout method when confirmation succeeds. */
  method?: EmployeePayoutMethod;
  /** Actionable error message when confirmation fails. */
  error?: string;
  /** Machine-readable error code when confirmation fails. */
  errorCode?: EmployeePayoutMethodConfirmationErrorCode;
}

export type EmployeePayoutMethodConfirmationErrorCode =
  | "employee_not_found"
  | "method_not_found"
  | "invalid_nonce"
  | "expired_nonce"
  | "already_confirmed"
  | "method_revoked";

export interface EmployeeProfile extends EmployeeEligibilityRecord {
  createdAt?: number;
  updatedAt?: number;
  /** Payout methods associated with the employee. */
  payoutMethods?: EmployeePayoutMethod[];
  /** Identifier of the default confirmed payout method, if any. */
  defaultPayoutMethodId?: string;
}

export interface EmployeeFilterOptions {
  status?: string;
  department?: string;
  asset?: string;
  eligibleOnly?: boolean;
  evaluationOptions?: EligibilityEvaluationOptions;
}

export interface EmployeeEvaluationSummary {
  employee: EmployeeProfile;
  eligibility: EmployeeEligibilityResult;
}
