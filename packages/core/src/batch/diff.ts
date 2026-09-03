import { PayrollAmendmentInput } from "../amendments/types";

export function comparePayrollCommitments(
  currentCommitments: { recipient: string; amount: bigint; asset: string }[],
  proposedInput: PayrollAmendmentInput
) {
  const diffs = [];
  const currentMap = new Map(currentCommitments.map(c => [c.recipient, c]));
  const proposedMap = new Map(proposedInput.proposedCommitments.map(c => [c.recipient, c]));

  // Check for modifications and additions
  for (const [recipient, proposed] of proposedMap) {
    const current = currentMap.get(recipient);
    if (!current) {
      diffs.push({ type: "added", recipient, newAmount: proposed.amount, asset: proposed.asset });
    } else if (current.amount !== proposed.amount || current.asset !== proposed.asset) {
      diffs.push({ type: "modified", recipient, oldAmount: current.amount, newAmount: proposed.amount, asset: proposed.asset });
    }
  }

  // Check for removals
  for (const [recipient, current] of currentMap) {
    if (!proposedMap.has(recipient)) {
      diffs.push({ type: "removed", recipient, oldAmount: current.amount, asset: current.asset });
    }
  }

  return diffs;
}
