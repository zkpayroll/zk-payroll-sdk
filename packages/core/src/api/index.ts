export { PayrollService } from "../payroll";
export type { Transaction, FilterCriteria } from "../payroll";
export { PayrollContract } from "../contract";
export { DEFAULT_CONFIG, ConfigPresets, ConfigBuilder } from "../config";
export type { ClientConfig } from "../config";
export { checkEmployerReadiness } from "../employer-readiness";
export type {
  EmployerReadinessCheck,
  EmployerReadinessCheckId,
  EmployerReadinessCheckStatus,
  EmployerReadinessInput,
  EmployerReadinessResult,
} from "../employer-readiness";
export * from "../types";

export {
  CANCELLATION_REASONS,
  getCancellationReasonLabel,
  getCancellationReasonDescription,
  isSupportedCancellationReason,
} from "../payroll/cancellation";
export type { CancellationReasonCode, CancellationReasonInfo } from "../payroll/cancellation";

export {
  getContractMetadata,
  isKnownEnvironment,
  listKnownEnvironments,
  validateContractMetadata,
  resolveNetworkProfile,
  buildClientConfig,
  KNOWN_ENVIRONMENTS,
} from "../metadata";
export type {
  NetworkProfile,
  NetworkProfileInput,
  KnownEnvironment,
  MetadataValidationResult,
  MetadataValidationError,
} from "../metadata";

export { PreflightClient } from "../clients/PreflightClient";
export type { PreflightResult, PreflightFinding } from "../clients/PreflightClient";
