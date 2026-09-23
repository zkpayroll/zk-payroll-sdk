/**
 * Error Code Documentation Generation
 *
 * Utilities for generating markdown docs from the SDK's canonical
 * error code registry and detecting undocumented codes.
 *
 * Usage:
 * ```ts
 * import { findUndocumentedErrorCodes, renderErrorDocsMarkdown } from "@zk-payroll/core";
 *
 * const missing = findUndocumentedErrorCodes();
 * if (missing.length > 0) throw new Error(`Undocumented error codes: ${missing.join(", ")}`);
 * ```
 */

export {
  buildErrorDocRows,
  findUndocumentedErrorCodes,
  getDeclaredErrorCodesBySource,
  renderErrorDocsMarkdown,
} from "./docGenerator";
