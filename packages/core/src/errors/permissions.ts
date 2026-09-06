import { ZkPayrollError, type ErrorContext, ContractExecutionError, ContractErrorCode } from "../core/errors";

/**
 * Supported roles capable of initiating or managing batch creation in ZkPayroll.
 */
export type BatchCreatorRole =
  | "BATCH_CREATOR"
  | "PAYROLL_ADMIN"
  | "EMPLOYER"
  | "AUTHORIZED_OPERATOR"
  | "MULTISIG_SIGNER";

/**
 * Standard error codes for batch creation authorization and permission failures.
 */
export const BatchCreatorPermissionErrorCode = {
  UNAUTHORIZED_CREATOR: "BATCH_CREATOR_UNAUTHORIZED",
  ROLE_REQUIRED: "BATCH_CREATOR_ROLE_REQUIRED",
  CREATOR_SUSPENDED: "BATCH_CREATOR_SUSPENDED",
  ORGANIZATION_MISMATCH: "BATCH_CREATOR_ORG_MISMATCH",
  QUORUM_REQUIRED: "BATCH_CREATOR_QUORUM_REQUIRED",
  UNREGISTERED_OPERATOR: "BATCH_CREATOR_UNREGISTERED",
} as const;

export type BatchCreatorPermissionErrorCodeType =
  (typeof BatchCreatorPermissionErrorCode)[keyof typeof BatchCreatorPermissionErrorCode];

/**
 * Canonical user-facing remediation messages explaining who can create payroll
 * batches and actionable steps to resolve permission issues.
 *
 * NOTE: Messages are strictly privacy-safe and never include employee identifiers,
 * salary amounts, or secret keys.
 */
export const BATCH_CREATOR_PERMISSION_MESSAGES: Record<
  BatchCreatorPermissionErrorCodeType,
  string
> = {
  [BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR]:
    "The connected account is not authorized to create payroll batches. Only accounts assigned the BATCH_CREATOR or PAYROLL_ADMIN role can initiate payroll batches. Switch to an authorized wallet or request role assignment from your organization administrator.",
  [BatchCreatorPermissionErrorCode.ROLE_REQUIRED]:
    "Missing required payroll creation role. Creating a batch requires explicit BATCH_CREATOR or EMPLOYER permissions on the target contract.",
  [BatchCreatorPermissionErrorCode.CREATOR_SUSPENDED]:
    "The batch creator role for this account is currently suspended. Resolve active compliance holds or contact an administrator before creating new payroll batches.",
  [BatchCreatorPermissionErrorCode.ORGANIZATION_MISMATCH]:
    "The connected account is not authorized for the specified organization or department payroll contract. Verify your organization scope.",
  [BatchCreatorPermissionErrorCode.QUORUM_REQUIRED]:
    "Batch creation requires multi-party authorization or quorum sign-off before dispatch. Initiate a quorum session with authorized co-signers.",
  [BatchCreatorPermissionErrorCode.UNREGISTERED_OPERATOR]:
    "The caller address is not registered as an authorized payroll operator in the registry. Complete operator onboarding first.",
};

/**
 * Thrown when an unauthorized caller attempts to create or dispatch a payroll batch.
 */
export class BatchCreatorPermissionError extends ZkPayrollError {
  public readonly remediation: string;
  public readonly requiredRoles: readonly BatchCreatorRole[];
  public readonly attemptedCaller?: string;

  constructor(
    message: string,
    code: BatchCreatorPermissionErrorCodeType = BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR,
    context: ErrorContext = {},
    options?: {
      remediation?: string;
      requiredRoles?: BatchCreatorRole[];
      attemptedCaller?: string;
      cause?: unknown;
    }
  ) {
    super(message, code, context, options?.cause);
    this.name = "BatchCreatorPermissionError";
    this.remediation =
      options?.remediation ??
      BATCH_CREATOR_PERMISSION_MESSAGES[code] ??
      BATCH_CREATOR_PERMISSION_MESSAGES[BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR];
    this.requiredRoles = options?.requiredRoles ?? ["BATCH_CREATOR", "PAYROLL_ADMIN"];
    this.attemptedCaller = options?.attemptedCaller;
  }
}

/**
 * Regex patterns matching batch creator permission failures from contract reverts,
 * Soroban RPC host errors, or SDK validation layers.
 */
const BATCH_CREATOR_UNAUTHORIZED_PATTERN =
  /unauthorized.*batch.*creator|batch.*creator.*permission|only.*(batch_creator|payroll_admin|employer).*create|creator.*not.*authorized|role.*(batch_creator|payroll_admin).*required|permission.*denied.*batch|not.*authorized.*batch/i;

const BATCH_CREATOR_SUSPENDED_PATTERN =
  /creator.*suspended|batch.*creation.*suspended|operator.*suspended|creator.*inactive/i;

const BATCH_CREATOR_ORG_MISMATCH_PATTERN =
  /organization.*mismatch|org.*not.*authorized|department.*unauthorized|contract.*org.*mismatch/i;

const BATCH_CREATOR_QUORUM_PATTERN =
  /quorum.*required|insufficient.*signers.*batch|multi.*sig.*required.*batch|quorum.*threshold.*not.*met/i;

const BATCH_CREATOR_UNREGISTERED_PATTERN =
  /unregistered.*operator|operator.*not.*enrolled|operator.*not.*found|creator.*not.*registered/i;

/**
 * Checks whether an error is a batch creator permission failure.
 */
export function isBatchCreatorPermissionError(error: unknown): boolean {
  if (error instanceof BatchCreatorPermissionError) return true;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: unknown }).code);
    if (Object.values(BatchCreatorPermissionErrorCode).includes(code as BatchCreatorPermissionErrorCodeType)) {
      return true;
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  return (
    BATCH_CREATOR_UNAUTHORIZED_PATTERN.test(msg) ||
    BATCH_CREATOR_SUSPENDED_PATTERN.test(msg) ||
    BATCH_CREATOR_ORG_MISMATCH_PATTERN.test(msg) ||
    BATCH_CREATOR_QUORUM_PATTERN.test(msg) ||
    BATCH_CREATOR_UNREGISTERED_PATTERN.test(msg)
  );
}

/**
 * Detects specific permission error subtypes.
 */
export function isBatchCreatorSuspendedError(error: unknown): boolean {
  if (error instanceof BatchCreatorPermissionError) {
    return error.code === BatchCreatorPermissionErrorCode.CREATOR_SUSPENDED;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return BATCH_CREATOR_SUSPENDED_PATTERN.test(msg);
}

export function isBatchCreatorOrgMismatchError(error: unknown): boolean {
  if (error instanceof BatchCreatorPermissionError) {
    return error.code === BatchCreatorPermissionErrorCode.ORGANIZATION_MISMATCH;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return BATCH_CREATOR_ORG_MISMATCH_PATTERN.test(msg);
}

export function isBatchCreatorQuorumRequiredError(error: unknown): boolean {
  if (error instanceof BatchCreatorPermissionError) {
    return error.code === BatchCreatorPermissionErrorCode.QUORUM_REQUIRED;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return BATCH_CREATOR_QUORUM_PATTERN.test(msg);
}

export function isBatchCreatorUnregisteredError(error: unknown): boolean {
  if (error instanceof BatchCreatorPermissionError) {
    return error.code === BatchCreatorPermissionErrorCode.UNREGISTERED_OPERATOR;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return BATCH_CREATOR_UNREGISTERED_PATTERN.test(msg);
}

/**
 * Resolves appropriate remediation instructions for a batch creator error.
 */
export function getBatchCreatorRemediation(
  error: unknown,
  overrides?: Partial<Record<BatchCreatorPermissionErrorCodeType, string>>
): string {
  const messages = { ...BATCH_CREATOR_PERMISSION_MESSAGES, ...overrides };

  if (isBatchCreatorSuspendedError(error)) {
    return messages[BatchCreatorPermissionErrorCode.CREATOR_SUSPENDED];
  }
  if (isBatchCreatorOrgMismatchError(error)) {
    return messages[BatchCreatorPermissionErrorCode.ORGANIZATION_MISMATCH];
  }
  if (isBatchCreatorQuorumRequiredError(error)) {
    return messages[BatchCreatorPermissionErrorCode.QUORUM_REQUIRED];
  }
  if (isBatchCreatorUnregisteredError(error)) {
    return messages[BatchCreatorPermissionErrorCode.UNREGISTERED_OPERATOR];
  }
  if (isBatchCreatorPermissionError(error)) {
    return messages[BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR];
  }

  return "Verify that the executing address possesses an authorized batch creator or admin role before initiating payroll batches.";
}

/**
 * Maps any raw contract revert, RPC error, or validation failure to a typed
 * `BatchCreatorPermissionError` or returns the original error if unrelated.
 */
export function mapBatchCreatorPermissionError(
  error: unknown,
  context: ErrorContext = {}
): BatchCreatorPermissionError | ContractExecutionError | ZkPayrollError {
  if (error instanceof BatchCreatorPermissionError) {
    return error;
  }

  const msg = error instanceof Error ? error.message : String(error);

  // Redact any potential private values (amounts, secrets, etc.) from message
  const sanitizedMsg = msg
    .replace(/amount\s*[:=]\s*\S+/gi, "amount=[redacted]")
    .replace(/witness\s*[:=]\s*\S+/gi, "witness=[redacted]")
    .replace(/recipient\s*[:=]\s*\S+/gi, "recipient=[redacted]");

  let code: BatchCreatorPermissionErrorCodeType =
    BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR;

  if (isBatchCreatorSuspendedError(error)) {
    code = BatchCreatorPermissionErrorCode.CREATOR_SUSPENDED;
  } else if (isBatchCreatorOrgMismatchError(error)) {
    code = BatchCreatorPermissionErrorCode.ORGANIZATION_MISMATCH;
  } else if (isBatchCreatorQuorumRequiredError(error)) {
    code = BatchCreatorPermissionErrorCode.QUORUM_REQUIRED;
  } else if (isBatchCreatorUnregisteredError(error)) {
    code = BatchCreatorPermissionErrorCode.UNREGISTERED_OPERATOR;
  } else if (/role.*required/i.test(msg)) {
    code = BatchCreatorPermissionErrorCode.ROLE_REQUIRED;
  }

  if (isBatchCreatorPermissionError(error)) {
    const remediation = getBatchCreatorRemediation(error);
    const friendlyMessage = `${sanitizedMsg}. Remediation: ${remediation}`;
    return new BatchCreatorPermissionError(friendlyMessage, code, context, {
      remediation,
      requiredRoles: ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"],
      cause: error,
    });
  }

  if (error instanceof ContractExecutionError || error instanceof ZkPayrollError) {
    return error;
  }

  return new ContractExecutionError(
    sanitizedMsg,
    ContractErrorCode.UNKNOWN_RPC_ERROR,
    context,
    error
  );
}

/**
 * Formats a batch creator permission error into a clean, safe diagnostic object.
 */
export function formatBatchCreatorPermissionError(error: unknown): {
  message: string;
  code: string;
  remediation: string;
  retryable: boolean;
  requiredRoles: readonly string[];
} {
  const mapped = mapBatchCreatorPermissionError(error);
  if (mapped instanceof BatchCreatorPermissionError) {
    return {
      message: mapped.message,
      code: mapped.code,
      remediation: mapped.remediation,
      retryable: false,
      requiredRoles: mapped.requiredRoles,
    };
  }

  return {
    message: mapped.message,
    code: mapped.code,
    remediation: getBatchCreatorRemediation(error),
    retryable: false,
    requiredRoles: ["BATCH_CREATOR", "PAYROLL_ADMIN"],
  };
}
