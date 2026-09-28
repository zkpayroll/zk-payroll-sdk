export { PayrollRequestBuilder, deriveIdempotencyKey } from "./PayrollRequestBuilder";
export {
  buildDuplicateEmployeeValidationErrors,
  detectDuplicateEmployeeRecords,
  findDuplicateEmployeeIds,
} from "./employeeDuplicates";
export type {
  DuplicateEmployeeOptions,
  DuplicateEmployeeRecord,
  DuplicateEmployeeReport,
  EmployeeIdentifiedRecord,
} from "./employeeDuplicates";
export type {
  PayrollRequest,
  PayrollRequestEntry,
  PayrollRequestValidationEntry,
  PayrollRequestValidationReport,
  PayrollRequestErrorCode,
  SubmissionContext,
} from "./types";
