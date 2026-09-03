import { evaluateBatchEligibility } from "../eligibility/EmployeeEligibilityEvaluator";
import type {
  BatchEligibilityResult,
  EligibilityEvaluationOptions,
  EmployeeEligibilityRecord,
  EmployeeEligibilityResult,
} from "../eligibility/types";
import type { EmployeeEvaluationSummary, EmployeeFilterOptions, EmployeeProfile } from "./types";

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
