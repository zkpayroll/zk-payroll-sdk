import { ZkPayrollError } from "../core/errors";

/**
 * Thrown when a proof reference string fails to parse or validate.
 */
export class ProofReferenceParsingError extends ZkPayrollError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, "INVALID_PROOF_REFERENCE", context);
    this.name = "ProofReferenceParsingError";
  }
}
