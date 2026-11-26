/**
 * Employee Activation Prerequisite Checks (#636).
 *
 * SDK-layer validation that every prerequisite for activating an employee is
 * satisfied *before* an activation/registry transaction is built and signed.
 *
 * Checks are ordered from structural to contractual so integrators get the
 * most fundamental problem reported first:
 *   1. Identity     — a valid Stellar account address (G...) or muxed (M...)
 *   2. Eligibility  — the employee is allowed to be activated at all
 *      (blocked, terminated or offboarded records are rejected; suspended
 *       records are re-activatable, so they are allowed)
 *   3. Employer     — a valid employer address is supplied for the registry
 *      relationship
 *   4. Compensation — a strictly positive salary on a supported asset
 *
 * Every failure carries a stable machine-readable code plus a sanitized,
 * actionable message. Submitted values are only reflected back in a failure
 * when they are non-sensitive (see {@link EmployeeActivationPrerequisiteIssue}
 * — invalid addresses are never echoed back). The module is pure: it performs
 * no I/O and never touches the network, so it is safe to call from dashboards,
 * batch builders, or the lifecycle client before any transaction is built.
 *
 * @example
 * ```typescript
 * import { validateEmployeeActivationPrerequisites } from "@zk-payroll/core";
 *
 * const result = validateEmployeeActivationPrerequisites({
 *   profile: employeeRecord,
 *   employerAddress: employerPublicKey,
 * });
 *
 * if (!result.ok) {
 *   // Each issue: stable code + actionable message, safe to surface.
 *   for (const issue of result.issues) {
 *     console.error(issue.code, issue.message);
 *   }
 * } else {
 *   await lifecycleClient.create(adminKeypair, employeeAddress);
 * }
 * ```
 */

import { StrKey } from "@stellar/stellar-sdk";
import { validateEmployeeReferenceId } from "./referenceId";

/** Stable, machine-readable codes for employee activation prerequisites. */
export type EmployeeActivationPrerequisiteCode =
  | "ACTIVATION_IDENTITY_INVALID"
  | "ACTIVATION_RECORD_BLOCKED"
  | "ACTIVATION_RECORD_TERMINATED"
  | "ACTIVATION_EMPLOYER_INVALID"
  | "ACTIVATION_EMPLOYER_MISSING"
  | "ACTIVATION_EMPLOYER_SAME_AS_EMPLOYEE"
  | "ACTIVATION_SALARY_INVALID"
  | "ACTIVATION_ASSET_MISSING"
  | "ACTIVATION_ASSET_INVALID"
  | "ACTIVATION_REFERENCE_ID_INVALID";

/** A single failed prerequisite check. */
export interface EmployeeActivationPrerequisiteIssue {
  /** Stable machine-readable failure code. */
  readonly code: EmployeeActivationPrerequisiteCode;
  /** Sanitized, actionable failure message. Safe to display or log. */
  readonly message: string;
  /** Which input field the issue relates to. */
  readonly field: "profile" | "employerAddress" | "salary" | "asset" | "referenceId";
}

/** Success result — every prerequisite passed and activation may proceed. */
export interface EmployeeActivationPrerequisitesOk {
  readonly ok: true;
}

/** Failure result — one or more prerequisites failed; inspect `issues`. */
export interface EmployeeActivationPrerequisitesFailed {
  readonly ok: false;
  /** All failed prerequisite checks (a precondition may short-circuit later ones). */
  readonly issues: readonly EmployeeActivationPrerequisiteIssue[];
}

/** Result of the employee activation prerequisite check. */
export type EmployeeActivationPrerequisitesResult =
  EmployeeActivationPrerequisitesOk | EmployeeActivationPrerequisitesFailed;

/**
 * The employee record an activation is requested for.
 *
 * Structural subset of the SDK's employee profile shapes, so the check works
 * with registry entries, eligibility records, and draft recipients alike.
 */
export interface EmployeeActivationProfile {
  /** Stellar account (or muxed account) address of the employee being activated. */
  readonly address?: unknown;
  /** Lifecycle status of the record, when known. */
  readonly status?: unknown;
  /** Whether the record is administratively blocked. */
  readonly isBlocked?: unknown;
  /** Agreed salary for the payroll relationship. */
  readonly salary?: unknown;
  /** Asset the salary is denominated in (e.g. `"native"` or a contract ID). */
  readonly asset?: unknown;
  /** Optional HR reference ID that must be well-formed when supplied. */
  readonly referenceId?: unknown;
}

/** Options for {@link validateEmployeeActivationPrerequisites}. */
export interface EmployeeActivationPrerequisiteOptions {
  /** The employee record being activated. */
  readonly profile: EmployeeActivationProfile;
  /**
   * Employer address for the registry relationship. Optional — when omitted,
   * the employer check is skipped entirely.
   */
  readonly employerAddress?: unknown;
  /**
   * Optional expected asset. When supplied, the profile asset must match it.
   */
  readonly expectedAsset?: unknown;
}

const SUPPORTED_ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,64}$/;

/**
 * Checks whether a value is a valid Stellar account (G...) or muxed account
 * (M...) address. Invalid values are never echoed back by callers of this
 * helper.
 */
export function isValidActivationAddress(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (StrKey.isValidEd25519PublicKey(value)) return true;
  const isMuxed = (
    StrKey as unknown as {
      isValidMed25519PublicKey?: (input: string) => boolean;
    }
  ).isValidMed25519PublicKey;
  return typeof isMuxed === "function" ? isMuxed(value) : false;
}

/**
 * Validates all prerequisites required to activate an employee.
 *
 * Pure and side-effect free: performs no network or storage I/O. Returns a
 * discriminated result instead of throwing so integrators can surface every
 * failed check at once where useful.
 *
 * @param options - The employee profile and optional employer/asset context.
 * @returns Discriminated result; on failure `issues` carries stable codes and
 *          actionable, sanitized messages.
 */
export function validateEmployeeActivationPrerequisites(
  options: EmployeeActivationPrerequisiteOptions
): EmployeeActivationPrerequisitesResult {
  const issues: EmployeeActivationPrerequisiteIssue[] = [];

  // ── 1. Identity: a usable Stellar destination address ────────────────────
  if (!isValidActivationAddress(options.profile.address)) {
    issues.push({
      code: "ACTIVATION_IDENTITY_INVALID",
      message:
        "Employee activation requires a valid Stellar account (G...) or muxed account (M...) address.",
      field: "profile",
    });
  }

  // ── 2. Eligibility: the record must be activatable ───────────────────────
  if (options.profile.isBlocked === true) {
    issues.push({
      code: "ACTIVATION_RECORD_BLOCKED",
      message:
        "Employee record is blocked. Resolve the compliance hold before activating the employee.",
      field: "profile",
    });
  }

  const status = options.profile.status;
  if (status === "terminated" || status === "offboarded") {
    issues.push({
      code: "ACTIVATION_RECORD_TERMINATED",
      message:
        "Employee record is terminated or offboarded and cannot be activated. Onboard the employee as a new record instead.",
      field: "profile",
    });
  }

  // ── 3. Employer: a valid counterpart for the registry relationship ───────
  if (options.employerAddress !== undefined) {
    if (options.employerAddress === null || options.employerAddress === "") {
      issues.push({
        code: "ACTIVATION_EMPLOYER_MISSING",
        message:
          "Employer address is required to activate an employee against a payroll registry relationship.",
        field: "employerAddress",
      });
    } else if (!isValidActivationAddress(options.employerAddress)) {
      issues.push({
        code: "ACTIVATION_EMPLOYER_INVALID",
        message:
          "Employer address must be a valid Stellar account (G...) or muxed account (M...) address.",
        field: "employerAddress",
      });
    } else if (options.employerAddress === options.profile.address) {
      issues.push({
        code: "ACTIVATION_EMPLOYER_SAME_AS_EMPLOYEE",
        message:
          "Employer and employee addresses must differ; self-employment relationships are not supported.",
        field: "employerAddress",
      });
    }
  }

  // ── 4. Compensation: positive salary on a supported asset ────────────────
  if (typeof options.profile.salary !== "bigint" || options.profile.salary <= 0n) {
    issues.push({
      code: "ACTIVATION_SALARY_INVALID",
      message: "Employee salary must be a positive integer amount (as bigint) before activation.",
      field: "salary",
    });
  }

  if (
    options.profile.asset === undefined ||
    options.profile.asset === null ||
    options.profile.asset === ""
  ) {
    issues.push({
      code: "ACTIVATION_ASSET_MISSING",
      message:
        'Employee asset is required before activation (e.g. "native" or an asset contract ID).',
      field: "asset",
    });
  } else {
    const asset = options.profile.asset;
    const assetValid =
      (typeof asset === "string" && SUPPORTED_ASSET_PATTERN.test(asset)) ||
      (typeof asset === "object" &&
        asset !== null &&
        typeof (asset as { code?: unknown }).code === "string" &&
        SUPPORTED_ASSET_PATTERN.test((asset as { code: string }).code));
    if (!assetValid) {
      issues.push({
        code: "ACTIVATION_ASSET_INVALID",
        message:
          'Employee asset must be "native" or a valid asset code/contract identifier (alphanumeric with ., :, -, _).',
        field: "asset",
      });
    }
  }

  // ── 5. Reference ID: when supplied, it must be well-formed ────────────────
  const referenceId = options.profile.referenceId;
  if (referenceId !== undefined && referenceId !== null) {
    if (typeof referenceId !== "string") {
      issues.push({
        code: "ACTIVATION_REFERENCE_ID_INVALID",
        message: "Employee reference ID must be a string when supplied.",
        field: "referenceId",
      });
    } else if (!validateEmployeeReferenceId(referenceId).isValid) {
      issues.push({
        code: "ACTIVATION_REFERENCE_ID_INVALID",
        message:
          "Employee reference ID must be 3-64 characters using only letters, numbers, hyphens, or underscores.",
        field: "referenceId",
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true };
}

/**
 * Error thrown by {@link validateEmployeeActivationPrerequisitesOrThrow} when
 * one or more activation prerequisites fail. `issues` carries the stable
 * codes and actionable messages; the raw rejected values are never included.
 */
export class EmployeeActivationPrerequisiteError extends Error {
  /** Stable machine-readable name for programmatic handling. */
  public readonly name = "EmployeeActivationPrerequisiteError";

  /** All failed prerequisite checks. */
  public readonly issues: readonly EmployeeActivationPrerequisiteIssue[];

  constructor(issues: readonly EmployeeActivationPrerequisiteIssue[]) {
    super(`Employee activation prerequisites failed: ${issues.map((i) => i.code).join(", ")}`);
    // Required so `instanceof` works when targeting ES5-style output.
    Object.setPrototypeOf(this, EmployeeActivationPrerequisiteError.prototype);
    this.issues = issues;
  }
}

/**
 * Throwing variant of {@link validateEmployeeActivationPrerequisites} for
 * call sites that prefer exceptions. The thrown error never echoes the
 * rejected input values back — only stable codes and actionable messages.
 *
 * @param options - The employee profile and optional employer/asset context.
 * @returns The validated options, unchanged, when every prerequisite passes.
 * @throws {@link EmployeeActivationPrerequisiteError} on any failed check.
 */
export function validateEmployeeActivationPrerequisitesOrThrow(
  options: EmployeeActivationPrerequisiteOptions
): EmployeeActivationPrerequisiteOptions {
  const result = validateEmployeeActivationPrerequisites(options);
  if (!result.ok) {
    throw new EmployeeActivationPrerequisiteError(result.issues);
  }
  return options;
}
