export * from "./types";
export * from "./registry";
export * from "./walletRotation";
export * from "./removal";
export * from "./referenceId";
export * from "./onboardingDuplicates";
export * from "./lifecycle";
export * from "./activeStatus";
export * from "./payoutDestination";
export * from "./payoutMethodConfirmation";
// Both modules declare a `confirmPayoutMethod` with different semantics:
//   - `./payoutMethodConfirmation` — the employee re-enters the destination
//     to confirm it (issue #631);
//   - `./payoutDestination` — a host-hook-driven pre-flight check (#531).
// The explicit re-export below settles the star-export ambiguity in favour of
// the employee-facing confirmation, and the hook-driven variant is re-exported
// under an unambiguous alias so both remain reachable from the package root.
export { confirmPayoutMethod } from "./payoutMethodConfirmation";
export { confirmPayoutMethod as confirmDestinationWithHook } from "./payoutDestination";
export * from "../events/employeeStatus";
export * from "./suspensionPayoutEvaluator";
export * from "../import/resultParser";
export * from "./versionConflictResponse";
