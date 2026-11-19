/**
 * Typed Payroll Run Identifier Module (#924).
 *
 * Exposes strongly-typed branded identifiers, validation helpers, assertions,
 * and privacy-preserving error handlers for payroll run identifiers.
 *
 * @module
 */

export * from "./types";
export * from "./errors";
export * from "./validation";
export { RunIdentifier, normalizeRunId } from "../core/run-identifier";
