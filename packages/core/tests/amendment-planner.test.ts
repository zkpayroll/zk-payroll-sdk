import { PayrollAmendmentPlanner } from "../src/amendments/planner";
import { DefaultAmendmentPolicyValidator } from "../src/policy/validation";

describe("PayrollAmendmentPlanner", () => {
  it("should generate a plan with diffs", async () => {
    const planner = new PayrollAmendmentPlanner(new DefaultAmendmentPolicyValidator());
    const current = [{ recipient: "A", amount: 100n, asset: "XLM" }];
    const input = {
      payrollId: "1",
      proposedCommitments: [{ recipient: "A", amount: 200n, asset: "XLM" }]
    };
    
    const plan = await planner.planAmendment(current, input);
    
    expect(plan.diffs).toHaveLength(1);
    expect(plan.diffs[0].type).toBe("modified");
    expect(plan.approvalRequired).toBe(true);
  });
});
