export type DisclosureLevel = "low" | "medium" | "high";

export interface PrivacyPolicyRule {
  field: string;
  allowed: boolean;
  sensitivity: DisclosureLevel;
}

export interface PrivacyPolicy {
  rules: PrivacyPolicyRule[];
  combinationThreshold?: number;
}

export interface DisclosureAnalysis {
  level: DisclosureLevel;
  blockedFields: string[];
  warnings: string[];
  riskFactors: string[];
  safe: boolean;
}

export interface PrivacyBudget {
  maxAllowedDisclosure: DisclosureLevel;
  fieldsUsed: Set<string>;
  combinationsExceeded: boolean;
}
