/**
 * SDK payroll policy evaluator.
 *
 * Evaluates a payroll request against configurable, reusable rules *before*
 * transaction construction. The four built-in policies cover the checks every
 * integrator otherwise re-implements:
 *
 * - **Amount** — per-payment minimum/maximum, aggregate run maximum, and
 *   near-limit advisories.
 * - **Employee status** — blocked/locked accounts, status allowlists, and
 *   compliance state.
 * - **Asset** — canonical asset validation and allowlisting.
 * - **Network readiness** — required network, readiness, pause state, and
 *   runtime capabilities.
 *
 * Evaluation is pure and synchronous: it never calls a wallet, RPC endpoint,
 * or proof generator. Callers supply any network/employee snapshots they
 * already have.
 *
 * ## Privacy
 * Results are privacy-safe by construction. Issues never contain raw payment
 * amounts, recipient addresses, employee identifiers, or free-form notes — only
 * entry indexes, safe field paths, reason codes, and messages. Use
 * {@link toSafePolicyLog} when emitting evaluation results to logs or telemetry.
 *
 * @example
 * ```ts
 * const result = evaluatePayrollPolicies(
 *   {
 *     entries: [{ employeeId: "emp_1", amount: 500n, asset: "native" }],
 *     employees: [{ employeeId: "emp_1", status: "active" }],
 *     network: { network: "testnet", ready: true },
 *   },
 *   {
 *     amount: { maxAmount: 1_000n },
 *     network: { requiredNetwork: "testnet", requireReady: true },
 *   }
 * );
 *
 * if (result.blocked) {
 *   console.error(result.reasonCodes); // actionable reason codes
 * }
 * ```
 *
 * @module
 */

import { AssetIdentityError, normalizeAssetIdentity } from "../assets/assetIdentity";
import { ValidationError } from "../core/errors";
import { PayrollPolicyViolationError } from "./errors";
import {
  PAYROLL_POLICY_REASON_REGISTRY,
  PayrollPolicyReasonCode,
  type PayrollPolicyCategory,
  type PayrollPolicyIssueSeverity,
  type PayrollPolicyReasonCodeType,
} from "./reasonCodes";
import type {
  PayrollAmountPolicyRules,
  PayrollAssetPolicyRules,
  PayrollEmployeeStatusPolicyRules,
  PayrollPolicyCustomFinding,
  PayrollPolicyEmployeeRecord,
  PayrollPolicyEmployeeSource,
  PayrollPolicyEntry,
  PayrollPolicyEvaluationInput,
  PayrollPolicyEvaluationOptions,
  PayrollPolicyEvaluationResult,
  PayrollPolicyIssue,
  PayrollNetworkPolicyRules,
  PayrollPolicyNetworkReadiness,
  PayrollPolicyRules,
} from "./types";

/** Policies evaluated when no explicit subset is requested. */
const DEFAULT_ENABLED_POLICIES: readonly PayrollPolicyCategory[] = [
  "amount",
  "employee_status",
  "asset",
  "network",
  "custom",
];

const DEFAULT_ALLOWED_STATUSES: readonly string[] = ["active"];
const DEFAULT_BLOCKED_STATUSES: readonly string[] = ["inactive", "suspended", "terminated"];
const DEFAULT_WARNING_STATUSES: readonly string[] = ["pending"];
const DEFAULT_NEAR_LIMIT_WARNING_PERCENT = 90;

/** Stable policy identifiers surfaced on emitted issues. */
const POLICY_ID = {
  amount: "amount",
  employeeStatus: "employee_status",
  asset: "asset",
  network: "network",
} as const;

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parses an amount-like value into a bigint. Returns `null` for values that are
 * not safe integer representations (fractions, `NaN`, `Infinity`, or garbage
 * strings).
 */
function parseAmount(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      return null;
    }
    return BigInt(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return null;
    }
    return BigInt(trimmed);
  }

  return null;
}

/** Parses a configured (non-negative) policy limit, failing loudly on bad config. */
function parsePolicyLimit(value: unknown, field: string): bigint {
  const parsed = parseAmount(value);
  if (parsed === null || parsed < 0n) {
    throw new ValidationError(
      `Payroll policy limit "${field}" must be a non-negative integer`,
      field,
      "PAYROLL_POLICY_CONFIG_INVALID"
    );
  }
  return parsed;
}

/** Validates the near-limit warning percentage (integer from 0 to 100). */
function parseWarningPercent(value: unknown, field: string): number {
  if (value === undefined) {
    return DEFAULT_NEAR_LIMIT_WARNING_PERCENT;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ValidationError(
      `Payroll policy option "${field}" must be an integer percentage`,
      field,
      "PAYROLL_POLICY_CONFIG_INVALID"
    );
  }
  if (value < 0 || value > 100) {
    throw new ValidationError(
      `Payroll policy option "${field}" must be between 0 and 100`,
      field,
      "PAYROLL_POLICY_CONFIG_INVALID"
    );
  }
  return value;
}

/** Computes the "near limit" threshold using integer math. */
function nearLimitThreshold(max: bigint, percent: number): bigint {
  const p = BigInt(percent);
  return (max * p + 99n) / 100n;
}

/** Builds a privacy-safe issue from the reason-code registry. */
function createIssue(
  code: PayrollPolicyReasonCodeType,
  params: {
    policyId: string;
    severity?: PayrollPolicyIssueSeverity;
    message?: string;
    field?: string;
    entryIndex?: number;
  }
): PayrollPolicyIssue {
  const metadata = PAYROLL_POLICY_REASON_REGISTRY[code];
  return {
    policyId: params.policyId,
    category: metadata.category,
    code,
    severity: params.severity ?? metadata.severity,
    message: params.message ?? metadata.description,
    action: metadata.suggestedAction,
    ...(params.field !== undefined ? { field: params.field } : {}),
    ...(params.entryIndex !== undefined ? { entryIndex: params.entryIndex } : {}),
  };
}

/** Normalizes an optional employee identifier. */
function normalizeEmployeeId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Normalizes a status for case-insensitive comparisons. */
function normalizeStatus(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}

/** Normalizes a network identifier for case-insensitive comparisons. */
function normalizeNetwork(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}

/** Converts an employee source into an id-keyed map. */
function buildEmployeeMap(
  source: PayrollPolicyEmployeeSource | undefined
): Map<string, PayrollPolicyEmployeeRecord> {
  const employees = new Map<string, PayrollPolicyEmployeeRecord>();
  if (!source) {
    return employees;
  }

  if (Array.isArray(source)) {
    for (const record of source as readonly PayrollPolicyEmployeeRecord[]) {
      if (!record || typeof record !== "object") {
        continue;
      }
      const employeeId = normalizeEmployeeId(record.employeeId);
      if (employeeId) {
        employees.set(employeeId, record);
      }
    }
    return employees;
  }

  for (const [id, record] of Object.entries(
    source as Readonly<Record<string, PayrollPolicyEmployeeRecord>>
  )) {
    if (!record || typeof record !== "object") {
      continue;
    }
    const employeeId = normalizeEmployeeId(record.employeeId) ?? normalizeEmployeeId(id);
    if (employeeId) {
      employees.set(employeeId, { ...record, employeeId });
    }
  }
  return employees;
}

/** Builds the canonical allowlist set for the asset policy. */
function buildAllowedAssetSet(allowedAssets: readonly string[] | undefined): Set<string> {
  const allowed = new Set<string>();
  for (const candidate of allowedAssets ?? []) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      continue;
    }
    try {
      allowed.add(normalizeAssetIdentity(candidate).id);
    } catch (error) {
      if (!(error instanceof AssetIdentityError)) {
        throw error;
      }
      // Loose allowlist entries (e.g. a bare code) are compared case-insensitively.
      allowed.add(candidate.trim().toUpperCase());
    }
  }
  return allowed;
}

/** Resolves the deterministic reference timestamp for an evaluation. */
function resolveReferenceTime(value: PayrollPolicyEvaluationOptions["referenceTime"]): number {
  if (value === undefined) {
    return Date.now();
  }
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) {
      throw new ValidationError(
        "Payroll policy referenceTime must be a valid date",
        "referenceTime",
        "PAYROLL_POLICY_CONFIG_INVALID"
      );
    }
    return time;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationError(
        "Payroll policy referenceTime must be a finite timestamp",
        "referenceTime",
        "PAYROLL_POLICY_CONFIG_INVALID"
      );
    }
    return value;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ValidationError(
      "Payroll policy referenceTime must be an ISO date or epoch milliseconds",
      "referenceTime",
      "PAYROLL_POLICY_CONFIG_INVALID"
    );
  }
  return parsed;
}

// ── Built-in policies ────────────────────────────────────────────────────────

/**
 * Evaluates per-payment and aggregate amount rules.
 *
 * Every emitted issue is amount-agnostic: it identifies the entry index and the
 * rule that failed, never the raw amount.
 */
export function evaluatePayrollAmountPolicy(
  entries: readonly PayrollPolicyEntry[],
  rules: PayrollAmountPolicyRules = {}
): PayrollPolicyIssue[] {
  const issues: PayrollPolicyIssue[] = [];
  const allowZero = rules.allowZero === true;
  const minAmount =
    rules.minAmount !== undefined
      ? parsePolicyLimit(rules.minAmount, "amount.minAmount")
      : undefined;
  const maxAmount =
    rules.maxAmount !== undefined
      ? parsePolicyLimit(rules.maxAmount, "amount.maxAmount")
      : undefined;
  const maxTotalAmount =
    rules.maxTotalAmount !== undefined
      ? parsePolicyLimit(rules.maxTotalAmount, "amount.maxTotalAmount")
      : undefined;
  const warningPercent = parseWarningPercent(
    rules.nearLimitWarningPercent,
    "amount.nearLimitWarningPercent"
  );
  const perPaymentWarningThreshold =
    maxAmount !== undefined && warningPercent > 0
      ? nearLimitThreshold(maxAmount, warningPercent)
      : undefined;

  let total = 0n;

  entries.forEach((entry, index) => {
    const amount = parseAmount(entry.amount);

    if (amount === null) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.AMOUNT_INVALID, {
          policyId: POLICY_ID.amount,
          field: `entries[${index}].amount`,
          entryIndex: index,
        })
      );
      return;
    }

    if (amount < 0n || (amount === 0n && !allowZero)) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.AMOUNT_NOT_POSITIVE, {
          policyId: POLICY_ID.amount,
          field: `entries[${index}].amount`,
          entryIndex: index,
        })
      );
      return;
    }

    total += amount;

    if (minAmount !== undefined && amount < minAmount) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.AMOUNT_BELOW_MINIMUM, {
          policyId: POLICY_ID.amount,
          field: `entries[${index}].amount`,
          entryIndex: index,
        })
      );
      return;
    }

    if (maxAmount !== undefined) {
      if (amount > maxAmount) {
        issues.push(
          createIssue(PayrollPolicyReasonCode.AMOUNT_EXCEEDS_MAXIMUM, {
            policyId: POLICY_ID.amount,
            field: `entries[${index}].amount`,
            entryIndex: index,
          })
        );
        return;
      }

      if (
        perPaymentWarningThreshold !== undefined &&
        amount >= perPaymentWarningThreshold &&
        maxAmount > 0n
      ) {
        issues.push(
          createIssue(PayrollPolicyReasonCode.AMOUNT_NEAR_MAXIMUM, {
            policyId: POLICY_ID.amount,
            field: `entries[${index}].amount`,
            entryIndex: index,
          })
        );
      }
    }
  });

  if (maxTotalAmount !== undefined) {
    if (total > maxTotalAmount) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.TOTAL_EXCEEDS_MAXIMUM, {
          policyId: POLICY_ID.amount,
          field: "totalAmount",
        })
      );
    } else if (warningPercent > 0 && maxTotalAmount > 0n) {
      const totalWarningThreshold = nearLimitThreshold(maxTotalAmount, warningPercent);
      if (total >= totalWarningThreshold) {
        issues.push(
          createIssue(PayrollPolicyReasonCode.TOTAL_NEAR_MAXIMUM, {
            policyId: POLICY_ID.amount,
            field: "totalAmount",
          })
        );
      }
    }
  }

  return issues;
}

/**
 * Evaluates employee status, block, lock, and compliance rules.
 *
 * Entries without an `employeeId` are skipped unless `requireEmployeeId` is set.
 * A missing employee record warns by default; set `requireEmployeeRecord` to
 * make it blocking.
 */
export function evaluatePayrollEmployeeStatusPolicy(
  entries: readonly PayrollPolicyEntry[],
  employees:
    Map<string, PayrollPolicyEmployeeRecord> | PayrollPolicyEmployeeSource | undefined = undefined,
  rules: PayrollEmployeeStatusPolicyRules = {}
): PayrollPolicyIssue[] {
  const issues: PayrollPolicyIssue[] = [];
  const employeeMap =
    employees instanceof Map ? employees : buildEmployeeMap(employees ?? undefined);
  const allowedStatuses = (rules.allowedStatuses ?? DEFAULT_ALLOWED_STATUSES).map((status) =>
    status.toLowerCase()
  );
  const blockedStatuses = (rules.blockedStatuses ?? DEFAULT_BLOCKED_STATUSES).map((status) =>
    status.toLowerCase()
  );
  const warningStatuses = (rules.warningStatuses ?? DEFAULT_WARNING_STATUSES).map((status) =>
    status.toLowerCase()
  );
  const requireEmployeeId = rules.requireEmployeeId === true;
  const requireEmployeeRecord = rules.requireEmployeeRecord === true;
  const blockLockedEmployees = rules.blockLockedEmployees === true;

  entries.forEach((entry, index) => {
    const employeeId = normalizeEmployeeId(entry.employeeId);

    if (!employeeId) {
      if (requireEmployeeId) {
        issues.push(
          createIssue(PayrollPolicyReasonCode.EMPLOYEE_ID_MISSING, {
            policyId: POLICY_ID.employeeStatus,
            severity: "block",
            field: `entries[${index}].employeeId`,
            entryIndex: index,
          })
        );
      }
      return;
    }

    const employee = employeeMap.get(employeeId);
    if (!employee) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.EMPLOYEE_NOT_FOUND, {
          policyId: POLICY_ID.employeeStatus,
          severity: requireEmployeeRecord ? "block" : "warning",
          field: `entries[${index}].employeeId`,
          entryIndex: index,
        })
      );
      return;
    }

    if (employee.isBlocked) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.EMPLOYEE_BLOCKED, {
          policyId: POLICY_ID.employeeStatus,
          field: `employees[${index}].isBlocked`,
          entryIndex: index,
        })
      );
    }

    if (employee.isLocked) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.EMPLOYEE_LOCKED, {
          policyId: POLICY_ID.employeeStatus,
          severity: blockLockedEmployees ? "block" : "warning",
          field: `employees[${index}].isLocked`,
          entryIndex: index,
        })
      );
    }

    const complianceStatus = normalizeStatus(employee.complianceStatus);
    if (complianceStatus === "failed" || complianceStatus === "blocked") {
      issues.push(
        createIssue(PayrollPolicyReasonCode.EMPLOYEE_COMPLIANCE_FAILED, {
          policyId: POLICY_ID.employeeStatus,
          field: `employees[${index}].complianceStatus`,
          entryIndex: index,
        })
      );
    } else if (complianceStatus === "pending") {
      issues.push(
        createIssue(PayrollPolicyReasonCode.EMPLOYEE_COMPLIANCE_PENDING, {
          policyId: POLICY_ID.employeeStatus,
          field: `employees[${index}].complianceStatus`,
          entryIndex: index,
        })
      );
    }

    const status = normalizeStatus(employee.status);
    if (!status) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.EMPLOYEE_STATUS_NOT_ALLOWED, {
          policyId: POLICY_ID.employeeStatus,
          message: `Employee status for entry ${index + 1} is missing.`,
          field: `employees[${index}].status`,
          entryIndex: index,
        })
      );
      return;
    }

    if (blockedStatuses.includes(status)) {
      issues.push(
        createIssue(statusToReasonCode(status), {
          policyId: POLICY_ID.employeeStatus,
          field: `employees[${index}].status`,
          entryIndex: index,
        })
      );
      return;
    }

    if (warningStatuses.includes(status)) {
      issues.push(
        createIssue(
          status === "pending"
            ? PayrollPolicyReasonCode.EMPLOYEE_PENDING
            : PayrollPolicyReasonCode.EMPLOYEE_STATUS_NOT_ALLOWED,
          {
            policyId: POLICY_ID.employeeStatus,
            severity: "warning",
            field: `employees[${index}].status`,
            entryIndex: index,
          }
        )
      );
      return;
    }

    if (!allowedStatuses.includes(status)) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.EMPLOYEE_STATUS_NOT_ALLOWED, {
          policyId: POLICY_ID.employeeStatus,
          field: `employees[${index}].status`,
          entryIndex: index,
        })
      );
    }
  });

  return issues;
}

/** Maps a blocked employee status to its most specific reason code. */
function statusToReasonCode(status: string): PayrollPolicyReasonCodeType {
  switch (status) {
    case "inactive":
      return PayrollPolicyReasonCode.EMPLOYEE_INACTIVE;
    case "suspended":
      return PayrollPolicyReasonCode.EMPLOYEE_SUSPENDED;
    case "terminated":
      return PayrollPolicyReasonCode.EMPLOYEE_TERMINATED;
    default:
      return PayrollPolicyReasonCode.EMPLOYEE_STATUS_NOT_ALLOWED;
  }
}

/**
 * Evaluates asset presence, identity normalization, and allowlisting.
 *
 * When `validateAssetIdentity` is `false`, normalization errors are ignored but
 * allowlist comparisons still run against the trimmed, upper-cased identifier.
 */
export function evaluatePayrollAssetPolicy(
  entries: readonly PayrollPolicyEntry[],
  rules: PayrollAssetPolicyRules = {}
): PayrollPolicyIssue[] {
  const issues: PayrollPolicyIssue[] = [];
  const validateIdentity = rules.validateAssetIdentity !== false;
  const allowedAssets = buildAllowedAssetSet(rules.allowedAssets);

  entries.forEach((entry, index) => {
    const rawAsset = typeof entry.asset === "string" ? entry.asset.trim() : "";
    if (rawAsset === "") {
      issues.push(
        createIssue(PayrollPolicyReasonCode.ASSET_MISSING, {
          policyId: POLICY_ID.asset,
          field: `entries[${index}].asset`,
          entryIndex: index,
        })
      );
      return;
    }

    let canonicalAsset: string | undefined;
    try {
      canonicalAsset = normalizeAssetIdentity(rawAsset).id;
    } catch (error) {
      if (!(error instanceof AssetIdentityError)) {
        throw error;
      }
      if (validateIdentity) {
        issues.push(
          createIssue(PayrollPolicyReasonCode.ASSET_INVALID, {
            policyId: POLICY_ID.asset,
            field: `entries[${index}].asset`,
            entryIndex: index,
          })
        );
        return;
      }
    }

    if (allowedAssets.size > 0) {
      const comparable = canonicalAsset ?? rawAsset.toUpperCase();
      if (!allowedAssets.has(comparable)) {
        issues.push(
          createIssue(PayrollPolicyReasonCode.ASSET_NOT_ALLOWED, {
            policyId: POLICY_ID.asset,
            field: `entries[${index}].asset`,
            entryIndex: index,
          })
        );
      }
    }
  });

  return issues;
}

/**
 * Evaluates network readiness rules against a caller-supplied snapshot.
 *
 * No network calls are made. A missing snapshot is only an issue when the rules
 * require a network, readiness, or a capability.
 */
export function evaluatePayrollNetworkPolicy(
  network: PayrollPolicyNetworkReadiness | undefined,
  rules: PayrollNetworkPolicyRules = {}
): PayrollPolicyIssue[] {
  const issues: PayrollPolicyIssue[] = [];
  const requiredNetwork = normalizeNetwork(rules.requiredNetwork);
  const requireReady = rules.requireReady === true;
  const requiredCapabilities = (rules.requireCapabilities ?? [])
    .filter((capability): capability is string => typeof capability === "string")
    .map((capability) => capability.trim().toLowerCase())
    .filter((capability) => capability !== "");
  const blockWhenPaused = rules.blockWhenPaused !== false;

  if (!network) {
    if (requiredNetwork !== undefined || requireReady || requiredCapabilities.length > 0) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.NETWORK_NOT_CONFIGURED, {
          policyId: POLICY_ID.network,
          field: "network",
        })
      );
    }
    return issues;
  }

  if (network.paused === true && blockWhenPaused) {
    issues.push(
      createIssue(PayrollPolicyReasonCode.NETWORK_PAUSED, {
        policyId: POLICY_ID.network,
        field: "network.paused",
      })
    );
  }

  if (requiredNetwork !== undefined) {
    const actualNetwork = normalizeNetwork(network.network);
    if (actualNetwork !== requiredNetwork) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.NETWORK_MISMATCH, {
          policyId: POLICY_ID.network,
          field: "network.network",
        })
      );
    }
  }

  if (requireReady) {
    if (network.ready !== true) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.NETWORK_NOT_READY, {
          policyId: POLICY_ID.network,
          field: "network.ready",
        })
      );
    }
  } else if (network.ready === false) {
    issues.push(
      createIssue(PayrollPolicyReasonCode.NETWORK_NOT_READY, {
        policyId: POLICY_ID.network,
        severity: "warning",
        field: "network.ready",
      })
    );
  }

  if (requiredCapabilities.length > 0) {
    const available = new Set(
      (network.capabilities ?? [])
        .filter((capability): capability is string => typeof capability === "string")
        .map((capability) => capability.trim().toLowerCase())
    );
    const missing = requiredCapabilities.filter((capability) => !available.has(capability));
    if (missing.length > 0) {
      issues.push(
        createIssue(PayrollPolicyReasonCode.NETWORK_CAPABILITY_MISSING, {
          policyId: POLICY_ID.network,
          message: `Missing required network capability: ${missing.join(", ")}.`,
          field: "network.capabilities",
        })
      );
    }
  }

  return issues;
}

/** Converts a custom finding into a privacy-safe issue. */
function toCustomIssue(
  ruleId: string,
  category: PayrollPolicyCategory | undefined,
  finding: PayrollPolicyCustomFinding
): PayrollPolicyIssue {
  if (finding.outcome !== "warning" && finding.outcome !== "block") {
    throw new ValidationError(
      `Custom payroll policy rule "${ruleId}" returned an invalid outcome`,
      `custom.${ruleId}.outcome`,
      "PAYROLL_POLICY_CONFIG_INVALID"
    );
  }
  if (typeof finding.code !== "string" || finding.code.trim() === "") {
    throw new ValidationError(
      `Custom payroll policy rule "${ruleId}" must return a reason code`,
      `custom.${ruleId}.code`,
      "PAYROLL_POLICY_CONFIG_INVALID"
    );
  }
  if (typeof finding.message !== "string" || finding.message.trim() === "") {
    throw new ValidationError(
      `Custom payroll policy rule "${ruleId}" must return a privacy-safe message`,
      `custom.${ruleId}.message`,
      "PAYROLL_POLICY_CONFIG_INVALID"
    );
  }

  const fallback =
    PAYROLL_POLICY_REASON_REGISTRY[
      finding.outcome === "block"
        ? PayrollPolicyReasonCode.CUSTOM_RULE_BLOCKED
        : PayrollPolicyReasonCode.CUSTOM_RULE_WARNING
    ];

  return {
    policyId: ruleId,
    category: category ?? "custom",
    code: finding.code.trim(),
    severity: finding.outcome,
    message: finding.message,
    action:
      typeof finding.action === "string" && finding.action.trim() !== ""
        ? finding.action
        : fallback.suggestedAction,
    ...(finding.field !== undefined ? { field: finding.field } : {}),
    ...(finding.entryIndex !== undefined ? { entryIndex: finding.entryIndex } : {}),
  };
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/** Builds the final, deterministic result object. */
function buildResult(
  entryCount: number,
  issues: PayrollPolicyIssue[],
  evaluatedAt: number
): PayrollPolicyEvaluationResult {
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const blockers = issues.filter((issue) => issue.severity === "block");
  const reasonCodes: string[] = [];
  const seenCodes = new Set<string>();
  const issuesByCategory: Record<PayrollPolicyCategory, number> = {
    amount: 0,
    employee_status: 0,
    asset: 0,
    network: 0,
    custom: 0,
  };

  for (const issue of issues) {
    issuesByCategory[issue.category] += 1;
    if (!seenCodes.has(issue.code)) {
      seenCodes.add(issue.code);
      reasonCodes.push(issue.code);
    }
  }

  const outcome = blockers.length > 0 ? "block" : warnings.length > 0 ? "warning" : "pass";

  return {
    outcome,
    passed: blockers.length === 0,
    blocked: blockers.length > 0,
    issues,
    warnings,
    blockers,
    reasonCodes,
    summary: {
      totalEntries: entryCount,
      totalIssues: issues.length,
      warningCount: warnings.length,
      blockerCount: blockers.length,
      issuesByCategory,
    },
    evaluatedAt,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluates a payroll request against the built-in and custom policy rules.
 *
 * All issues are collected (no fail-fast) so callers can surface every problem
 * in a single review pass. The aggregate `outcome` is `"block"` when any
 * blocking issue exists, `"warning"` when only advisories exist, and `"pass"`
 * otherwise.
 *
 * @param input - Payroll entries plus optional employee and network snapshots.
 * @param rules - Configurable policy rules. Omitted categories use safe defaults.
 * @param options - Evaluation options (deterministic time, enabled policy subset).
 * @returns A deterministic, privacy-safe evaluation result.
 * @throws {ValidationError} If the input shape or policy configuration is invalid.
 *
 * @example
 * ```ts
 * const result = evaluatePayrollPolicies({
 *   entries: [{ employeeId: "emp_1", amount: 950n, asset: "native" }],
 *   employees: [{ employeeId: "emp_1", status: "active" }],
 *   network: { network: "testnet", ready: true },
 * }, {
 *   amount: { maxAmount: 1_000n },
 *   network: { requiredNetwork: "testnet", requireReady: true },
 * });
 *
 * result.outcome;     // "warning" — amount is near the configured maximum
 * result.passed;      // true — warnings do not block submission
 * ```
 */
export function evaluatePayrollPolicies(
  input: PayrollPolicyEvaluationInput,
  rules: PayrollPolicyRules = {},
  options: PayrollPolicyEvaluationOptions = {}
): PayrollPolicyEvaluationResult {
  if (!input || !Array.isArray(input.entries)) {
    throw new ValidationError(
      "Payroll policy evaluation requires an entries array",
      "entries",
      "PAYROLL_POLICY_INPUT_INVALID"
    );
  }

  const referenceTime = resolveReferenceTime(options.referenceTime);
  const enabled = new Set<PayrollPolicyCategory>(
    options.enabledPolicies ?? DEFAULT_ENABLED_POLICIES
  );
  const employees = buildEmployeeMap(input.employees);
  const issues: PayrollPolicyIssue[] = [];

  if (enabled.has("amount")) {
    issues.push(...evaluatePayrollAmountPolicy(input.entries, rules.amount));
  }

  if (enabled.has("employee_status")) {
    issues.push(
      ...evaluatePayrollEmployeeStatusPolicy(input.entries, employees, rules.employeeStatus)
    );
  }

  if (enabled.has("asset")) {
    issues.push(...evaluatePayrollAssetPolicy(input.entries, rules.asset));
  }

  if (enabled.has("network")) {
    issues.push(...evaluatePayrollNetworkPolicy(input.network, rules.network));
  }

  if (enabled.has("custom") && rules.custom) {
    const context = {
      entries: input.entries,
      employees,
      ...(input.network !== undefined ? { network: input.network } : {}),
      rules,
      referenceTime,
    };

    for (const rule of rules.custom) {
      if (!rule || typeof rule.id !== "string" || rule.id.trim() === "") {
        throw new ValidationError(
          "Custom payroll policy rules must declare a non-empty id",
          "custom.id",
          "PAYROLL_POLICY_CONFIG_INVALID"
        );
      }

      const findings = rule.evaluate(context);
      if (findings === undefined || findings === null) {
        continue;
      }
      const items = Array.isArray(findings)
        ? (findings as readonly PayrollPolicyCustomFinding[])
        : [findings as PayrollPolicyCustomFinding];

      for (const finding of items) {
        issues.push(toCustomIssue(rule.id, rule.category, finding));
      }
    }
  }

  return buildResult(input.entries.length, issues, referenceTime);
}

/**
 * Evaluates policies and throws {@link PayrollPolicyViolationError} when the
 * request is blocked. Returns the full result when the request passes (with or
 * without warnings).
 */
export function assertPayrollPolicies(
  input: PayrollPolicyEvaluationInput,
  rules: PayrollPolicyRules = {},
  options: PayrollPolicyEvaluationOptions = {}
): PayrollPolicyEvaluationResult {
  const result = evaluatePayrollPolicies(input, rules, options);
  if (result.blocked) {
    throw new PayrollPolicyViolationError(
      `Payroll policy blocked the request: ${result.reasonCodes.join(", ")}`,
      result
    );
  }
  return result;
}

/**
 * Reusable evaluator bound to a set of policy rules.
 *
 * @example
 * ```ts
 * const evaluator = new PayrollPolicyEvaluator({
 *   amount: { maxAmount: 1_000_000n },
 *   employeeStatus: { requireEmployeeRecord: true },
 * });
 * const result = evaluator.evaluate({ entries });
 * ```
 */
export class PayrollPolicyEvaluator {
  constructor(private readonly rules: PayrollPolicyRules = {}) {}

  /** Evaluates a payroll request against this evaluator's rules. */
  evaluate(
    input: PayrollPolicyEvaluationInput,
    options: PayrollPolicyEvaluationOptions = {}
  ): PayrollPolicyEvaluationResult {
    return evaluatePayrollPolicies(input, this.rules, options);
  }

  /** Evaluates and throws {@link PayrollPolicyViolationError} when blocked. */
  evaluateOrThrow(
    input: PayrollPolicyEvaluationInput,
    options: PayrollPolicyEvaluationOptions = {}
  ): PayrollPolicyEvaluationResult {
    return assertPayrollPolicies(input, this.rules, options);
  }
}
