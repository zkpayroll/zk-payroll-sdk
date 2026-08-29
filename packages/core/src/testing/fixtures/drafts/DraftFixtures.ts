/**
 * Payroll Draft Test Fixtures
 *
 * Provides realistic valid, invalid, and mixed payroll drafts for testing.
 */

import { PayrollDraftData, PayrollDraftRecord, RedactionPolicy } from "../../../validation/types";

/**
 * Helper to create a valid payroll draft record.
 */
function createRecord(overrides?: Partial<PayrollDraftRecord>): PayrollDraftRecord {
  return {
    employeeId: "alice@company.com",
    employeeName: "Alice Johnson",
    amount: 5000000000n, // 500 XLM in stroops
    asset: "native",
    period: "2024-01",
    department: "Engineering",
    requiresApproval: false,
    isApproved: true,
    ...overrides,
  };
}

/**
 * Helper to create a valid payroll draft.
 */
function createDraft(overrides?: Partial<PayrollDraftData>): PayrollDraftData {
  return {
    draftId: "draft_001_valid",
    employer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
    period: "2024-01",
    records: [
      createRecord({ employeeId: "alice@company.com", amount: 5000000000n }),
      createRecord({ employeeId: "bob@company.com", amount: 3000000000n }),
      createRecord({ employeeId: "charlie@company.com", amount: 4500000000n }),
    ],
    metadata: { source: "csv_import", version: "1.0" },
    ...overrides,
  };
}

/**
 * Valid payroll draft with 3 employees.
 * Note: Under strict validation, this draft has a missing required approval
 * to test that strict mode catches all issues.
 */
export const ValidPayrollDraft = createDraft({
  records: [
    createRecord({
      employeeId: "alice@company.com",
      amount: 5000000000n,
      requiresApproval: true,
      isApproved: false,
    }),
    createRecord({ employeeId: "bob@company.com", amount: 3000000000n }),
    createRecord({ employeeId: "charlie@company.com", amount: 4500000000n }),
  ],
});

/**
 * Valid payroll draft with zero amounts (allowed by default).
 */
export const ValidDraftWithZeroAmounts = createDraft({
  draftId: "draft_zero_amounts",
  records: [
    createRecord({ employeeId: "alice@company.com", amount: 0n }),
    createRecord({ employeeId: "bob@company.com", amount: 5000000000n }),
  ],
});

/**
 * Valid payroll draft with multiple assets.
 */
export const ValidDraftWithMultipleAssets = createDraft({
  draftId: "draft_multi_asset",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      asset: "native",
      amount: 5000000000n,
    }),
    createRecord({
      employeeId: "bob@company.com",
      asset: "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: 1000000n,
    }),
  ],
});

/**
 * Valid payroll draft with approval requirements.
 */
export const ValidDraftWithApprovals = createDraft({
  draftId: "draft_with_approvals",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      requiresApproval: true,
      isApproved: true,
      approvalMetadata: { approver: "manager@company.com", approvedAt: Date.now() },
    }),
    createRecord({
      employeeId: "bob@company.com",
      requiresApproval: false,
      isApproved: false,
    }),
  ],
});

/**
 * Valid payroll draft with redaction policy applied.
 */
export const ValidDraftWithRedaction = createDraft({
  draftId: "draft_with_redaction",
  records: [
    createRecord({
      employeeId: "[REDACTED]_1",
      employeeName: "[REDACTED]",
      amount: 5000000000n,
    }),
    createRecord({
      employeeId: "[REDACTED]_2",
      employeeName: "[REDACTED]",
      amount: 3000000000n,
    }),
  ],
  redactionPolicy: {
    redactEmployeeNames: true,
    redactAmounts: false,
    redactEmployeeIds: true,
    redactNotes: true,
  },
});

/**
 * Large valid draft with 500 records.
 */
export const ValidDraftLarge = createDraft({
  draftId: "draft_large_500",
  records: Array.from({ length: 500 }, (_, i) => {
    const id = i + 1;
    return createRecord({
      employeeId: `emp_${String(id).padStart(6, "0")}@company.com`,
      amount: BigInt((1000 + (i % 9000)) * 1000000), // Vary amounts
      department: ["Engineering", "Sales", "HR", "Finance"][i % 4],
    });
  }),
});

// ──────────────────────────────────────────────────────────────────────
// INVALID DRAFTS - Structure Issues
// ──────────────────────────────────────────────────────────────────────

/**
 * Invalid: Missing draftId.
 */
export const InvalidDraftMissingId = {
  draftId: "",
  employer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  createdAt: Date.now(),
  lastModifiedAt: Date.now(),
  period: "2024-01",
  records: [createRecord()],
} as PayrollDraftData;

/**
 * Invalid: Missing employer.
 */
export const InvalidDraftMissingEmployer = createDraft({
  draftId: "draft_no_employer",
  employer: "",
});

/**
 * Invalid: Invalid employer address format.
 */
export const InvalidDraftBadEmployer = createDraft({
  draftId: "draft_bad_employer",
  employer: "invalid-address",
});

/**
 * Invalid: Empty records array.
 */
export const InvalidDraftEmptyRecords = createDraft({
  draftId: "draft_empty",
  records: [],
});

/**
 * Invalid: Too many records (exceeds typical limits).
 */
export const InvalidDraftTooManyRecords = createDraft({
  draftId: "draft_too_many",
  records: Array.from({ length: 100001 }, (_, i) =>
    createRecord({ employeeId: `emp_${i}@company.com` })
  ),
});

// ──────────────────────────────────────────────────────────────────────
// INVALID DRAFTS - Employee Data Issues
// ──────────────────────────────────────────────────────────────────────

/**
 * Invalid: Missing employee ID.
 */
export const InvalidDraftMissingEmployeeId = createDraft({
  draftId: "draft_no_emp_id",
  records: [createRecord({ employeeId: "" }), createRecord({ employeeId: "bob@company.com" })],
});

/**
 * Invalid: Bad employee ID format.
 */
export const InvalidDraftBadEmployeeId = createDraft({
  draftId: "draft_bad_emp_id",
  records: [
    createRecord({ employeeId: "valid@company.com" }),
    createRecord({ employeeId: "!@#$%^&*()" }), // Invalid characters
  ],
});

// ──────────────────────────────────────────────────────────────────────
// INVALID DRAFTS - Asset Issues
// ──────────────────────────────────────────────────────────────────────

/**
 * Invalid: Missing asset.
 */
export const InvalidDraftMissingAsset = createDraft({
  draftId: "draft_no_asset",
  records: [createRecord({ asset: "" }), createRecord({ asset: "native" })],
});

/**
 * Invalid: Bad asset format.
 */
export const InvalidDraftBadAsset = createDraft({
  draftId: "draft_bad_asset",
  records: [createRecord({ asset: "native" }), createRecord({ asset: "invalid-token-format" })],
});

/**
 * Invalid: Unsupported asset type.
 */
export const InvalidDraftUnsupportedAsset = createDraft({
  draftId: "draft_unsupported_asset",
  records: [createRecord({ asset: "XRP" })], // Not a valid Stellar asset format
});

// ──────────────────────────────────────────────────────────────────────
// INVALID DRAFTS - Amount Issues
// ──────────────────────────────────────────────────────────────────────

/**
 * Invalid: Negative amount.
 */
export const InvalidDraftNegativeAmount = createDraft({
  draftId: "draft_negative_amount",
  records: [createRecord({ amount: -1000000000n }), createRecord({ amount: 5000000000n })],
});

/**
 * Invalid: Amount exceeds maximum (strict config).
 */
export const InvalidDraftAmountTooLarge = createDraft({
  draftId: "draft_amount_too_large",
  records: [
    createRecord({ amount: 999999999999999999999n }), // Extremely large
  ],
});

// ──────────────────────────────────────────────────────────────────────
// INVALID DRAFTS - Period Issues
// ──────────────────────────────────────────────────────────────────────

/**
 * Invalid: Missing period.
 */
export const InvalidDraftMissingPeriod = createDraft({
  draftId: "draft_no_period",
  records: [createRecord({ period: "" }), createRecord({ period: "2024-01" })],
});

/**
 * Invalid: Bad period format.
 */
export const InvalidDraftBadPeriod = createDraft({
  draftId: "draft_bad_period",
  records: [
    createRecord({ period: "2024-01" }),
    createRecord({ period: "01/2024" }), // Wrong format
  ],
});

/**
 * Invalid: Future period.
 */
export const InvalidDraftFuturePeriod = createDraft({
  draftId: "draft_future_period",
  period: "2099-12",
  records: [createRecord({ period: "2099-12" })],
});

// ──────────────────────────────────────────────────────────────────────
// INVALID DRAFTS - Duplicate Issues
// ──────────────────────────────────────────────────────────────────────

/**
 * Invalid: Duplicate employee in same period.
 */
export const InvalidDraftDuplicateEmployee = createDraft({
  draftId: "draft_duplicate",
  records: [
    createRecord({ employeeId: "alice@company.com", amount: 5000000000n }),
    createRecord({ employeeId: "bob@company.com", amount: 3000000000n }),
    createRecord({ employeeId: "alice@company.com", amount: 2000000000n }), // Duplicate
  ],
});

/**
 * Invalid: Multiple duplicates.
 */
export const InvalidDraftMultipleDuplicates = createDraft({
  draftId: "draft_multi_duplicate",
  records: [
    createRecord({ employeeId: "alice@company.com" }),
    createRecord({ employeeId: "alice@company.com" }), // Duplicate
    createRecord({ employeeId: "bob@company.com" }),
    createRecord({ employeeId: "bob@company.com" }), // Duplicate
  ],
});

// ──────────────────────────────────────────────────────────────────────
// INVALID DRAFTS - Approval Issues
// ──────────────────────────────────────────────────────────────────────

/**
 * Invalid: Missing required approval.
 */
export const InvalidDraftMissingApproval = createDraft({
  draftId: "draft_no_approval",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      requiresApproval: true,
      isApproved: false, // Missing approval
    }),
    createRecord({
      employeeId: "bob@company.com",
      requiresApproval: false,
      isApproved: false,
    }),
  ],
});

/**
 * Invalid: Bad approval metadata.
 */
export const InvalidDraftBadApprovalMetadata = createDraft({
  draftId: "draft_bad_approval_meta",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      requiresApproval: true,
      isApproved: true,
      approvalMetadata: { approver: null }, // Invalid: null value
    }),
  ],
});

// ──────────────────────────────────────────────────────────────────────
// INVALID DRAFTS - Redaction Issues
// ──────────────────────────────────────────────────────────────────────

/**
 * Invalid: Sensitive data not redacted when policy requires it.
 */
export const InvalidDraftRedactionViolation = createDraft({
  draftId: "draft_redaction_violation",
  records: [
    createRecord({
      employeeId: "alice@company.com", // Not redacted
      employeeName: "Alice Johnson", // Not redacted
    }),
  ],
  redactionPolicy: {
    redactEmployeeNames: true,
    redactAmounts: false,
    redactEmployeeIds: true,
    redactNotes: true,
  },
});

// ──────────────────────────────────────────────────────────────────────
// MIXED DRAFTS - Valid with warnings
// ──────────────────────────────────────────────────────────────────────

/**
 * Mixed: Valid structure but with some unusual amounts (warnings).
 * Also has a redaction policy violation and missing approval for strict mode testing.
 */
export const MixedDraftWithWarnings = createDraft({
  draftId: "draft_mixed_warnings",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      amount: 5000000000n,
      requiresApproval: true,
      isApproved: false,
    }), // Missing approval (blocker in strict)
    createRecord({ employeeId: "bob@company.com", amount: 1000n }), // Very small (warning if minAmount > 1000)
    createRecord({ employeeId: "charlie@company.com", amount: 999999999999n }), // Large
  ],
  redactionPolicy: {
    redactEmployeeNames: true,
    redactAmounts: false,
    redactEmployeeIds: true,
    redactNotes: true,
  },
});

/**
 * Mixed: Valid with some records having missing optional fields.
 */
export const MixedDraftWithPartialData = createDraft({
  draftId: "draft_partial_data",
  records: [
    createRecord({ employeeId: "alice@company.com", department: "Engineering" }),
    createRecord({ employeeId: "bob@company.com", department: undefined }),
    createRecord({
      employeeId: "charlie@company.com",
      employeeName: undefined,
      department: undefined,
    }),
  ],
});

/**
 * Mixed: Valid with some records requiring approval and some not.
 */
export const MixedDraftApprovalStates = createDraft({
  draftId: "draft_mixed_approval",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      requiresApproval: true,
      isApproved: true,
    }),
    createRecord({
      employeeId: "bob@company.com",
      requiresApproval: false,
      isApproved: false,
    }),
    createRecord({
      employeeId: "charlie@company.com",
      requiresApproval: true,
      isApproved: true,
    }),
  ],
});

/**
 * Mixed: Valid draft covering a different period with redaction.
 */
export const MixedDraftDifferentPeriod = createDraft({
  draftId: "draft_2024_02",
  period: "2024-02",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      period: "2024-02",
      amount: 5500000000n,
    }),
    createRecord({
      employeeId: "bob@company.com",
      period: "2024-02",
      amount: 3000000000n,
    }),
  ],
  redactionPolicy: {
    redactEmployeeNames: true,
    redactAmounts: true,
    redactEmployeeIds: false,
    redactNotes: false,
  },
});

// ──────────────────────────────────────────────────────────────────────
// Edge Cases
// ──────────────────────────────────────────────────────────────────────

/**
 * Edge case: Single record draft.
 */
export const EdgeCaseSingleRecord = createDraft({
  draftId: "draft_single",
  records: [createRecord({ employeeId: "alice@company.com" })],
});

/**
 * Edge case: Maximum allowed record count (10,000).
 */
export const EdgeCaseMaxRecords = createDraft({
  draftId: "draft_max",
  records: Array.from({ length: 10000 }, (_, i) =>
    createRecord({
      employeeId: `emp_${String(i).padStart(5, "0")}@company.com`,
      amount: BigInt(1000000000 + i),
    })
  ),
});

/**
 * Edge case: Very large single amount.
 */
export const EdgeCaseVeryLargeAmount = createDraft({
  draftId: "draft_huge_amount",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      amount: 922337203685n, // Near max int64
    }),
  ],
});

/**
 * Edge case: Special characters in optional fields.
 */
export const EdgeCaseSpecialCharacters = createDraft({
  draftId: "draft_special_chars",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      employeeName: "Alice O'Brien-Smith",
      department: "R&D/Engineering",
      notes: "Payment for Q1 2024; includes bonus & taxes",
    }),
  ],
});

/**
 * Edge case: Different asset types in same draft.
 */
export const EdgeCaseMixedAssetTypes = createDraft({
  draftId: "draft_mixed_assets",
  records: [
    createRecord({
      employeeId: "alice@company.com",
      asset: "native",
      amount: 5000000000n,
    }),
    createRecord({
      employeeId: "bob@company.com",
      asset: "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: 1000000n,
    }),
    createRecord({
      employeeId: "charlie@company.com",
      asset: "CDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: 500000n,
    }),
  ],
});
