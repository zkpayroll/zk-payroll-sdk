import {
  ContractMetadata,
  CapabilityMetadata,
  UpgradeImpact,
  UpgradeReport,
  CompatibilityStatus,
} from "./types";

export class UpgradeImpactAnalyzer {
  private supportedCapabilities: Map<string, CapabilityMetadata> = new Map();
  private versionHistory: Map<string, ContractMetadata> = new Map();

  registerCapability(capability: CapabilityMetadata): void {
    this.supportedCapabilities.set(capability.name, capability);
  }

  registerContractVersion(version: string, metadata: ContractMetadata): void {
    this.versionHistory.set(version, metadata);
  }

  analyzeUpgrade(
    currentMetadata: ContractMetadata,
    targetMetadata: ContractMetadata
  ): UpgradeReport {
    const impact = this.computeImpact(currentMetadata, targetMetadata);

    const report: UpgradeReport = {
      currentVersion: currentMetadata.version,
      targetVersion: targetMetadata.version,
      timestamp: Date.now(),
      impact,
      summary: this.generateSummary(impact),
      canProceed: impact.status !== "breaking",
    };

    return report;
  }

  private computeImpact(
    current: ContractMetadata,
    target: ContractMetadata
  ): UpgradeImpact {
    const breakingChanges: string[] = [];
    const warnings: string[] = [];
    const migrationsRequired: string[] = [];
    const eventSchemaDrift: string[] = [];

    const currentFeatures = new Set(current.features);
    const targetFeatures = new Set(target.features);

    for (const feature of currentFeatures) {
      if (!targetFeatures.has(feature)) {
        breakingChanges.push(`Feature ${feature} has been removed`);
      }
    }

    for (const feature of targetFeatures) {
      if (!currentFeatures.has(feature)) {
        warnings.push(`New feature ${feature} is available`);
      }
    }

    if (!this.isSchemaCompatible(current.schema, target.schema)) {
      breakingChanges.push("Contract schema has breaking changes");
      migrationsRequired.push("Data migration required for new schema");
    }

    if (!this.isEventSchemaCompatible(current.eventSchema, target.eventSchema)) {
      eventSchemaDrift.push("Event schema has changed");
      warnings.push("Event stream parsing may be affected");
    }

    let status: CompatibilityStatus = "compatible";
    if (breakingChanges.length > 0) {
      status = "breaking";
    } else if (warnings.length > 0 || migrationsRequired.length > 0) {
      status = "warning";
    }

    return {
      status,
      breakingChanges,
      warnings,
      migrationsRequired,
      eventSchemaDrift,
    };
  }

  private isSchemaCompatible(
    currentSchema: unknown,
    targetSchema: unknown
  ): boolean {
    if (typeof currentSchema !== "object" || typeof targetSchema !== "object") {
      return currentSchema === targetSchema;
    }

    const current = currentSchema as Record<string, unknown>;
    const target = targetSchema as Record<string, unknown>;

    for (const key of Object.keys(current)) {
      if (!(key in target)) {
        return false;
      }
    }

    return true;
  }

  private isEventSchemaCompatible(
    currentSchema: unknown,
    targetSchema: unknown
  ): boolean {
    if (
      typeof currentSchema !== "object" ||
      typeof targetSchema !== "object"
    ) {
      return currentSchema === targetSchema;
    }

    const current = currentSchema as Record<string, unknown>;
    const target = targetSchema as Record<string, unknown>;

    const currentKeys = new Set(Object.keys(current));
    const targetKeys = new Set(Object.keys(target));

    if (currentKeys.size !== targetKeys.size) {
      return false;
    }

    for (const key of currentKeys) {
      if (!targetKeys.has(key)) {
        return false;
      }
    }

    return true;
  }

  private generateSummary(impact: UpgradeImpact): string {
    if (impact.status === "breaking") {
      return `Breaking changes detected: ${impact.breakingChanges.join("; ")}. Upgrade cannot proceed without migration.`;
    } else if (impact.status === "warning") {
      const issues =
        impact.warnings.length > 0
          ? impact.warnings
          : impact.migrationsRequired;
      return `Upgrade has warnings: ${issues.join("; ")}. Review before proceeding.`;
    }
    return "Upgrade is fully compatible. Payroll operations can proceed without interruption.";
  }

  validatePayrollCompatibility(
    currentMetadata: ContractMetadata,
    requiredCapabilities: string[]
  ): {
    compatible: boolean;
    missingCapabilities: string[];
  } {
    const missingCapabilities: string[] = [];

    for (const capability of requiredCapabilities) {
      const capMetadata = this.supportedCapabilities.get(capability);
      if (!capMetadata) {
        missingCapabilities.push(capability);
        continue;
      }

      if (!currentMetadata.features.includes(capability)) {
        missingCapabilities.push(capability);
      }
    }

    return {
      compatible: missingCapabilities.length === 0,
      missingCapabilities,
    };
  }
}
