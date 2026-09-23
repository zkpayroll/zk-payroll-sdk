import {
  validateAssetRule,
  validateBatchDuplicatesRule,
  validateComplianceRule,
  validateEmployeeIdRule,
  validateLifecycleDatesRule,
  validateOnChainRegistryRule,
  validateRecipientRule,
  validateSalaryRule,
  validateStatusRule,
} from "./rules";
import { BatchEligibilityError, IneligibleEmployeeError } from "./errors";
import type {
  BatchEligibilityResult,
  EligibilityEvaluationOptions,
  EligibilityReason,
  EligibilityRuleContext,
  EligibilityRuleFn,
  EmployeeEligibilityRecord,
  EmployeeEligibilityResult,
} from "./types";

/**
 * Engine for evaluating employee payroll eligibility and producing typed reason codes.
 */
export class EmployeeEligibilityEvaluator {
  private readonly options: EligibilityEvaluationOptions;
  private readonly customRules: EligibilityRuleFn[] = [];

  constructor(options: EligibilityEvaluationOptions = {}) {
    this.options = { ...options };
    if (options.customRules) {
      this.customRules.push(...options.customRules);
    }
  }

  /**
   * Register an additional custom eligibility rule function.
   */
  addRule(rule: EligibilityRuleFn): this {
    this.customRules.push(rule);
    return this;
  }

  /**
   * Evaluates a single employee record synchronously (skipping async on-chain checks).
   */
  evaluate(
    record: EmployeeEligibilityRecord,
    overrideOptions?: EligibilityEvaluationOptions
  ): EmployeeEligibilityResult {
    const effectiveOptions = overrideOptions
      ? { ...this.options, ...overrideOptions }
      : this.options;
    const refTimestamp = this.resolveReferenceTimestamp(effectiveOptions.referenceTimestamp);

    const context: EligibilityRuleContext = {
      referenceTimestamp: refTimestamp,
      options: effectiveOptions,
    };

    const reasons = this.evaluateSyncRules(record, context);
    return this.buildResult(record, reasons, refTimestamp);
  }

  /**
   * Evaluates a single employee record asynchronously, running both local rules
   * and any configured on-chain registry verification.
   */
  async evaluateAsync(
    record: EmployeeEligibilityRecord,
    overrideOptions?: EligibilityEvaluationOptions
  ): Promise<EmployeeEligibilityResult> {
    const effectiveOptions = overrideOptions
      ? { ...this.options, ...overrideOptions }
      : this.options;
    const refTimestamp = this.resolveReferenceTimestamp(effectiveOptions.referenceTimestamp);

    const context: EligibilityRuleContext = {
      referenceTimestamp: refTimestamp,
      options: effectiveOptions,
    };

    const reasons = this.evaluateSyncRules(record, context);

    // If on-chain registry validation is configured, execute it asynchronously
    if (effectiveOptions.onChainRegistry) {
      const onChainReasons = await validateOnChainRegistryRule(record, context);
      reasons.push(...onChainReasons);
    }

    // Run any async custom rules
    for (const rule of this.customRules) {
      const ruleResult = await rule(record, context);
      if (ruleResult) {
        if (Array.isArray(ruleResult)) {
          reasons.push(...ruleResult);
        } else {
          reasons.push(ruleResult);
        }
      }
    }

    return this.buildResult(record, reasons, refTimestamp);
  }

  /**
   * Evaluates a batch of employee records synchronously with duplicate checking.
   */
  evaluateBatch(
    records: EmployeeEligibilityRecord[],
    overrideOptions?: EligibilityEvaluationOptions
  ): BatchEligibilityResult {
    const effectiveOptions = overrideOptions
      ? { ...this.options, ...overrideOptions }
      : this.options;
    const refTimestamp = this.resolveReferenceTimestamp(effectiveOptions.referenceTimestamp);

    const results: EmployeeEligibilityResult[] = [];
    const eligibleRecords: EmployeeEligibilityRecord[] = [];
    const ineligibleRecords: Array<{
      record: EmployeeEligibilityRecord;
      result: EmployeeEligibilityResult;
    }> = [];
    const reasonCodeSummary: Record<string, number> = {};

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const context: EligibilityRuleContext = {
        referenceTimestamp: refTimestamp,
        options: effectiveOptions,
        batchRecords: records,
        index: i,
      };

      const reasons = this.evaluateSyncRules(record, context);
      // Batch duplicate checks
      const duplicateReasons = validateBatchDuplicatesRule(record, context);
      reasons.push(...duplicateReasons);

      const result = this.buildResult(record, reasons, refTimestamp);
      results.push(result);

      if (result.isEligible) {
        eligibleRecords.push(record);
      } else {
        ineligibleRecords.push({ record, result });
      }

      for (const reason of result.reasons) {
        reasonCodeSummary[reason.code] = (reasonCodeSummary[reason.code] || 0) + 1;
      }
    }

    return {
      totalRecords: records.length,
      eligibleCount: eligibleRecords.length,
      ineligibleCount: ineligibleRecords.length,
      eligibleRecords,
      ineligibleRecords,
      results,
      reasonCodeSummary,
      evaluatedAt: refTimestamp,
    };
  }

  /**
   * Evaluates a batch of employee records asynchronously.
   */
  async evaluateBatchAsync(
    records: EmployeeEligibilityRecord[],
    overrideOptions?: EligibilityEvaluationOptions
  ): Promise<BatchEligibilityResult> {
    const effectiveOptions = overrideOptions
      ? { ...this.options, ...overrideOptions }
      : this.options;
    const refTimestamp = this.resolveReferenceTimestamp(effectiveOptions.referenceTimestamp);

    const results: EmployeeEligibilityResult[] = [];
    const eligibleRecords: EmployeeEligibilityRecord[] = [];
    const ineligibleRecords: Array<{
      record: EmployeeEligibilityRecord;
      result: EmployeeEligibilityResult;
    }> = [];
    const reasonCodeSummary: Record<string, number> = {};

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const context: EligibilityRuleContext = {
        referenceTimestamp: refTimestamp,
        options: effectiveOptions,
        batchRecords: records,
        index: i,
      };

      const reasons = this.evaluateSyncRules(record, context);
      const duplicateReasons = validateBatchDuplicatesRule(record, context);
      reasons.push(...duplicateReasons);

      if (effectiveOptions.onChainRegistry) {
        const onChainReasons = await validateOnChainRegistryRule(record, context);
        reasons.push(...onChainReasons);
      }

      for (const rule of this.customRules) {
        const ruleResult = await rule(record, context);
        if (ruleResult) {
          if (Array.isArray(ruleResult)) {
            reasons.push(...ruleResult);
          } else {
            reasons.push(ruleResult);
          }
        }
      }

      const result = this.buildResult(record, reasons, refTimestamp);
      results.push(result);

      if (result.isEligible) {
        eligibleRecords.push(record);
      } else {
        ineligibleRecords.push({ record, result });
      }

      for (const reason of result.reasons) {
        reasonCodeSummary[reason.code] = (reasonCodeSummary[reason.code] || 0) + 1;
      }
    }

    return {
      totalRecords: records.length,
      eligibleCount: eligibleRecords.length,
      ineligibleCount: ineligibleRecords.length,
      eligibleRecords,
      ineligibleRecords,
      results,
      reasonCodeSummary,
      evaluatedAt: refTimestamp,
    };
  }

  /**
   * Filters out ineligible employees from a list, returning only eligible records.
   */
  filterEligible(
    records: EmployeeEligibilityRecord[],
    overrideOptions?: EligibilityEvaluationOptions
  ): EmployeeEligibilityRecord[] {
    return this.evaluateBatch(records, overrideOptions).eligibleRecords;
  }

  /**
   * Filters out ineligible employees asynchronously.
   */
  async filterEligibleAsync(
    records: EmployeeEligibilityRecord[],
    overrideOptions?: EligibilityEvaluationOptions
  ): Promise<EmployeeEligibilityRecord[]> {
    const batch = await this.evaluateBatchAsync(records, overrideOptions);
    return batch.eligibleRecords;
  }

  /**
   * Asserts that an employee record is eligible, throwing `IneligibleEmployeeError` if not.
   */
  assertEligible(
    record: EmployeeEligibilityRecord,
    overrideOptions?: EligibilityEvaluationOptions
  ): EmployeeEligibilityResult {
    const result = this.evaluate(record, overrideOptions);
    if (!result.isEligible) {
      throw new IneligibleEmployeeError(result);
    }
    return result;
  }

  /**
   * Asserts that all records in a batch are eligible, throwing `BatchEligibilityError` if any fail.
   */
  assertBatchEligible(
    records: EmployeeEligibilityRecord[],
    overrideOptions?: EligibilityEvaluationOptions
  ): BatchEligibilityResult {
    const batchResult = this.evaluateBatch(records, overrideOptions);
    if (batchResult.ineligibleCount > 0) {
      throw new BatchEligibilityError(batchResult);
    }
    return batchResult;
  }

  private evaluateSyncRules(
    record: EmployeeEligibilityRecord,
    context: EligibilityRuleContext
  ): EligibilityReason[] {
    const reasons: EligibilityReason[] = [];

    reasons.push(...validateEmployeeIdRule(record));
    reasons.push(...validateRecipientRule(record, context));
    reasons.push(...validateSalaryRule(record, context));
    reasons.push(...validateAssetRule(record, context));
    reasons.push(...validateStatusRule(record, context));
    reasons.push(...validateLifecycleDatesRule(record, context));
    reasons.push(...validateComplianceRule(record, context));

    for (const rule of this.customRules) {
      try {
        const customRes = rule(record, context);
        if (customRes && !(customRes instanceof Promise)) {
          if (Array.isArray(customRes)) {
            reasons.push(...customRes);
          } else {
            reasons.push(customRes);
          }
        }
      } catch (err) {
        reasons.push({
          code: "CUSTOM_INELIGIBILITY_RULE",
          message: `Custom rule execution error: ${err instanceof Error ? err.message : String(err)}`,
          severity: "error",
        });
      }
    }

    return reasons;
  }

  private buildResult(
    record: EmployeeEligibilityRecord,
    reasons: EligibilityReason[],
    evaluatedAt: number
  ): EmployeeEligibilityResult {
    const errorReasons = reasons.filter((r) => r.severity !== "warning");
    const isEligible = errorReasons.length === 0;
    const status = isEligible
      ? "eligible"
      : reasons.some((r) => r.severity === "warning") && errorReasons.length === 0
        ? "conditional"
        : "ineligible";

    return {
      employeeId: record.employeeId ?? "",
      recipient: record.recipient ?? "",
      isEligible,
      status,
      reasons,
      primaryReasonCode: errorReasons.length > 0 ? errorReasons[0].code : undefined,
      evaluatedAt,
    };
  }

  private resolveReferenceTimestamp(ref?: number | Date): number {
    if (ref === undefined) return Date.now();
    if (typeof ref === "number") return ref;
    if (ref instanceof Date) return ref.getTime();
    return Date.now();
  }
}

// ── Functional Helper Convenience Exports ───────────────────────────────────

/**
 * Evaluates an employee record for payroll eligibility.
 */
export function evaluateEmployeeEligibility(
  record: EmployeeEligibilityRecord,
  options?: EligibilityEvaluationOptions
): EmployeeEligibilityResult {
  return new EmployeeEligibilityEvaluator(options).evaluate(record);
}

/**
 * Evaluates an employee record for payroll eligibility asynchronously.
 */
export async function evaluateEmployeeEligibilityAsync(
  record: EmployeeEligibilityRecord,
  options?: EligibilityEvaluationOptions
): Promise<EmployeeEligibilityResult> {
  return new EmployeeEligibilityEvaluator(options).evaluateAsync(record);
}

/**
 * Evaluates a batch of employee records for payroll eligibility.
 */
export function evaluateBatchEligibility(
  records: EmployeeEligibilityRecord[],
  options?: EligibilityEvaluationOptions
): BatchEligibilityResult {
  return new EmployeeEligibilityEvaluator(options).evaluateBatch(records);
}

/**
 * Evaluates a batch of employee records for payroll eligibility asynchronously.
 */
export async function evaluateBatchEligibilityAsync(
  records: EmployeeEligibilityRecord[],
  options?: EligibilityEvaluationOptions
): Promise<BatchEligibilityResult> {
  return new EmployeeEligibilityEvaluator(options).evaluateBatchAsync(records);
}

/**
 * Filters a list of employee records to only those eligible for payroll processing.
 */
export function filterEligibleEmployees(
  records: EmployeeEligibilityRecord[],
  options?: EligibilityEvaluationOptions
): EmployeeEligibilityRecord[] {
  return new EmployeeEligibilityEvaluator(options).filterEligible(records);
}

/**
 * Filters a list of employee records asynchronously.
 */
export async function filterEligibleEmployeesAsync(
  records: EmployeeEligibilityRecord[],
  options?: EligibilityEvaluationOptions
): Promise<EmployeeEligibilityRecord[]> {
  return new EmployeeEligibilityEvaluator(options).filterEligibleAsync(records);
}

/**
 * Returns true if the employee record is eligible for payroll resolution.
 */
export function isEmployeeEligible(
  record: EmployeeEligibilityRecord,
  options?: EligibilityEvaluationOptions
): boolean {
  return evaluateEmployeeEligibility(record, options).isEligible;
}

/**
 * Returns true if the employee record is eligible for payroll resolution (async).
 */
export async function isEmployeeEligibleAsync(
  record: EmployeeEligibilityRecord,
  options?: EligibilityEvaluationOptions
): Promise<boolean> {
  const result = await evaluateEmployeeEligibilityAsync(record, options);
  return result.isEligible;
}

/**
 * Asserts that an employee record is eligible, throwing `IneligibleEmployeeError` if not.
 */
export function assertEmployeeEligible(
  record: EmployeeEligibilityRecord,
  options?: EligibilityEvaluationOptions
): EmployeeEligibilityResult {
  return new EmployeeEligibilityEvaluator(options).assertEligible(record);
}

/**
 * Asserts that all employee records in a batch are eligible, throwing `BatchEligibilityError` if not.
 */
export function assertBatchEligible(
  records: EmployeeEligibilityRecord[],
  options?: EligibilityEvaluationOptions
): BatchEligibilityResult {
  return new EmployeeEligibilityEvaluator(options).assertBatchEligible(records);
}
