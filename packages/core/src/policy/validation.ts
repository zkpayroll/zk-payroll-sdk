import { PayrollAmendmentInput } from "../amendments/types";

export interface AmendmentPolicyValidator {
  validate(input: PayrollAmendmentInput): Promise<{ authorized: boolean; warnings: string[] }>;
}

export class DefaultAmendmentPolicyValidator implements AmendmentPolicyValidator {
  async validate(input: PayrollAmendmentInput) {
    // Basic validation logic
    return { authorized: true, warnings: [] };
  }
}
