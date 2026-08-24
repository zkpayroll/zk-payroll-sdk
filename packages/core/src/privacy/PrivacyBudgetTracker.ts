import { DisclosureLevel, PrivacyBudget } from "./types";

export class PrivacyBudgetTracker implements PrivacyBudget {
  maxAllowedDisclosure: DisclosureLevel;
  fieldsUsed: Set<string>;
  combinationsExceeded: boolean;

  private highSensitivityFields = new Set([
    "recipient",
    "amount",
    "salary",
    "walletAddress",
    "privateKey",
    "employeeId",
    "ssn",
  ]);

  private mediumSensitivityFields = new Set([
    "department",
    "jobTitle",
    "manager",
    "notes",
  ]);

  constructor(maxAllowedDisclosure: DisclosureLevel = "medium") {
    this.maxAllowedDisclosure = maxAllowedDisclosure;
    this.fieldsUsed = new Set();
    this.combinationsExceeded = false;
  }

  recordFieldAccess(fieldName: string): void {
    this.fieldsUsed.add(fieldName);
    this.checkBudget();
  }

  recordMultipleFields(fieldNames: string[]): void {
    fieldNames.forEach((name) => this.fieldsUsed.add(name));
    this.checkBudget();
  }

  private checkBudget(): void {
    if (this.maxAllowedDisclosure === "low") {
      const hasAnyHigh = Array.from(this.fieldsUsed).some((f) =>
        this.highSensitivityFields.has(f)
      );
      const hasAnyMedium = Array.from(this.fieldsUsed).some((f) =>
        this.mediumSensitivityFields.has(f)
      );
      if (hasAnyHigh || hasAnyMedium) {
        this.combinationsExceeded = true;
      }
    } else if (this.maxAllowedDisclosure === "medium") {
      const hasAnyHigh = Array.from(this.fieldsUsed).some((f) =>
        this.highSensitivityFields.has(f)
      );
      if (hasAnyHigh) {
        this.combinationsExceeded = true;
      }
    }
  }

  isWithinBudget(): boolean {
    return !this.combinationsExceeded;
  }

  getFieldsWithinBudget(): string[] {
    if (this.isWithinBudget()) {
      return Array.from(this.fieldsUsed);
    }

    if (this.maxAllowedDisclosure === "low") {
      return Array.from(this.fieldsUsed).filter(
        (f) =>
          !this.highSensitivityFields.has(f) &&
          !this.mediumSensitivityFields.has(f)
      );
    } else if (this.maxAllowedDisclosure === "medium") {
      return Array.from(this.fieldsUsed).filter(
        (f) => !this.highSensitivityFields.has(f)
      );
    }

    return Array.from(this.fieldsUsed);
  }

  getRemainingBudget(): string[] {
    const allFields = Array.from(
      new Set([
        ...this.highSensitivityFields,
        ...this.mediumSensitivityFields,
      ])
    );
    return allFields.filter((f) => !this.fieldsUsed.has(f));
  }

  reset(): void {
    this.fieldsUsed.clear();
    this.combinationsExceeded = false;
  }
}
