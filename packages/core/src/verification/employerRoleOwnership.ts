import { ZkPayrollError, type ErrorContext } from "../core/errors";

export const DEFAULT_EMPLOYER_OWNERSHIP_TTL_MS = 30_000;

export const EmployerRoleOwnershipErrorCode = {
  CALLER_ADDRESS_INVALID: "CALLER_ADDRESS_INVALID",
  COMPANY_ID_REQUIRED: "COMPANY_ID_REQUIRED",
  ROLE_PROVIDER_FAILED: "ROLE_PROVIDER_FAILED",
  COMPANY_INACTIVE: "COMPANY_INACTIVE",
  EMPLOYER_ROLE_TRANSFERRED: "EMPLOYER_ROLE_TRANSFERRED",
  EMPLOYER_ROLE_REVOKED: "EMPLOYER_ROLE_REVOKED",
  ROLE_SNAPSHOT_STALE: "ROLE_SNAPSHOT_STALE",
} as const;

export type EmployerRoleOwnershipErrorCodeType =
  (typeof EmployerRoleOwnershipErrorCode)[keyof typeof EmployerRoleOwnershipErrorCode];

export interface LiveEmployerRoleRecord {
  readonly companyId: string;
  /** Active employer admin Stellar public key recorded on-chain. */
  readonly employerAdmin: string;
  /** Whether the company registry entry is active. */
  readonly isActive: boolean;
  /** Whether the caller or employer role is currently granted for payroll submission. */
  readonly hasEmployerRole?: boolean;
  /** ISO-8601 timestamp or epoch ms when the live state was fetched. */
  readonly fetchedAt: string | number;
  /** Optional ledger sequence from which the role ownership was read. */
  readonly ledgerSequence?: number;
}

export interface VerifyEmployerRoleOwnershipOptions {
  readonly companyId: string;
  readonly callerAddress: string;
  readonly cachedEmployerAdmin?: string | null;
  readonly liveRecord: LiveEmployerRoleRecord | null | undefined;
  readonly now?: Date;
  readonly maxStalenessMs?: number;
  readonly throwOnFailure?: boolean;
}

export interface RefreshEmployerRoleOwnershipOptions {
  readonly companyId: string;
  readonly callerAddress: string;
  readonly cachedEmployerAdmin?: string | null;
  readonly fetchLiveEmployerRole: (
    companyId: string
  ) => Promise<LiveEmployerRoleRecord | null | undefined>;
  readonly now?: Date;
  readonly maxStalenessMs?: number;
  readonly throwOnFailure?: boolean;
}

export interface EmployerRoleOwnershipVerificationResult {
  readonly valid: boolean;
  readonly code: EmployerRoleOwnershipErrorCodeType | null;
  readonly message: string;
  readonly companyId: string;
  readonly maskedCaller: string;
  readonly maskedActiveEmployer: string | null;
  readonly ownershipTransferred: boolean;
  readonly ledgerSequence: number | null;
  readonly verifiedAt: string;
}

export class EmployerRoleOwnershipError extends ZkPayrollError {
  public readonly ownershipCode: EmployerRoleOwnershipErrorCodeType;

  constructor(
    message: string,
    ownershipCode: EmployerRoleOwnershipErrorCodeType,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, ownershipCode, context, cause);
    this.name = "EmployerRoleOwnershipError";
    this.ownershipCode = ownershipCode;
  }
}

function isValidStellarPublicKey(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address);
}

/**
 * Masks a Stellar public key so diagnostic messages never leak full wallet addresses (#851).
 */
export function maskEmployerAddress(address: string | null | undefined): string {
  const trimmed = (address ?? "").trim();
  if (!trimmed) return "unconfigured";
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function parseTimestampMs(value: string | number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  return Date.parse(value);
}

function finalizeResult(
  result: EmployerRoleOwnershipVerificationResult,
  throwOnFailure?: boolean,
  cause?: unknown
): EmployerRoleOwnershipVerificationResult {
  const frozen = Object.freeze(result);
  if (!frozen.valid && throwOnFailure && frozen.code) {
    throw new EmployerRoleOwnershipError(
      frozen.message,
      frozen.code,
      {
        companyId: frozen.companyId,
        maskedCaller: frozen.maskedCaller,
        maskedActiveEmployer: frozen.maskedActiveEmployer,
        ownershipTransferred: frozen.ownershipTransferred,
        ledgerSequence: frozen.ledgerSequence,
      },
      cause
    );
  }
  return frozen;
}

/**
 * Validates a refreshed employer role ownership snapshot against the submitting
 * caller wallet before payroll execution (#851).
 */
export function verifyEmployerRoleOwnershipSnapshot(
  options: VerifyEmployerRoleOwnershipOptions
): EmployerRoleOwnershipVerificationResult {
  const {
    companyId,
    callerAddress,
    cachedEmployerAdmin,
    liveRecord,
    now = new Date(),
    maxStalenessMs = DEFAULT_EMPLOYER_OWNERSHIP_TTL_MS,
    throwOnFailure = false,
  } = options;

  const trimmedCompanyId = (companyId ?? "").trim();
  const trimmedCaller = (callerAddress ?? "").trim();
  const maskedCaller = maskEmployerAddress(trimmedCaller);
  const verifiedAt = now.toISOString();

  if (!trimmedCompanyId) {
    return finalizeResult(
      {
        valid: false,
        code: EmployerRoleOwnershipErrorCode.COMPANY_ID_REQUIRED,
        message: "A non-empty companyId is required to verify employer role ownership.",
        companyId: "",
        maskedCaller,
        maskedActiveEmployer: null,
        ownershipTransferred: false,
        ledgerSequence: null,
        verifiedAt,
      },
      throwOnFailure
    );
  }

  if (!isValidStellarPublicKey(trimmedCaller)) {
    return finalizeResult(
      {
        valid: false,
        code: EmployerRoleOwnershipErrorCode.CALLER_ADDRESS_INVALID,
        message: `Submitting caller address (${maskedCaller}) is not a valid Stellar public key.`,
        companyId: trimmedCompanyId,
        maskedCaller,
        maskedActiveEmployer: null,
        ownershipTransferred: false,
        ledgerSequence: null,
        verifiedAt,
      },
      throwOnFailure
    );
  }

  if (!liveRecord || typeof liveRecord !== "object") {
    return finalizeResult(
      {
        valid: false,
        code: EmployerRoleOwnershipErrorCode.ROLE_PROVIDER_FAILED,
        message: `Could not verify live employer role ownership for company ${trimmedCompanyId}. Refresh role state and retry.`,
        companyId: trimmedCompanyId,
        maskedCaller,
        maskedActiveEmployer: null,
        ownershipTransferred: false,
        ledgerSequence: null,
        verifiedAt,
      },
      throwOnFailure
    );
  }

  const activeEmployer = (liveRecord.employerAdmin ?? "").trim();
  const maskedActiveEmployer = maskEmployerAddress(activeEmployer);
  const ownershipTransferred = Boolean(
    (cachedEmployerAdmin && cachedEmployerAdmin.trim() !== activeEmployer) ||
      (activeEmployer && activeEmployer !== trimmedCaller)
  );
  const ledgerSequence =
    typeof liveRecord.ledgerSequence === "number" &&
    Number.isInteger(liveRecord.ledgerSequence)
      ? liveRecord.ledgerSequence
      : null;

  const fetchedMs = parseTimestampMs(liveRecord.fetchedAt);
  if (
    Number.isNaN(fetchedMs) ||
    now.getTime() - fetchedMs > Math.max(0, maxStalenessMs)
  ) {
    return finalizeResult(
      {
        valid: false,
        code: EmployerRoleOwnershipErrorCode.ROLE_SNAPSHOT_STALE,
        message: `Employer role snapshot for company ${trimmedCompanyId} is stale. Refresh on-chain ownership before submitting payroll.`,
        companyId: trimmedCompanyId,
        maskedCaller,
        maskedActiveEmployer,
        ownershipTransferred,
        ledgerSequence,
        verifiedAt,
      },
      throwOnFailure
    );
  }

  if (!liveRecord.isActive) {
    return finalizeResult(
      {
        valid: false,
        code: EmployerRoleOwnershipErrorCode.COMPANY_INACTIVE,
        message: `Company ${trimmedCompanyId} is inactive on-chain and cannot submit payroll.`,
        companyId: trimmedCompanyId,
        maskedCaller,
        maskedActiveEmployer,
        ownershipTransferred,
        ledgerSequence,
        verifiedAt,
      },
      throwOnFailure
    );
  }

  if (liveRecord.hasEmployerRole === false) {
    return finalizeResult(
      {
        valid: false,
        code: EmployerRoleOwnershipErrorCode.EMPLOYER_ROLE_REVOKED,
        message: `Employer submission role for ${maskedCaller} on company ${trimmedCompanyId} has been revoked.`,
        companyId: trimmedCompanyId,
        maskedCaller,
        maskedActiveEmployer,
        ownershipTransferred,
        ledgerSequence,
        verifiedAt,
      },
      throwOnFailure
    );
  }

  if (!isValidStellarPublicKey(activeEmployer) || activeEmployer !== trimmedCaller) {
    return finalizeResult(
      {
        valid: false,
        code: EmployerRoleOwnershipErrorCode.EMPLOYER_ROLE_TRANSFERRED,
        message: `Employer role ownership for company ${trimmedCompanyId} belongs to ${maskedActiveEmployer}, not caller ${maskedCaller}.`,
        companyId: trimmedCompanyId,
        maskedCaller,
        maskedActiveEmployer,
        ownershipTransferred: true,
        ledgerSequence,
        verifiedAt,
      },
      throwOnFailure
    );
  }

  return finalizeResult(
    {
      valid: true,
      code: null,
      message: `Verified live employer role ownership for ${maskedCaller} on company ${trimmedCompanyId}.`,
      companyId: trimmedCompanyId,
      maskedCaller,
      maskedActiveEmployer,
      ownershipTransferred: false,
      ledgerSequence,
      verifiedAt,
    },
    throwOnFailure
  );
}

/**
 * Refreshes live on-chain employer role ownership immediately before payroll
 * submission so stale cached permissions cannot submit unauthorized transactions (#851).
 */
export async function refreshEmployerRoleOwnershipBeforeSubmission(
  options: RefreshEmployerRoleOwnershipOptions
): Promise<EmployerRoleOwnershipVerificationResult> {
  const {
    companyId,
    callerAddress,
    cachedEmployerAdmin,
    fetchLiveEmployerRole,
    now = new Date(),
    maxStalenessMs = DEFAULT_EMPLOYER_OWNERSHIP_TTL_MS,
    throwOnFailure = false,
  } = options;

  const trimmedCompanyId = (companyId ?? "").trim();
  const maskedCaller = maskEmployerAddress(callerAddress);

  if (!trimmedCompanyId || !/^G[A-Z2-7]{55}$/.test((callerAddress ?? "").trim())) {
    return verifyEmployerRoleOwnershipSnapshot({
      companyId,
      callerAddress,
      cachedEmployerAdmin,
      liveRecord: null,
      now,
      maxStalenessMs,
      throwOnFailure,
    });
  }

  try {
    const liveRecord = await fetchLiveEmployerRole(trimmedCompanyId);
    return verifyEmployerRoleOwnershipSnapshot({
      companyId: trimmedCompanyId,
      callerAddress,
      cachedEmployerAdmin,
      liveRecord,
      now,
      maxStalenessMs,
      throwOnFailure,
    });
  } catch (err) {
    if (err instanceof EmployerRoleOwnershipError) {
      throw err;
    }
    return finalizeResult(
      {
        valid: false,
        code: EmployerRoleOwnershipErrorCode.ROLE_PROVIDER_FAILED,
        message: `Failed to refresh live employer role ownership for company ${trimmedCompanyId}. Retry before submitting payroll.`,
        companyId: trimmedCompanyId,
        maskedCaller,
        maskedActiveEmployer: null,
        ownershipTransferred: false,
        ledgerSequence: null,
        verifiedAt: now.toISOString(),
      },
      throwOnFailure,
      err
    );
  }
}
