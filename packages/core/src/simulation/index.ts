export { simulatePayroll } from "./simulatePayroll";
export type {
  SimulationFinding,
  SimulationInput,
  SimulationOptions,
  SimulationResult,
  SimulationStatus,
} from "./types";

// ── End-to-end payroll simulation ──────────────────────────────────────────
export { PayrollSimulator } from "./PayrollSimulator";
export { generateCommitments, computeTotalCommitment } from "./commitmentGenerator";
export { createMockProofGenerator, validateProofConfig } from "./proofSimulator";
export { checkTreasury, checkSinglePayment } from "./treasury";
export type { TreasuryCheckResult } from "./treasury";
export { buildSimulatedTransaction, simulatePolling } from "./transactionSimulator";
export type { SimulatedTransaction } from "./transactionSimulator";
export { buildReconciliation } from "./reconciliation";

// ── Typed simulation result parsing ────────────────────────────────────────
export {
  parseSimulationResponse,
  classifySimulationFailure,
  sanitizeSimulationDetail,
  SIMULATION_DETAIL_MAX_LENGTH,
} from "./resultParser";
export type {
  ParsedSimulationResult,
  ParsedSimulationCategory,
  ParsedSimulationFinding,
  ParsedFindingSeverity,
  ParsedSimulationDiagnostics,
} from "./resultParser";

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  SimulationCompanyConfig,
  SimulationEmployeeRecord,
  PayrollPeriodMetadata,
  MockTreasuryState,
  SimulationNetworkSettings,
  ProofSimulationConfig,
  TransactionSimulationConfig,
  PayrollSimulationConfig,
  SalaryCommitment,
  SimulatedPaymentStatus,
  SimulatedPaymentOutcome,
  ReconciliationEntry,
  ReconciliationSummary,
  PayrollSimulationResult,
} from "./types";

export { SimulationErrorCode } from "./types";
