import { PayrollAmendmentInput, AmendmentPlan } from "./types";
import { comparePayrollCommitments } from "../batch/diff";
import { AmendmentPolicyValidator } from "../policy/validation";

export class PayrollAmendmentPlanner {
  constructor(private validator: AmendmentPolicyValidator) {}

  async planAmendment(
    currentCommitments: { recipient: string; amount: bigint; asset: string }[],
    input: PayrollAmendmentInput
  ): Promise<AmendmentPlan> {
    const diffs = comparePayrollCommitments(currentCommitments, input);
    const { authorized, warnings } = await this.validator.validate(input);
    
    const approvalRequired = diffs.length > 0;
    
    return {
      diffs: diffs as any,
      approvalRequired,
      warnings,
      executionSteps: diffs.map(d => ({
        action: "update",
        description: `Update commitment for ${d.recipient}`
      }))
    };
  }
}
