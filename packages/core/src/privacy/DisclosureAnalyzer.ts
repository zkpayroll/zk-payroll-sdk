import {
  DisclosureLevel,
  DisclosureAnalysis,
  PrivacyPolicy,
  PrivacyPolicyRule,
} from "./types";

const DEFAULT_SENSITIVE_FIELDS = new Map<string, DisclosureLevel>([
  ["recipient", "high"],
  ["amount", "high"],
  ["salary", "high"],
  ["walletAddress", "high"],
  ["address", "high"],
  ["privateKey", "high"],
  ["employeeId", "high"],
  ["ssn", "high"],
  ["department", "medium"],
  ["jobTitle", "medium"],
  ["manager", "medium"],
  ["notes", "medium"],
  ["timestamp", "low"],
  ["date", "low"],
  ["txHash", "low"],
]);

const RISKY_COMBINATIONS = [
  ["recipient", "amount"],
  ["employeeId", "salary"],
  ["walletAddress", "amount"],
  ["department", "salary"],
];

export class DisclosureAnalyzer {
  private policy: PrivacyPolicy;

  constructor(customPolicy?: PrivacyPolicy) {
    if (customPolicy) {
      this.policy = customPolicy;
    } else {
      this.policy = this.buildDefaultPolicy();
    }
  }

  private buildDefaultPolicy(): PrivacyPolicy {
    const rules: PrivacyPolicyRule[] = Array.from(
      DEFAULT_SENSITIVE_FIELDS.entries()
    ).map(([field, sensitivity]) => ({
      field,
      allowed: true,
      sensitivity,
    }));

    return {
      rules,
      combinationThreshold: 3,
    };
  }

  analyze(payload: Record<string, unknown>): DisclosureAnalysis {
    const blockedFields: string[] = [];
    const warnings: string[] = [];
    const riskFactors: string[] = [];
    const fieldsPresent = Object.keys(payload);
    let maxLevel: DisclosureLevel = "low";

    for (const field of fieldsPresent) {
      const rule = this.policy.rules.find((r) => r.field === field);
      if (rule && !rule.allowed) {
        blockedFields.push(field);
      }
      if (rule) {
        const level = rule.sensitivity;
        if (
          level === "high" ||
          (level === "medium" && maxLevel !== "high") ||
          (level === "low" && maxLevel === "low")
        ) {
          maxLevel = level;
        }
      }
    }

    const presentSensitiveFields = fieldsPresent.filter(
      (f) =>
        DEFAULT_SENSITIVE_FIELDS.has(f) &&
        DEFAULT_SENSITIVE_FIELDS.get(f) === "high"
    );

    for (const [field1, field2] of RISKY_COMBINATIONS) {
      if (fieldsPresent.includes(field1) && fieldsPresent.includes(field2)) {
        riskFactors.push(`Combination of ${field1} and ${field2} increases disclosure risk`);
      }
    }

    if (presentSensitiveFields.length >= (this.policy.combinationThreshold ?? 3)) {
      warnings.push(
        `Multiple sensitive fields present (${presentSensitiveFields.length}). Consider redacting some values.`
      );
      if (maxLevel === "low") {
        maxLevel = "medium";
      }
    }

    return {
      level: maxLevel,
      blockedFields,
      warnings,
      riskFactors,
      safe: blockedFields.length === 0 && riskFactors.length === 0,
    };
  }

  validateExport(
    payload: Record<string, unknown>,
    maxAllowedLevel: DisclosureLevel
  ): { valid: boolean; reasons: string[] } {
    const analysis = this.analyze(payload);
    const reasons: string[] = [];

    if (analysis.blockedFields.length > 0) {
      reasons.push(
        `Forbidden fields present: ${analysis.blockedFields.join(", ")}`
      );
    }

    const levelOrder: DisclosureLevel[] = ["low", "medium", "high"];
    const currentIdx = levelOrder.indexOf(analysis.level);
    const maxIdx = levelOrder.indexOf(maxAllowedLevel);

    if (currentIdx > maxIdx) {
      reasons.push(
        `Disclosure level ${analysis.level} exceeds maximum allowed ${maxAllowedLevel}`
      );
    }

    return {
      valid: reasons.length === 0,
      reasons,
    };
  }
}
