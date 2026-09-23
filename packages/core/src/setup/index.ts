/**
 * Payroll setup checklist generator.
 *
 * Use {@link generateSetupChecklist} to produce an integration checklist
 * covering configuration, network, contracts, treasury, proofs, wallet, and
 * test fixtures, or {@link generateCategoryChecklist} for a single category.
 *
 * @module
 */

export { generateSetupChecklist, generateCategoryChecklist } from "./checklist";
export type {
  SetupCheckCategory,
  SetupCheckStatus,
  SetupCheckItem,
  SetupChecklistResult,
  SetupChecklistOptions,
  TreasuryChecklistInput,
  WalletChecklistInput,
} from "./types";
