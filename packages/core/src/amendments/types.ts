export interface PayrollAmendmentInput {
  payrollId: string;
  proposedCommitments: {
    recipient: string;
    amount: bigint;
    asset: string;
  }[];
}

export interface AmendmentPlan {
  diffs: {
    type: "added" | "removed" | "modified";
    recipient: string;
    oldAmount?: bigint;
    newAmount?: bigint;
    asset: string;
  }[];
  approvalRequired: boolean;
  warnings: string[];
  executionSteps: {
    action: "approve" | "submit" | "update";
    description: string;
    contractCall?: {
      method: string;
      args: any[];
    };
  }[];
}
