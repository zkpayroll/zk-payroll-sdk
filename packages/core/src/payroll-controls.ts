/** Revision history for company configuration snapshots. */
export interface CompanyConfigurationRevision<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  companyId: string;
  revision: number;
  configuration: T;
  fingerprint: string;
}

/** Tracks immutable, monotonically numbered company configuration snapshots. */
export class CompanyConfigurationRevisionTracker<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly history = new Map<string, CompanyConfigurationRevision<T>[]>();

  record(companyId: string, configuration: T): CompanyConfigurationRevision<T> {
    if (!companyId.trim()) throw new Error("companyId is required");
    const fingerprint = stableSerialize(configuration);
    const revisions = this.history.get(companyId) ?? [];
    const previous = revisions[revisions.length - 1];
    if (previous?.fingerprint === fingerprint) return cloneRevision(previous);
    const revision: CompanyConfigurationRevision<T> = {
      companyId,
      revision: (previous?.revision ?? 0) + 1,
      configuration: structuredCloneSafe(configuration),
      fingerprint,
    };
    this.history.set(companyId, [...revisions, revision]);
    return cloneRevision(revision);
  }

  getHistory(companyId: string): CompanyConfigurationRevision<T>[] {
    return (this.history.get(companyId) ?? []).map(cloneRevision);
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(",")}}`;
}

function structuredCloneSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.map(structuredCloneSafe) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, structuredCloneSafe(child)])
    ) as T;
  }
  return value;
}

function cloneRevision<T extends Record<string, unknown>>(
  revision: CompanyConfigurationRevision<T>
): CompanyConfigurationRevision<T> {
  return { ...revision, configuration: structuredCloneSafe(revision.configuration) };
}

export interface PayrollReferenceSet {
  companyIds: readonly string[];
  periodIds: readonly string[];
  employeeIds: readonly string[];
  payments: readonly {
    paymentId: string;
    companyId: string;
    periodId: string;
    employeeId: string;
  }[];
}

export interface PayrollReferenceIssue {
  code:
    | "duplicate_company"
    | "duplicate_period"
    | "duplicate_employee"
    | "duplicate_payment"
    | "missing_company"
    | "missing_period"
    | "missing_employee"
    | "empty_reference";
  path: string;
  message: string;
}

/** Checks payment references for uniqueness and referential integrity. */
export function validatePayrollReferences(input: PayrollReferenceSet): PayrollReferenceIssue[] {
  const issues: PayrollReferenceIssue[] = [];
  const unique = (
    values: readonly string[],
    kind: "company" | "period" | "employee"
  ): Set<string> => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (!value.trim())
        issues.push({
          code: "empty_reference",
          path: `${kind}Ids[${index}]`,
          message: `${kind} reference must not be empty`,
        });
      else if (seen.has(value))
        issues.push({
          code: `duplicate_${kind}` as PayrollReferenceIssue["code"],
          path: `${kind}Ids[${index}]`,
          message: `Duplicate ${kind} reference: ${value}`,
        });
      seen.add(value);
    });
    return seen;
  };
  const companies = unique(input.companyIds, "company");
  const periods = unique(input.periodIds, "period");
  const employees = unique(input.employeeIds, "employee");
  const paymentIds = new Set<string>();
  input.payments.forEach((payment, index) => {
    const path = `payments[${index}]`;
    if (!payment.paymentId.trim())
      issues.push({
        code: "empty_reference",
        path: `${path}.paymentId`,
        message: "payment reference must not be empty",
      });
    else if (paymentIds.has(payment.paymentId))
      issues.push({
        code: "duplicate_payment",
        path: `${path}.paymentId`,
        message: `Duplicate payment reference: ${payment.paymentId}`,
      });
    paymentIds.add(payment.paymentId);
    if (!companies.has(payment.companyId))
      issues.push({
        code: "missing_company",
        path: `${path}.companyId`,
        message: `Unknown company reference: ${payment.companyId}`,
      });
    if (!periods.has(payment.periodId))
      issues.push({
        code: "missing_period",
        path: `${path}.periodId`,
        message: `Unknown period reference: ${payment.periodId}`,
      });
    if (!employees.has(payment.employeeId))
      issues.push({
        code: "missing_employee",
        path: `${path}.employeeId`,
        message: `Unknown employee reference: ${payment.employeeId}`,
      });
  });
  return issues;
}

export interface TreasuryReserveInput {
  availableBalance: bigint;
  upcomingPayroll: bigint;
  minimumReserve?: bigint;
}

export interface TreasuryReserveResult {
  sufficient: boolean;
  requiredBalance: bigint;
  remainingBalance: bigint;
  shortfall: bigint;
}

/** Checks that payroll obligations can be paid while preserving the configured reserve. */
export function monitorTreasuryReserve(input: TreasuryReserveInput): TreasuryReserveResult {
  const reserve = input.minimumReserve ?? 0n;
  if (input.availableBalance < 0n || input.upcomingPayroll < 0n || reserve < 0n) {
    throw new RangeError(
      "Treasury balance, payroll obligation, and minimum reserve must be non-negative"
    );
  }
  const requiredBalance = input.upcomingPayroll + reserve;
  const shortfall =
    input.availableBalance >= requiredBalance ? 0n : requiredBalance - input.availableBalance;
  return {
    sufficient: shortfall === 0n,
    requiredBalance,
    remainingBalance: input.availableBalance - input.upcomingPayroll,
    shortfall,
  };
}

export interface PayPeriodClosureInput {
  periodId: string;
  startDate: string;
  endDate: string;
  outstandingPayments: number;
  unresolvedReferences: number;
  requiredApprovals?: number;
  receivedApprovals?: number;
}

export interface PayPeriodClosureResult {
  canClose: boolean;
  blockers: string[];
}

/** Reports prerequisites that must be satisfied before a pay period can close. */
export function checkPayPeriodClosure(input: PayPeriodClosureInput): PayPeriodClosureResult {
  const blockers: string[] = [];
  const start = Date.parse(input.startDate);
  const end = Date.parse(input.endDate);
  if (!input.periodId.trim()) blockers.push("A period ID is required.");
  if (!Number.isFinite(start) || !Number.isFinite(end))
    blockers.push("Period start and end must be valid dates.");
  else if (start > end) blockers.push("Period start must be on or before period end.");
  if (!Number.isInteger(input.outstandingPayments) || input.outstandingPayments < 0)
    blockers.push("Outstanding payment count must be a non-negative integer.");
  else if (input.outstandingPayments > 0)
    blockers.push(`${input.outstandingPayments} payment(s) are still outstanding.`);
  if (!Number.isInteger(input.unresolvedReferences) || input.unresolvedReferences < 0)
    blockers.push("Unresolved reference count must be a non-negative integer.");
  else if (input.unresolvedReferences > 0)
    blockers.push(`${input.unresolvedReferences} payroll reference(s) remain unresolved.`);
  const required = input.requiredApprovals ?? 0;
  const received = input.receivedApprovals ?? 0;
  if (!Number.isInteger(required) || required < 0 || !Number.isInteger(received) || received < 0)
    blockers.push("Approval counts must be non-negative integers.");
  else if (received < required)
    blockers.push(`Period needs ${required - received} additional approval(s).`);
  return { canClose: blockers.length === 0, blockers };
}
