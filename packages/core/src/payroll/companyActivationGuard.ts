/**
 * Company Activation State Guard (#752)
 *
 * Reads and validates the activation state of a company (employer) before
 * treasury funds may be reserved. Prevents fund reservations for companies
 * that are not yet activated, have been suspended, or are otherwise blocked,
 * so operators get an actionable error before any ledger transaction is built.
 *
 * ## Privacy & Security Guarantees
 * - Employer addresses are masked in human-readable summaries.
 * - No salary amounts, employee data, or treasury balances appear in
 *   activation states or error messages.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Lifecycle states for a company's platform activation.
 */
export type CompanyActivationStatus =
  "active" | "pending_activation" | "suspended" | "deactivated" | "unknown";

/**
 * Reason codes explaining why a company cannot reserve funds.
 */
export type CompanyActivationBlockReason =
  | "COMPANY_NOT_ACTIVATED"
  | "COMPANY_PENDING_ACTIVATION"
  | "COMPANY_SUSPENDED"
  | "COMPANY_DEACTIVATED"
  | "COMPANY_STATE_UNKNOWN"
  | "none";

/**
 * Normalized company activation state, safe for dashboards and logs.
 */
export interface CompanyActivationState {
  /** Employer / company Stellar address. */
  company: string;
  /** Masked company address safe for display. */
  redactedCompany: string;
  /** Current activation lifecycle status. */
  status: CompanyActivationStatus;
  /** Whether the company is allowed to reserve funds right now. */
  canReserveFunds: boolean;
  /** Whether the company is allowed to submit payroll right now (#995). */
  canSubmitPayroll: boolean;
  /** Block reason when `canReserveFunds` or `canSubmitPayroll` is false; `"none"` otherwise. */
  blockReason: CompanyActivationBlockReason;
  /** Unix timestamp (ms) when activation was established, if recorded. */
  activatedAt?: number;
  /** Unix timestamp (ms) when the state was fetched or evaluated. */
  fetchedAt: number;
  /** Optional sanitized diagnostic metadata (never contains payroll data). */
  metadata?: Record<string, unknown>;
}

/**
 * Input describing a company's activation facts as read from the contract
 * or an off-chain registry. Used for offline evaluation without a live RPC.
 */
export interface CompanyActivationInput {
  /** Employer / company address. */
  company: string;
  /**
   * Raw status string as returned by the contract or registry. Normalized
   * into a {@link CompanyActivationStatus} via {@link normalizeActivationStatus}.
   */
  rawStatus?: string;
  /** Whether the contract explicitly marks the company as activated. */
  isActivated?: boolean;
  /** Unix timestamp (ms) of activation, when recorded. */
  activatedAt?: number;
  /** Unix timestamp (ms) of deactivation or suspension, when recorded. */
  suspendedAt?: number;
}

/**
 * Configuration options for evaluating activation state.
 */
export interface CompanyActivationCheckOptions {
  /**
   * Statuses that permit fund reservation. Defaults to `["active"]`.
   */
  allowedStatuses?: CompanyActivationStatus[];
  /**
   * Whether to require an explicit `isActivated === true` flag in addition
   * to the status. Defaults to false (status alone is sufficient).
   */
  requireExplicitActivation?: boolean;
  /** Injectable clock for deterministic testing (ms epoch). */
  now?: () => number;
}

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * Map an arbitrary raw status string into a known
 * {@link CompanyActivationStatus}. Unrecognized values map to `"unknown"`.
 */
export function normalizeActivationStatus(raw: string | undefined | null): CompanyActivationStatus {
  if (!raw) return "unknown";
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "active":
    case "activated":
    case "enabled":
      return "active";
    case "pending":
    case "pending_activation":
    case "onboarding":
      return "pending_activation";
    case "suspended":
    case "paused":
      return "suspended";
    case "deactivated":
    case "disabled":
    case "closed":
      return "deactivated";
    default:
      return "unknown";
  }
}

/** Mask a Stellar address for safe display (first 4 + last 4 characters). */
function maskAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * Derive the block reason from a status.
 */
function blockReasonForStatus(status: CompanyActivationStatus): CompanyActivationBlockReason {
  switch (status) {
    case "active":
      return "none";
    case "pending_activation":
      return "COMPANY_PENDING_ACTIVATION";
    case "suspended":
      return "COMPANY_SUSPENDED";
    case "deactivated":
      return "COMPANY_DEACTIVATED";
    default:
      return "COMPANY_STATE_UNKNOWN";
  }
}

// ── Evaluation ────────────────────────────────────────────────────────────────

/**
 * Evaluate a company's activation state from structured input.
 *
 * Pure function — does not perform I/O. Use this when you already hold
 * activation facts (from a contract read, cache, or test fixture).
 *
 * @param input - Activation facts for the company
 * @param options - Evaluation options
 * @returns Normalized activation state including reservation eligibility
 *
 * @example
 * ```ts
 * const state = evaluateCompanyActivation({
 *   company: "GABC…",
 *   rawStatus: "active",
 * });
 * state.canReserveFunds; // true
 * ```
 */
export function evaluateCompanyActivation(
  input: CompanyActivationInput,
  options: CompanyActivationCheckOptions = {}
): CompanyActivationState {
  const {
    allowedStatuses = ["active"],
    requireExplicitActivation = false,
    now = () => Date.now(),
  } = options;

  const status = normalizeActivationStatus(input.rawStatus);
  const explicitOk = requireExplicitActivation ? input.isActivated === true : true;
  const statusOk = allowedStatuses.includes(status);
  const canReserveFunds = statusOk && explicitOk;
  const canSubmitPayroll = statusOk && explicitOk;

  let blockReason: CompanyActivationBlockReason = "none";
  if (!statusOk) {
    blockReason = blockReasonForStatus(status);
  } else if (!explicitOk) {
    blockReason = "COMPANY_NOT_ACTIVATED";
  }

  return {
    company: input.company,
    redactedCompany: maskAddress(input.company),
    status,
    canReserveFunds,
    canSubmitPayroll,
    blockReason,
    activatedAt: input.activatedAt,
    fetchedAt: now(),
  };
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Error codes for company activation guard failures.
 */
export type CompanyActivationErrorCode =
  | "COMPANY_NOT_ACTIVATED"
  | "COMPANY_PENDING_ACTIVATION"
  | "COMPANY_SUSPENDED"
  | "COMPANY_DEACTIVATED"
  | "COMPANY_STATE_UNKNOWN";

const BLOCK_TO_ERROR: Record<string, CompanyActivationErrorCode> = {
  COMPANY_NOT_ACTIVATED: "COMPANY_NOT_ACTIVATED",
  COMPANY_PENDING_ACTIVATION: "COMPANY_PENDING_ACTIVATION",
  COMPANY_SUSPENDED: "COMPANY_SUSPENDED",
  COMPANY_DEACTIVATED: "COMPANY_DEACTIVATED",
  COMPANY_STATE_UNKNOWN: "COMPANY_STATE_UNKNOWN",
};

/**
 * Exception thrown when a fund reservation is attempted for a company that
 * is not in an activated state. The message is privacy-safe and actionable.
 */
export class CompanyNotActivatedError extends Error {
  public readonly code: CompanyActivationErrorCode;
  public readonly state: CompanyActivationState;

  constructor(state: CompanyActivationState) {
    const code =
      BLOCK_TO_ERROR[state.blockReason] ?? ("COMPANY_STATE_UNKNOWN" as CompanyActivationErrorCode);
    super(
      `Cannot reserve funds: company ${state.redactedCompany} is not activated (status: ${state.status}). ` +
        `Complete company activation before reserving treasury funds.`
    );
    this.name = "CompanyNotActivatedError";
    this.code = code;
    this.state = state;
  }
}

// ── Guard ─────────────────────────────────────────────────────────────────────

/**
 * Assert that a company is activated and allowed to reserve funds.
 *
 * @param state - A {@link CompanyActivationState} from {@link evaluateCompanyActivation}
 * @throws {CompanyNotActivatedError} when the company cannot reserve funds
 *
 * @example
 * ```ts
 * const state = evaluateCompanyActivation({ company, rawStatus: "active" });
 * assertCompanyCanReserveFunds(state); // passes
 * ```
 */
export function assertCompanyCanReserveFunds(state: CompanyActivationState): void {
  if (!state.canReserveFunds) {
    throw new CompanyNotActivatedError(state);
  }
}

/**
 * Convenience guard: evaluate activation from input and assert in one call.
 * Returns the activation state when the company is allowed to reserve funds.
 *
 * @throws {CompanyNotActivatedError} when the company cannot reserve funds
 */
export function guardFundReservation(
  input: CompanyActivationInput,
  options: CompanyActivationCheckOptions = {}
): CompanyActivationState {
  const state = evaluateCompanyActivation(input, options);
  assertCompanyCanReserveFunds(state);
  return state;
}

// ── Payroll Submission Guards (#995) ──────────────────────────────────────────

/**
 * Exception thrown when payroll submission is attempted for a company that
 * is not in an activated state (#995). The message is privacy-safe and actionable.
 */
export class PayrollSubmissionCompanyNotActivatedError extends Error {
  public readonly code: CompanyActivationErrorCode;
  public readonly state: CompanyActivationState;

  constructor(state: CompanyActivationState) {
    const code =
      BLOCK_TO_ERROR[state.blockReason] ?? ("COMPANY_STATE_UNKNOWN" as CompanyActivationErrorCode);
    super(
      `Cannot submit payroll: company ${state.redactedCompany} is not activated (status: ${state.status}). ` +
        `Complete company activation before submitting payroll.`
    );
    this.name = "PayrollSubmissionCompanyNotActivatedError";
    this.code = code;
    this.state = state;
  }
}

/**
 * Assert that a company is activated and allowed to submit payroll (#995).
 *
 * @param state - A {@link CompanyActivationState} from {@link evaluateCompanyActivation}
 * @throws {PayrollSubmissionCompanyNotActivatedError} when the company cannot submit payroll
 *
 * @example
 * ```ts
 * const state = evaluateCompanyActivation({ company, rawStatus: "active" });
 * assertCompanyCanSubmitPayroll(state); // passes
 * ```
 */
export function assertCompanyCanSubmitPayroll(state: CompanyActivationState): void {
  if (!state.canSubmitPayroll) {
    throw new PayrollSubmissionCompanyNotActivatedError(state);
  }
}

/**
 * Convenience guard: evaluate activation from input and assert company can submit payroll (#995).
 * Returns the activation state when the company is allowed to submit payroll.
 *
 * @throws {PayrollSubmissionCompanyNotActivatedError} when the company cannot submit payroll
 */
export function guardPayrollSubmission(
  input: CompanyActivationInput,
  options: CompanyActivationCheckOptions = {}
): CompanyActivationState {
  const state = evaluateCompanyActivation(input, options);
  assertCompanyCanSubmitPayroll(state);
  return state;
}

/**
 * Non-throwing helper: validates whether a company can submit payroll (#995).
 */
export function validateCompanyActivationForSubmission(
  input: CompanyActivationInput,
  options: CompanyActivationCheckOptions = {}
): { canSubmit: boolean; error?: string; state: CompanyActivationState } {
  const state = evaluateCompanyActivation(input, options);
  if (!state.canSubmitPayroll) {
    return {
      canSubmit: false,
      error: `Company ${state.redactedCompany} is not activated (status: ${state.status}). Complete company activation before submitting payroll.`,
      state,
    };
  }
  return {
    canSubmit: true,
    state,
  };
}

