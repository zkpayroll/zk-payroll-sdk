import { evaluateBatchEligibility } from "../eligibility/EmployeeEligibilityEvaluator";
import type {
  BatchEligibilityResult,
  EligibilityEvaluationOptions,
  EmployeeEligibilityRecord,
  EmployeeEligibilityResult,
} from "../eligibility/types";
import type {
  EmployeeEvaluationSummary,
  EmployeeFilterOptions,
  EmployeeProfile,
  PayoutMethodConfirmationRecord,
  PayoutMethodConfirmationStatus,
} from "./types";

/**
 * Local in-memory registry for managing employee profiles and evaluating eligibility.
 */
export class EmployeeRegistry {
  private readonly employees = new Map<string, EmployeeProfile>();

  constructor(initialEmployees?: EmployeeEligibilityRecord[]) {
    if (initialEmployees) {
      this.addMany(initialEmployees);
    }
  }

  /**
   * Adds or updates an employee in the registry.
   */
  add(record: EmployeeEligibilityRecord): this {
    const existing = this.employees.get(record.employeeId);
    const now = Date.now();
    const profile: EmployeeProfile = {
      ...record,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.employees.set(record.employeeId, profile);
    return this;
  }

  /**
   * Adds multiple employee records.
   */
  addMany(records: EmployeeEligibilityRecord[]): this {
    for (const record of records) {
      this.add(record);
    }
    return this;
  }

  /**
   * Retrieves an employee by their ID.
   */
  get(employeeId: string): EmployeeProfile | undefined {
    const profile = this.employees.get(employeeId);
    return profile ? { ...profile } : undefined;
  }

  /**
   * Retrieves an employee by their destination recipient address.
   */
  getByRecipient(recipient: string): EmployeeProfile | undefined {
    for (const profile of this.employees.values()) {
      if (profile.recipient === recipient) {
        return { ...profile };
      }
    }
    return undefined;
  }

  /**
   * Removes an employee from the registry.
   */
  remove(employeeId: string): boolean {
    return this.employees.delete(employeeId);
  }

  /**
   * Returns all employee profiles in the registry.
   */
  list(): EmployeeProfile[] {
    return Array.from(this.employees.values()).map((p) => ({ ...p }));
  }

  /**
   * Evaluates eligibility for all registered employees.
   */
  evaluateAll(options?: EligibilityEvaluationOptions): BatchEligibilityResult {
    return evaluateBatchEligibility(this.list(), options);
  }

  /**
   * Returns all employees that pass eligibility checks.
   */
  getEligible(options?: EligibilityEvaluationOptions): EmployeeProfile[] {
    const batch = this.evaluateAll(options);
    return batch.eligibleRecords as EmployeeProfile[];
  }

  /**
   * Returns all ineligible employees along with their specific evaluation results.
   */
  getIneligible(options?: EligibilityEvaluationOptions): Array<{
    record: EmployeeProfile;
    result: EmployeeEligibilityResult;
  }> {
    const batch = this.evaluateAll(options);
    return batch.ineligibleRecords as Array<{
      record: EmployeeProfile;
      result: EmployeeEligibilityResult;
    }>;
  }

  /**
   * Queries employees with optional status, department, and eligibility filtering.
   */
  query(filter: EmployeeFilterOptions = {}): EmployeeEvaluationSummary[] {
    let profiles = this.list();

    if (filter.status) {
      const statusLower = filter.status.toLowerCase();
      profiles = profiles.filter((p) => (p.status ?? "active").toLowerCase() === statusLower);
    }

    if (filter.department) {
      profiles = profiles.filter((p) => p.department === filter.department);
    }

    if (filter.asset) {
      profiles = profiles.filter((p) => (p.asset ?? p.token) === filter.asset);
    }

    const batch = evaluateBatchEligibility(profiles, filter.evaluationOptions);
    const summaries: EmployeeEvaluationSummary[] = [];

    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const result = batch.results[i];
      if (filter.eligibleOnly && !result.isEligible) {
        continue;
      }
      summaries.push({
        employee: profile,
        eligibility: result,
      });
    }

    return summaries;
  }

  /**
   * Confirms the payout method for a registered employee.
   *
   * This validates that the employee exists and has a usable payout destination,
   * then marks the payout method as confirmed and records the confirmation time.
   */
  confirmPayoutMethod(employeeId: string): PayoutMethodConfirmationRecord {
    if (!employeeId || employeeId.trim().length === 0) {
      return {
        success: false,
        employeeId,
        status: "invalid_id",
        message: "EmployeeID is required to confirm a payout method.",
      };
    }

    const existing = this.employees.get(employeeId);
    if (!existing) {
      return {
        success: false,
        employeeId,
        status: "not_found",
        message: `No employee registered with id "${employeeId}".`,
      };
    }

    const recipient = existing.recipient;
    if (!recipient || recipient.trim().length === 0) {
      return {
        success: false,
        employeeId,
        status: "missing_recipient",
        message: `Employee "${employeeId}" has no payout recipient address configured.`,
      };
    }

    const now = Date.now();
    const updated: EmployeeProfile = {
      ...existing,
      payoutMethodConfirmed: true,
      payoutMethodConfirmedAt: now,
      updatedAt: now,
    };
    this.employees.set(employeeId, updated);

    return {
      success: true,
      employeeId,
      status: "confirmed",
      message: `Payout method confirmed for employee "${employeeId}".`,
      confirmedAt: now,
      profile: { ...updated },
    };
  }

  /**
   * Returns the current confirmation status of an employee's payout method.
   */
  getPayoutMethodConfirmationStatus(employeeId: string): PayoutMethodConfirmationStatus {
    if (!employeeId || employeeId.trim().length === 0) {
      return "invalid_id";
    }

    const profile = this.employees.get(employeeId);
    if (!profile) {
      return "not_found";
    }

    if (!profile.recipient || profile.recipient.trim().length === 0) {
      return "missing_recipient";
    }

    return profile.payoutMethodConfirmed ? "confirmed" : "unconfirmed";
  }

  /**
   * Clears all employees from the registry.
   */
  clear(): void {
    this.employees.clear();
  }

  /**
   * Returns the count of registered employees.
   */
  get size(): number {
    return this.employees.size;
  }
}
