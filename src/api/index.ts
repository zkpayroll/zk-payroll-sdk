/**
 * API Layer — Public-facing classes and interfaces.
 *
 * This layer is the primary entry point for SDK consumers.
 * It exposes high-level operations and hides internal implementation details.
 */
export { PayrollService } from "../payroll";
export type { Transaction, FilterCriteria } from "../payroll";
export { PayrollContract } from "../contract";
export { DEFAULT_CONFIG } from "../config";
export type { ClientConfig } from "../config";
export type { PayrollRecord, Network } from "../types";
