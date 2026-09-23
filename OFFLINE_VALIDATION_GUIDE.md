# Offline Payroll Draft Validation Guide

**Validate payroll drafts offline without network access.** This guide covers how to use the offline validation suite to catch data issues early, before any RPC calls or contract interactions.

## Why Offline Validation?

- **Catch errors fast** — Find problems locally before attempting expensive contract calls
- **No network required** — Admins can validate payroll offline or in restricted environments
- **Privacy-safe** — Sensitive data can be redacted in logs and outputs
- **Clear feedback** — Separates critical blockers from warnings for actionable debugging

## Quick Start

### Basic validation

```typescript
import { OfflineDraftValidator } from "@zk-payroll/sdk";

const validator = new OfflineDraftValidator();
const result = validator.validate(payrollDraft);

if (result.isValid) {
  console.log("✓ Draft is ready for processing");
} else {
  console.log("✗ Fix these issues:");
  result.blockers.forEach((b) => console.log(`  - ${b.message}`));
}
```

### Using presets

Three presets are available for different validation strictness:

```typescript
// Strict: catches all potential issues
const strict = OfflineDraftValidator.strict();
const result1 = strict.validate(draft);

// Standard: catches obvious issues (default)
const standard = OfflineDraftValidator.standard();
const result2 = standard.validate(draft);

// Lenient: catches only critical issues
const lenient = OfflineDraftValidator.lenient();
const result3 = lenient.validate(draft);
```

### Custom validation config

```typescript
const validator = new OfflineDraftValidator({
  validateEmployeeData: true,
  validateAssetFormat: true,
  validateAmounts: true,
  validatePeriod: true,
  checkDuplicates: true,
  validateRedaction: true,
  validateApprovals: true,
  minAmount: 1_000_000n, // 0.1 XLM in stroops
  maxAmount: 10_000_000_000_000n, // 1M XLM
  maxRecordsPerDraft: 50_000,
  allowZeroAmounts: false,
  allowMissingApprovals: false,
});

const result = validator.validate(draft);
```

## Understanding Validation Results

Each validation returns a `DraftValidationResult`:

```typescript
interface DraftValidationResult {
  // Overall status
  isValid: boolean; // No blockers
  isReadyToSubmit: boolean; // No blockers, few warnings

  // Issues by severity
  blockers: ValidationIssue[]; // Must fix
  warnings: ValidationIssue[]; // Should review

  // Summary stats
  summary: {
    totalRecords: number;
    validRecords: number;
    recordsWithIssues: number;
    totalBlockers: number;
    totalWarnings: number;
  };

  // Timing
  validatedAt: number; // Timestamp
  validationDurationMs: number; // How long validation took
}
```

### Blockers vs Warnings

- **Blockers** — Must be fixed before processing (e.g., missing required fields, duplicates)
- **Warnings** — Should be reviewed but don't prevent processing (e.g., unusual amounts, formatting issues)

```typescript
const result = validator.validate(draft);

// Fix all blockers
if (result.blockers.length > 0) {
  console.error("Critical issues:");
  result.blockers.forEach((b) => {
    console.error(`  [${b.code}] ${b.message}`);
    if (b.suggestedFix) console.error(`  Fix: ${b.suggestedFix}`);
    if (b.recordIndex !== undefined) {
      console.error(`  At row: ${b.recordIndex + 1}`);
    }
  });
}

// Review warnings
if (result.warnings.length > 0) {
  console.warn("Issues to review:");
  result.warnings.forEach((w) => {
    console.warn(`  [${w.code}] ${w.message}`);
  });
}
```

## What Gets Validated?

### 1. Draft Structure

- **Draft ID** — Must be non-empty
- **Employer** — Must be a valid Stellar address (56 chars starting with G)
- **Records array** — Must exist and be non-empty
- **Record count** — Configurable maximum (default: 100,000)

```typescript
// Example: draft with missing employer
const invalid = {
  draftId: "draft_001",
  employer: "", // ❌ Blocker: Missing employer
  records: [...],
};
```

### 2. Employee Data

- **Employee ID** — Required, alphanumeric format
- **Employee name** — Optional but checked for redaction policy

```typescript
// Example: invalid employee ID format
const record = {
  employeeId: "!@#$%^&*()", // ❌ Warning: Invalid format
  employeeName: "John Doe",
  // ...
};
```

### 3. Asset Format

- **Native** — Standard Stellar native asset ("native")
- **Contract** — Stellar contract address (56 chars starting with C)

```typescript
// Example: valid assets
const valid1 = { asset: "native" }; // ✓
const valid2 = {
  asset:
    "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO5L65ABCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
}; // ✓
const invalid = { asset: "XRP" }; // ❌ Blocker: Invalid format
```

### 4. Payment Amounts

- **Range validation** — Configurable min/max
- **Sign validation** — Negative amounts rejected
- **Zero handling** — Configurable

```typescript
// Example: amount validation
const validator = new OfflineDraftValidator({
  minAmount: 1_000_000n, // Minimum 0.1 XLM
  maxAmount: 1_000_000_000_000n, // Maximum 100k XLM
  allowZeroAmounts: false,
});

const record = {
  amount: 999_999n, // ⚠️ Warning: Below minimum
};
```

### 5. Period Format

- **Format** — YYYY-MM (e.g., 2024-01)
- **Consistency** — Record period should match draft period

```typescript
// Example: period validation
const valid = { period: "2024-01" }; // ✓
const invalid = { period: "01/2024" }; // ❌ Blocker: Wrong format
```

### 6. Duplicate Detection

- **Key** — Employee + asset + period combination
- **Across draft** — Checks entire draft for duplicates

```typescript
// Example: duplicate employee in period
const records = [
  { employeeId: "alice@co.com", asset: "native", period: "2024-01" },
  { employeeId: "alice@co.com", asset: "native", period: "2024-01" }, // ❌ Duplicate
];
```

### 7. Approval Status

- **Required approvals** — Records can require explicit approval
- **Metadata validation** — Approval records must have valid metadata

```typescript
// Example: approval requirements
const record = {
  requiresApproval: true,
  isApproved: false, // ❌ Blocker (unless allowMissingApprovals=true)
};
```

### 8. Redaction Policy

- **Policy types** — Names, amounts, IDs, notes
- **Detection** — Looks for markers like [REDACTED] or \*\*\*

```typescript
// Example: redaction policy
const draft = {
  redactionPolicy: {
    redactEmployeeNames: true,
    redactAmounts: false,
    redactEmployeeIds: true,
    redactNotes: true,
  },
  records: [
    {
      employeeId: "[REDACTED]", // ✓ Follows policy
      employeeName: "John Doe", // ❌ Warning: Should be redacted
    },
  ],
};
```

## Error Codes

Use error codes for programmatic handling:

```typescript
import { ValidationErrorCodes } from "@zk-payroll/sdk";

// Structure
ValidationErrorCodes.MISSING_DRAFT_ID;
ValidationErrorCodes.MISSING_EMPLOYER;
ValidationErrorCodes.EMPTY_DRAFT;
ValidationErrorCodes.TOO_MANY_RECORDS;

// Employee data
ValidationErrorCodes.MISSING_EMPLOYEE_ID;
ValidationErrorCodes.INVALID_EMPLOYEE_ID;

// Assets
ValidationErrorCodes.MISSING_ASSET;
ValidationErrorCodes.INVALID_ASSET_FORMAT;

// Amounts
ValidationErrorCodes.NEGATIVE_AMOUNT;
ValidationErrorCodes.ZERO_AMOUNT_NOT_ALLOWED;
ValidationErrorCodes.AMOUNT_BELOW_MIN;
ValidationErrorCodes.AMOUNT_EXCEEDS_MAX;

// Periods
ValidationErrorCodes.MISSING_PERIOD;
ValidationErrorCodes.INVALID_PERIOD_FORMAT;

// Duplicates
ValidationErrorCodes.DUPLICATE_EMPLOYEE_IN_PERIOD;

// Approvals
ValidationErrorCodes.MISSING_REQUIRED_APPROVAL;

// Redaction
ValidationErrorCodes.REDACTION_POLICY_VIOLATION;
```

## Custom Validators

Add domain-specific validation logic:

```typescript
const validator = new OfflineDraftValidator({
  customValidators: [
    (draft) => {
      const issues = [];

      // Example: ensure all records are from the same department
      const departments = new Set(draft.records.map((r) => r.department));
      if (departments.size > 1) {
        issues.push({
          severity: "warning",
          category: "policy",
          message: "Draft contains records from multiple departments",
          code: "WARN_MULTI_DEPT",
        });
      }

      // Example: ensure total payroll is reasonable
      const total = draft.records.reduce((sum, r) => sum + r.amount, 0n);
      if (total > 100_000_000_000_000n) {
        // > 10M XLM
        issues.push({
          severity: "blocker",
          category: "policy",
          message: "Total payroll exceeds policy maximum",
          code: "ERR_PAYROLL_EXCEEDS_MAX",
        });
      }

      return issues;
    },
  ],
});

const result = validator.validate(draft);
```

## Best Practices

### 1. Validate Early

```typescript
// ✓ Good: validate before any processing
const result = validator.validate(importedDraft);
if (!result.isValid) {
  return handleErrors(result.blockers);
}
// proceed with processing
```

### 2. Handle Blockers and Warnings Separately

```typescript
// ✓ Good: different handling for severity levels
if (result.blockers.length > 0) {
  throw new Error("Cannot process: fix blockers first");
}

if (result.warnings.length > 0) {
  logWarnings(result.warnings);
  // Continue with user confirmation
}
```

### 3. Use Presets for Common Scenarios

```typescript
// ✓ Good: match strictness to use case
if (isInitialImport) {
  // Strict validation for data imports
  validator = OfflineDraftValidator.strict();
} else if (isBatchReview) {
  // Standard for routine reviews
  validator = OfflineDraftValidator.standard();
} else if (isQuickCheck) {
  // Lenient for quick checks
  validator = OfflineDraftValidator.lenient();
}
```

### 4. Provide Clear Feedback

```typescript
// ✓ Good: actionable error messages
result.blockers.forEach((b) => {
  const line = (b.recordIndex ?? -1) + 1;
  console.error(`Row ${line}: ${b.message}`);
  if (b.suggestedFix) console.error(`  → ${b.suggestedFix}`);
});
```

### 5. Log Validation Metrics

```typescript
// ✓ Good: track validation performance
console.log(
  `Validated ${result.summary.totalRecords} records in ${result.validationDurationMs}ms`
);
console.log(
  `Valid: ${result.summary.validRecords}, Issues: ${result.summary.recordsWithIssues}`
);
```

## Redaction Safety

When validating sensitive payroll data:

```typescript
// ✓ Good: apply redaction policy
const draft = {
  redactionPolicy: {
    redactEmployeeNames: true,
    redactAmounts: true,
    redactEmployeeIds: false,
    redactNotes: true,
  },
  records: [
    {
      employeeId: "emp_001",
      employeeName: "[REDACTED]",
      amount: "[REDACTED]",
      notes: "[REDACTED]",
    },
  ],
};

const validator = new OfflineDraftValidator({ validateRedaction: true });
const result = validator.validate(draft);
// Logs will not contain raw sensitive values
```

## Testing Your Validation

Use provided fixtures for testing:

```typescript
import {
  ValidPayrollDraft,
  InvalidDraftDuplicateEmployee,
  InvalidDraftNegativeAmount,
  MixedDraftWithWarnings,
} from "@zk-payroll/sdk/testing";

// Test valid scenarios
const validator = new OfflineDraftValidator();
expect(validator.validate(ValidPayrollDraft).isValid).toBe(true);

// Test error handling
expect(validator.validate(InvalidDraftDuplicateEmployee).isValid).toBe(false);

// Test mixed scenarios
const mixed = validator.validate(MixedDraftWithWarnings);
expect(mixed.blockers.length).toBe(0); // No blockers
expect(mixed.warnings.length).toBeGreaterThan(0); // Some warnings
```

## Performance

Validation is designed for speed and offline use:

- **Small drafts** (<100 records): <10ms
- **Medium drafts** (100-1000 records): <50ms
- **Large drafts** (1000-100,000 records): <500ms

All validation runs locally without network I/O.

## Troubleshooting

### Draft validation is too strict

Reduce strictness using a less strict preset:

```typescript
// Instead of strict
const validator = OfflineDraftValidator.strict();

// Use standard or lenient
const validator = OfflineDraftValidator.standard();
```

Or customize specific validations:

```typescript
const validator = new OfflineDraftValidator({
  validateRedaction: false,
  allowZeroAmounts: true,
});
```

### Missing validation rules

Add custom validators:

```typescript
const validator = new OfflineDraftValidator({
  customValidators: [
    (draft) => {
      // Your custom validation logic
      return [];
    },
  ],
});
```

### Too many warnings

Review and address warnings, or disable non-critical validations:

```typescript
const validator = new OfflineDraftValidator({
  validatePeriod: false,
  checkDuplicates: false,
});
```

## Related Documentation

- [API Reference](./docs/API.md) — Full validation API
- [Error Codes](./docs/ERRORS.md) — Complete error code list
- [Testing](./docs/TESTING.md) — Testing patterns and fixtures
- [Troubleshooting](./docs/TROUBLESHOOTING.md) — Common issues and solutions
