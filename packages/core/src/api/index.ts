export { PayrollService } from "../payroll";
export type { Transaction, FilterCriteria } from "../payroll";
export { PayrollContract } from "../contract";
export {
  DEFAULT_CONFIG,
  ConfigPresets,
  ConfigBuilder,
  validateConfig,
  assertValidConfig,
} from "../config";
export type {
  ClientConfig,
  RetryPolicyConfig,
  FeatureFlagsConfig,
  ConfigValidationErrorDetail,
  ConfigValidationResult,
} from "../config";
export * from "../types";

export {
  getContractMetadata,
  isKnownEnvironment,
  listKnownEnvironments,
  validateContractMetadata,
  buildClientConfig,
  KNOWN_ENVIRONMENTS,
} from "../metadata";
export type {
  ContractMetadata,
  KnownEnvironment,
  MetadataValidationResult,
  MetadataValidationError,
} from "../metadata";
