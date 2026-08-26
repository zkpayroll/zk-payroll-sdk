/**
 * Offline Payroll Draft Validator
 *
 * Validates payroll drafts without network access.
 * Checks employee data, assets, amounts, periods, duplicates, redaction, and approvals.
 */

import {
  PayrollDraftData,
  PayrollDraftRecord,
  ValidationConfig,
  ValidationIssue,
  DraftValidationResult,
  DefaultValidationConfig,
  ValidationErrorCodes,
  ValidationPresets,
  ValidationIssueCategory,
} from "./types";

/**
 * OfflineDraftValidator performs comprehensive validation on payroll drafts
 * without requiring network access or contract calls.
 */
export class OfflineDraftValidator {
  private config: ValidationConfig;

  constructor(config?: ValidationConfig) {
    this.config = { ...DefaultValidationConfig, ...config };
  }

  /**
   * Validate a payroll draft offline.
   *
   * @param draft — The payroll draft to validate
   * @returns Validation result with blockers and warnings
   */
  validate(draft: PayrollDraftData): DraftValidationResult {
    const startTime = Date.now();
    const blockers: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const validRecordIndices = new Set<number>();

    try {
      // Check draft structure
      const structureIssues = this.validateStructure(draft);
      blockers.push(...structureIssues.filter((i) => i.severity === "blocker"));
      warnings.push(...structureIssues.filter((i) => i.severity === "warning"));

      // If there are structure blockers, can't continue validating records
      if (blockers.some((i) => i.category === "structure")) {
        const duration = Date.now() - startTime;
        return this.buildResult(draft, blockers, warnings, validRecordIndices, duration);
      }

      // Validate records
      for (let i = 0; i < draft.records.length; i++) {
        const record = draft.records[i]!;
        const recordIssues = this.validateRecord(record, i, draft);

        const recordBlockers = recordIssues.filter((issue) => issue.severity === "blocker");
        const recordWarnings = recordIssues.filter((issue) => issue.severity === "warning");

        blockers.push(...recordBlockers);
        warnings.push(...recordWarnings);

        if (recordBlockers.length === 0) {
          validRecordIndices.add(i);
        }
      }

      // Check for duplicates across all records
      if (this.config.checkDuplicates) {
        const duplicateIssues = this.checkDuplicates(draft);
        blockers.push(...duplicateIssues.filter((i) => i.severity === "blocker"));
        warnings.push(...duplicateIssues.filter((i) => i.severity === "warning"));
      }

      // Run custom validators
      if (this.config.customValidators) {
        for (const validator of this.config.customValidators) {
          try {
            const customIssues = validator(draft);
            blockers.push(...customIssues.filter((i) => i.severity === "blocker"));
            warnings.push(...customIssues.filter((i) => i.severity === "warning"));
          } catch (error) {
            blockers.push({
              severity: "blocker",
              category: "other",
              message: `Custom validator failed: ${error instanceof Error ? error.message : String(error)}`,
              code: ValidationErrorCodes.INTERNAL_VALIDATION_ERROR,
            });
          }
        }
      }

      const duration = Date.now() - startTime;
      return this.buildResult(draft, blockers, warnings, validRecordIndices, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      blockers.push({
        severity: "blocker",
        category: "other",
        message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
        code: ValidationErrorCodes.INTERNAL_VALIDATION_ERROR,
      });
      return this.buildResult(draft, blockers, warnings, validRecordIndices, duration);
    }
  }

  /**
   * Validate draft structure (ID, employer, metadata).
   *
   * @private
   */
  private validateStructure(draft: PayrollDraftData): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check required fields
    if (!draft.draftId || draft.draftId.trim().length === 0) {
      issues.push({
        severity: "blocker",
        category: "structure",
        message: "Draft must have a valid draftId",
        code: ValidationErrorCodes.MISSING_DRAFT_ID,
      });
    }

    if (!draft.employer || !this.isValidStellarAddress(draft.employer)) {
      issues.push({
        severity: "blocker",
        category: "structure",
        message: "Draft must have a valid employer Stellar address",
        code: ValidationErrorCodes.MISSING_EMPLOYER,
      });
    }

    if (!Array.isArray(draft.records)) {
      issues.push({
        severity: "blocker",
        category: "structure",
        message: "Draft records must be an array",
        code: ValidationErrorCodes.EMPTY_DRAFT,
      });
      return issues;
    }

    if (draft.records.length === 0) {
      issues.push({
        severity: "blocker",
        category: "structure",
        message: "Draft cannot be empty",
        code: ValidationErrorCodes.EMPTY_DRAFT,
      });
    }

    if (this.config.maxRecordsPerDraft && draft.records.length > this.config.maxRecordsPerDraft) {
      issues.push({
        severity: "blocker",
        category: "structure",
        message: `Draft exceeds maximum of ${this.config.maxRecordsPerDraft} records`,
        code: ValidationErrorCodes.TOO_MANY_RECORDS,
        relatedData: { recordCount: draft.records.length, max: this.config.maxRecordsPerDraft },
      });
    }

    return issues;
  }

  /**
   * Validate a single payroll record.
   *
   * @private
   */
  private validateRecord(
    record: PayrollDraftRecord,
    index: number,
    draft: PayrollDraftData
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Validate employee ID
    if (this.config.validateEmployeeData) {
      if (!record.employeeId || record.employeeId.trim().length === 0) {
        issues.push({
          severity: "blocker",
          category: "employee_data",
          message: "Employee ID is required",
          recordIndex: index,
          field: "employeeId",
          code: ValidationErrorCodes.MISSING_EMPLOYEE_ID,
        });
      } else if (!this.isValidEmployeeId(record.employeeId)) {
        issues.push({
          severity: "warning",
          category: "employee_data",
          message: `Invalid employee ID format: ${this.redact(record.employeeId, draft)}`,
          recordIndex: index,
          field: "employeeId",
          code: ValidationErrorCodes.INVALID_EMPLOYEE_ID,
        });
      }
    }

    // Validate asset
    if (this.config.validateAssetFormat) {
      if (!record.asset || record.asset.trim().length === 0) {
        issues.push({
          severity: "blocker",
          category: "asset_format",
          message: "Asset is required",
          recordIndex: index,
          field: "asset",
          code: ValidationErrorCodes.MISSING_ASSET,
        });
      } else if (!this.isValidAsset(record.asset)) {
        issues.push({
          severity: "blocker",
          category: "asset_format",
          message: `Invalid asset format: ${record.asset}`,
          recordIndex: index,
          field: "asset",
          code: ValidationErrorCodes.INVALID_ASSET_FORMAT,
          suggestedFix: "Asset should be 'native' or a valid token contract address",
        });
      }
    }

    // Validate amount
    if (this.config.validateAmounts) {
      const amountIssues = this.validateAmount(record.amount, index, draft);
      issues.push(...amountIssues);
    }

    // Validate period
    if (this.config.validatePeriod) {
      if (!record.period || record.period.trim().length === 0) {
        issues.push({
          severity: "blocker",
          category: "period",
          message: "Period is required",
          recordIndex: index,
          field: "period",
          code: ValidationErrorCodes.MISSING_PERIOD,
        });
      } else if (!this.isValidPeriod(record.period)) {
        issues.push({
          severity: "blocker",
          category: "period",
          message: `Invalid period format: ${record.period}`,
          recordIndex: index,
          field: "period",
          code: ValidationErrorCodes.INVALID_PERIOD_FORMAT,
          suggestedFix: "Period should be in YYYY-MM format (e.g., 2024-01)",
        });
      }
    }

    // Validate approvals
    if (this.config.validateApprovals && record.requiresApproval) {
      if (!record.isApproved && !this.config.allowMissingApprovals) {
        issues.push({
          severity: "blocker",
          category: "approval",
          message: "Record requires approval but is not approved",
          recordIndex: index,
          field: "isApproved",
          code: ValidationErrorCodes.MISSING_REQUIRED_APPROVAL,
        });
      }
    }

    // Validate redaction
    if (this.config.validateRedaction && draft.redactionPolicy) {
      const redactionIssues = this.validateRedaction(record, index, draft);
      issues.push(...redactionIssues);
    }

    return issues;
  }

  /**
   * Validate payment amount.
   *
   * @private
   */
  private validateAmount(
    amount: bigint,
    recordIndex: number,
    draft: PayrollDraftData
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (amount < 0n) {
      issues.push({
        severity: "blocker",
        category: "amount",
        message: "Amount cannot be negative",
        recordIndex,
        field: "amount",
        code: ValidationErrorCodes.NEGATIVE_AMOUNT,
      });
      return issues;
    }

    if (amount === 0n && !this.config.allowZeroAmounts) {
      issues.push({
        severity: "blocker",
        category: "amount",
        message: "Zero amounts are not allowed",
        recordIndex,
        field: "amount",
        code: ValidationErrorCodes.ZERO_AMOUNT_NOT_ALLOWED,
      });
    }

    if (this.config.minAmount !== undefined && amount > 0n && amount < this.config.minAmount) {
      issues.push({
        severity: "warning",
        category: "amount",
        message: `Amount ${this.redact(amount.toString(), draft)} is below minimum ${this.config.minAmount}`,
        recordIndex,
        field: "amount",
        code: ValidationErrorCodes.AMOUNT_BELOW_MIN,
      });
    }

    if (this.config.maxAmount !== undefined && amount > this.config.maxAmount) {
      issues.push({
        severity: "blocker",
        category: "amount",
        message: `Amount exceeds maximum of ${this.config.maxAmount}`,
        recordIndex,
        field: "amount",
        code: ValidationErrorCodes.AMOUNT_EXCEEDS_MAX,
      });
    }

    return issues;
  }

  /**
   * Validate redaction policy compliance.
   *
   * @private
   */
  private validateRedaction(
    record: PayrollDraftRecord,
    recordIndex: number,
    draft: PayrollDraftData
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const policy = draft.redactionPolicy;

    if (!policy) return issues;

    // Check employee names
    if (policy.redactEmployeeNames && record.employeeName) {
      if (!this.isRedacted(record.employeeName)) {
        issues.push({
          severity: "warning",
          category: "redaction",
          message: "Employee names should be redacted per policy",
          recordIndex,
          field: "employeeName",
          code: ValidationErrorCodes.REDACTION_POLICY_VIOLATION,
          suggestedFix: "Enable name redaction or update policy",
        });
      }
    }

    // Check amounts
    if (policy.redactAmounts) {
      if (!this.isRedacted(record.amount.toString())) {
        issues.push({
          severity: "warning",
          category: "redaction",
          message: "Amounts should be redacted per policy",
          recordIndex,
          field: "amount",
          code: ValidationErrorCodes.REDACTION_POLICY_VIOLATION,
        });
      }
    }

    // Check employee IDs
    if (policy.redactEmployeeIds && record.employeeId) {
      if (!this.isRedacted(record.employeeId)) {
        issues.push({
          severity: "warning",
          category: "redaction",
          message: "Employee IDs should be redacted per policy",
          recordIndex,
          field: "employeeId",
          code: ValidationErrorCodes.REDACTION_POLICY_VIOLATION,
        });
      }
    }

    // Check notes
    if (policy.redactNotes && record.notes) {
      if (!this.isRedacted(record.notes)) {
        issues.push({
          severity: "warning",
          category: "redaction",
          message: "Notes should be redacted per policy",
          recordIndex,
          field: "notes",
          code: ValidationErrorCodes.REDACTION_POLICY_VIOLATION,
        });
      }
    }

    return issues;
  }

  /**
   * Check for duplicate records.
   *
   * @private
   */
  private checkDuplicates(draft: PayrollDraftData): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const seen = new Map<string, number>();

    for (let i = 0; i < draft.records.length; i++) {
      const record = draft.records[i]!;
      if (this.isRedacted(record.employeeId)) continue;
      const key = `${record.employeeId}:${record.asset}:${record.period}`;

      if (seen.has(key)) {
        const originalIndex = seen.get(key)!;
        issues.push({
          severity: "blocker",
          category: "duplicate",
          message: `Duplicate record for employee in period (also at row ${originalIndex + 1})`,
          recordIndex: i,
          code: ValidationErrorCodes.DUPLICATE_EMPLOYEE_IN_PERIOD,
          relatedData: { duplicateRowIndex: originalIndex + 1 },
        });
      } else {
        seen.set(key, i);
      }
    }

    return issues;
  }

  /**
   * Build validation result.
   *
   * @private
   */
  private buildResult(
    draft: PayrollDraftData,
    blockers: ValidationIssue[],
    warnings: ValidationIssue[],
    validRecordIndices: Set<number>,
    durationMs: number
  ): DraftValidationResult {
    const totalRecords = draft?.records?.length ?? 0;
    const recordsWithIssues = Math.max(0, totalRecords - validRecordIndices.size);

    return {
      isValid: blockers.length === 0,
      isReadyToSubmit: blockers.length === 0 && warnings.length < 5, // Arbitrary threshold
      blockers,
      warnings,
      summary: {
        totalRecords,
        validRecords: validRecordIndices.size,
        recordsWithIssues,
        totalBlockers: blockers.length,
        totalWarnings: warnings.length,
      },
      validatedAt: Date.now(),
      validationDurationMs: Math.max(1, durationMs),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helper methods
  // ──────────────────────────────────────────────────────────────────────

  private isValidStellarAddress(address: string): boolean {
    if (!address) return false;
    return (
      /^G[A-Z2-7]{55}$/.test(address) ||
      /^C[A-Z2-7]{55}$/.test(address) ||
      (address.length >= 56 && /^[A-Za-z0-9]+$/.test(address))
    );
  }

  private isValidEmployeeId(id: string): boolean {
    if (!id) return false;
    return this.isRedacted(id) || /^[A-Za-z0-9\-._@\[\]]{3,256}$/.test(id);
  }

  private isValidAsset(asset: string): boolean {
    if (!asset) return false;
    if (asset === "native") return true;
    return asset.startsWith("C") && asset.length >= 56;
  }

  private isValidPeriod(period: string): boolean {
    // YYYY-MM format
    return /^\d{4}-\d{2}$/.test(period);
  }

  private isRedacted(value: string): boolean {
    // Check if value looks redacted (e.g., contains [REDACTED] or similar)
    return value.includes("[REDACTED]") || value.includes("***") || value === "REDACTED";
  }

  private redact(value: string, draft: PayrollDraftData): string {
    const policy = draft.redactionPolicy;
    if (!policy) return value;

    // Simple redaction: show first and last 3 chars if > 6 chars
    if (value.length > 6) {
      return `${value.substring(0, 3)}...${value.substring(value.length - 3)}`;
    }
    return "***";
  }

  /**
   * Get a validator preconfigured with strict settings.
   *
   * @static
   */
  static strict(): OfflineDraftValidator {
    return new OfflineDraftValidator(ValidationPresets.strict);
  }

  /**
   * Get a validator with standard settings.
   *
   * @static
   */
  static standard(): OfflineDraftValidator {
    return new OfflineDraftValidator(ValidationPresets.standard);
  }

  /**
   * Get a validator with lenient settings.
   *
   * @static
   */
  static lenient(): OfflineDraftValidator {
    return new OfflineDraftValidator(ValidationPresets.lenient);
  }
}
