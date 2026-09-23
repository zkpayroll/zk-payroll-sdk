/**
 * Type definitions for the contract error remediation mapper.
 *
 * Knowing that a transaction or contract call failed is not enough — the
 * mapper translates a raw SDK/contract error into a concrete next action,
 * tailored to who is looking at it (an admin, a contributor debugging CI, an
 * SDK-consuming application, or an auditor).
 *
 * @module
 */

/** Audiences that can receive remediation guidance. */
export const RemediationAudience = {
  /** Payroll/treasury administrators operating the contract. */
  ADMIN: "admin",
  /** Engineers contributing to or debugging the SDK/contracts. */
  CONTRIBUTOR: "contributor",
  /** Applications consuming the SDK (dashboards, integrations). */
  SDK_USER: "sdk-user",
  /** Compliance/audit reviewers inspecting payroll activity. */
  AUDITOR: "auditor",
} as const;

export type RemediationAudienceType =
  (typeof RemediationAudience)[keyof typeof RemediationAudience];

/** Broad category a remediated error falls into. */
export const RemediationCategory = {
  TREASURY: "treasury",
  AUTHORIZATION: "authorization",
  PROOF: "proof",
  POLICY: "policy",
  NETWORK: "network",
  UNKNOWN: "unknown",
} as const;

export type RemediationCategoryType =
  (typeof RemediationCategory)[keyof typeof RemediationCategory];

/** Guidance text for a single audience. */
export interface AudienceGuidance {
  /** Concrete next step for this audience. */
  action: string;
  /**
   * Whether this audience can typically resolve the issue themselves.
   * `false` indicates the recommended action is to contact another audience
   * (e.g. an SDK user should contact an admin for a funding issue).
   */
  selfServiceable: boolean;
}

/** Full remediation guidance for a single error, across all audiences. */
export interface RemediationEntry {
  /** Stable error code this entry applies to (matches SDK error `code`). */
  code: string;
  /** Broad category the error belongs to. */
  category: RemediationCategoryType;
  /** Short, technical summary of what went wrong. */
  summary: string;
  /** Guidance keyed by audience. */
  guidance: Record<RemediationAudienceType, AudienceGuidance>;
}

/** Result returned by {@link mapErrorToRemediation}. */
export interface RemediationResult {
  /** The error code the guidance was resolved for. */
  code: string;
  /** Whether `code` matched a known entry (`false` means fallback guidance). */
  known: boolean;
  /** Broad category the error belongs to. */
  category: RemediationCategoryType;
  /** Short, technical summary of what went wrong. */
  summary: string;
  /** Guidance for the requested audience. */
  guidance: AudienceGuidance;
}
