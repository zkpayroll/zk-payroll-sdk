/**
 * Payroll policy compiler.
 *
 * Converts human-readable payroll policy configuration (settlement windows,
 * capacity limits, reserves, audit settings) into a validated, deterministic
 * contract-call payload.
 *
 * ```ts
 * import { compilePayrollPolicy } from "@zk-payroll/core";
 *
 * const result = compilePayrollPolicy({ ... });
 * ```
 */
export * from "./types";
export * from "./compiler";
export * from "./fixtures";
