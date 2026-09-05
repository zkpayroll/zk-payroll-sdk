/**
 * Compliance Hold Reason Helpers
 *
 * Provides typed definitions, user-friendly labels, and concise descriptions
 * for supported compliance hold reason codes.
 *
 * ## Why This Matters
 * Dashboard screens, compliance forms, and audit reporters need consistent
 * labels and non-leaking descriptions without hard-coding hold options.
 */

import { HoldReasonCode } from "./types";

/**
 * Category classification for compliance holds.
 */
export type HoldReasonCategory =
  "identity" | "screening" | "tax" | "legal" | "fraud" | "operational" | "other";

/**
 * Metadata definition for a supported compliance hold reason.
 */
export interface HoldReasonDefinition {
  /** Canonical machine-readable reason code */
  code: HoldReasonCode;
  /** Human-readable short title suitable for badges and table cells */
  label: string;
  /** Concise summary explaining why the hold was placed */
  shortDescription: string;
  /** High-level compliance category */
  category: HoldReasonCategory;
}

/**
 * Canonical list of all supported compliance hold reason definitions.
 */
export const SUPPORTED_HOLD_REASONS: readonly HoldReasonDefinition[] = Object.freeze([
  {
    code: "KYC_REVIEW_PENDING",
    label: "KYC Review Pending",
    shortDescription: "Identity verification or AML documentation review is in progress.",
    category: "identity",
  },
  {
    code: "SANCTIONS_SCREENING",
    label: "Sanctions Screening",
    shortDescription: "Watchlist or sanctions compliance check required prior to disbursement.",
    category: "screening",
  },
  {
    code: "TAX_WITHHOLDING_DISCREPANCY",
    label: "Tax Withholding Discrepancy",
    shortDescription: "Discrepancy identified in required tax calculations or withholdings.",
    category: "tax",
  },
  {
    code: "REGULATORY_INVESTIGATION",
    label: "Regulatory Investigation",
    shortDescription: "Pending review under applicable financial or labor regulations.",
    category: "legal",
  },
  {
    code: "DUPLICATE_PAYMENT_SUSPECTED",
    label: "Duplicate Payment Suspected",
    shortDescription: "Potential duplicate disbursement or overlapping batch detected.",
    category: "fraud",
  },
  {
    code: "MANUAL_REVIEW_REQUESTED",
    label: "Manual Review Requested",
    shortDescription: "Manual compliance officer review requested before execution.",
    category: "operational",
  },
  {
    code: "OTHER",
    label: "Other Compliance Reason",
    shortDescription: "Hold placed for administrative or miscellaneous compliance requirements.",
    category: "other",
  },
]);

/**
 * Lookup map keyed by HoldReasonCode for O(1) metadata access.
 */
export const HOLD_REASON_DEFINITIONS_MAP: Record<HoldReasonCode, HoldReasonDefinition> =
  Object.freeze(
    SUPPORTED_HOLD_REASONS.reduce(
      (acc, item) => {
        acc[item.code] = item;
        return acc;
      },
      {} as Record<HoldReasonCode, HoldReasonDefinition>
    )
  );

/**
 * Check whether a value is a valid, supported HoldReasonCode.
 *
 * @param code - Value to test.
 * @returns True if code is a supported HoldReasonCode.
 */
export function isSupportedHoldReasonCode(code: unknown): code is HoldReasonCode {
  if (typeof code !== "string") {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(HOLD_REASON_DEFINITIONS_MAP, code);
}

/**
 * Retrieve the full metadata definition for a given hold reason code.
 *
 * @param code - Hold reason code or string.
 * @returns HoldReasonDefinition or undefined if unknown.
 */
export function getHoldReasonDefinition(
  code: HoldReasonCode | string
): HoldReasonDefinition | undefined {
  if (isSupportedHoldReasonCode(code)) {
    return HOLD_REASON_DEFINITIONS_MAP[code];
  }
  return undefined;
}

/**
 * Retrieve the human-friendly display label for a hold reason code.
 *
 * @param code - Hold reason code.
 * @returns Human-readable label (e.g. "KYC Review Pending"), or raw code if unrecognized.
 */
export function getHoldReasonLabel(code: HoldReasonCode | string): string {
  const def = getHoldReasonDefinition(code);
  return def ? def.label : String(code);
}

/**
 * Retrieve the short description explaining a hold reason code.
 *
 * @param code - Hold reason code.
 * @returns Concise description, or fallback text if unrecognized.
 */
export function getHoldReasonShortDescription(code: HoldReasonCode | string): string {
  const def = getHoldReasonDefinition(code);
  return def ? def.shortDescription : "Unrecognized compliance hold reason code.";
}

/**
 * Return all supported hold reason definitions.
 */
export function listSupportedHoldReasons(): readonly HoldReasonDefinition[] {
  return SUPPORTED_HOLD_REASONS;
}

/**
 * Produce options for select dropdowns and radio groups in dashboard forms.
 */
export function listHoldReasonSelectOptions(): Array<{ value: HoldReasonCode; label: string }> {
  return SUPPORTED_HOLD_REASONS.map((item) => ({
    value: item.code,
    label: item.label,
  }));
}
