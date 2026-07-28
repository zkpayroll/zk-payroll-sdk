/**
 * Barrel re-export for all deterministic test fixtures.
 *
 * Consumers can import from a single entry point:
 *
 * @example
 * ```typescript
 * import {
 *   COMMITMENT_ENTRY_ALICE,
 *   BATCH_PAYLOAD_MULTI_NATIVE,
 *   SCENARIO_BATCH_VALIDATIONS,
 *   SCENARIO_NORMALIZATIONS,
 *   SCENARIO_PAYMENT_VALIDATIONS,
 *   SCENARIO_DRAFT_VALIDATIONS,
 *   SCENARIO_PROOF_ROUND_TRIP,
 * } from "./fixtures";
 * ```
 *
 * The fixtures are intended to be byte-identical across runs and processes:
 * no `Date.now()`, random IDs, or runtime SHA-256 / hash computation should
 * leak into them. Every value is hardcoded.
 */

export * from "./commitment-fixtures";
export * from "./proof-request-fixtures";
export * from "./batch-fixtures";
export * from "./normalization-fixtures";
export * from "./draft-fixtures";
export * from "./validation-fixtures";
