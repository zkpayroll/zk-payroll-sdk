# Payroll Approval Quorum Validation (#691)

The `validatePayrollApprovalQuorum` and `assertPayrollApprovalQuorum` utilities validate that payroll executions have acquired the necessary quorum of valid, distinct, and authorized approvers prior to disbursement.

## Features

- **Threshold Enforcement**: Validates that the number of distinct valid approvals meets or exceeds `requiredQuorum`.
- **Authorized Approvers & Role Checks**: Optionally restricts valid approvals to explicit allowlists or specific roles.
- **Self-Approval Guard**: Can enforce that initiators cannot approve their own payroll executions (`allowSelfApproval: false`).
- **Percentage Quorums**: Supports minimum percentage of designated authorized approvers (`minQuorumPercentage`).
- **Structured Error Handling**: Throws `PayrollApprovalQuorumError` with details on missing count and invalid approvers.
