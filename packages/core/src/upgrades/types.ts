export type CompatibilityStatus =
  | "compatible"
  | "warning"
  | "breaking";

export interface ContractMetadata {
  version: string;
  schema: unknown;
  features: string[];
  eventSchema: unknown;
}

export interface CompatibilityRange {
  minVersion: string;
  maxVersion: string;
}

export interface CapabilityMetadata {
  name: string;
  requiredVersion: string;
  supportedRanges: CompatibilityRange[];
}

export interface UpgradeImpact {
  status: CompatibilityStatus;
  breakingChanges: string[];
  warnings: string[];
  migrationsRequired: string[];
  eventSchemaDrift: string[];
}

export interface UpgradeReport {
  currentVersion: string;
  targetVersion: string;
  timestamp: number;
  impact: UpgradeImpact;
  summary: string;
  canProceed: boolean;
}
