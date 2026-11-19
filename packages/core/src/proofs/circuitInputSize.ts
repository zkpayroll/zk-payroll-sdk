import { ProofGenerationError } from "../core/errors";

/** Stable error code thrown when a witness is too large for the circuit. */
export const CIRCUIT_INPUT_TOO_LARGE = "PROOF_INPUT_TOO_LARGE";

/** Limits applied to a circuit witness before proof generation starts. */
export interface CircuitInputLimits {
  /** Maximum number of top-level witness fields. */
  maxFields: number;
  /** Maximum total number of values (leaves) across all fields and arrays. */
  maxElements: number;
  /** Maximum nesting depth of arrays/objects inside a field. */
  maxDepth: number;
  /** Maximum length of any single string value (a BN254 field element is at most 78 digits). */
  maxStringLength: number;
  /** Maximum size of the JSON-serialized witness, in bytes. */
  maxTotalBytes: number;
}

export const DEFAULT_CIRCUIT_INPUT_LIMITS: Readonly<CircuitInputLimits> = Object.freeze({
  maxFields: 256,
  maxElements: 4096,
  maxDepth: 4,
  maxStringLength: 128,
  maxTotalBytes: 64 * 1024,
});

/** Which limit a witness exceeded. */
export type CircuitInputLimitName = keyof CircuitInputLimits;

/**
 * Checks that a witness is within the circuit's input limits and throws a
 * {@link ProofGenerationError} before any artifact download or proving work.
 *
 * Error messages and context carry only the field name, the limit and the
 * measured size — never witness values, so recipients and amounts stay private.
 *
 * @param witness - Circuit inputs to check.
 * @param limits  - Overrides for {@link DEFAULT_CIRCUIT_INPUT_LIMITS}.
 * @throws {ProofGenerationError} with code `PROOF_INPUT_TOO_LARGE`.
 */
export function assertCircuitInputSize(
  witness: Record<string, unknown>,
  limits: Partial<CircuitInputLimits> = {}
): void {
  if (!witness || typeof witness !== "object" || Array.isArray(witness)) {
    throw new ProofGenerationError(
      "Circuit input witness must be a valid non-null object.",
      CIRCUIT_INPUT_TOO_LARGE,
      { limit: "maxFields", actual: 0 }
    );
  }

  const max: CircuitInputLimits = { ...DEFAULT_CIRCUIT_INPUT_LIMITS, ...limits };

  const fail = (limit: CircuitInputLimitName, actual: number, field?: string): never => {
    throw new ProofGenerationError(
      `Circuit input exceeds ${limit} (${actual} > ${max[limit]})${
        field ? ` in field "${field}"` : ""
      }. Reduce the witness size before generating a proof.`,
      CIRCUIT_INPUT_TOO_LARGE,
      { limit, max: max[limit], actual, ...(field ? { field } : {}) }
    );
  };

  const keys = Object.keys(witness);
  if (keys.length > max.maxFields) fail("maxFields", keys.length);

  let elements = 0;
  const visit = (value: unknown, field: string, depth: number): void => {
    if (depth > max.maxDepth) fail("maxDepth", depth, field);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, field, depth + 1);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) visit(item, field, depth + 1);
      return;
    }
    elements++;
    if (elements > max.maxElements) fail("maxElements", elements, field);
    if (typeof value === "string" && value.length > max.maxStringLength) {
      fail("maxStringLength", value.length, field);
    }
  };
  for (const key of keys) visit(witness[key], key, 0);

  const bytes = JSON.stringify(witness, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  ).length;
  if (bytes > max.maxTotalBytes) fail("maxTotalBytes", bytes);
}
