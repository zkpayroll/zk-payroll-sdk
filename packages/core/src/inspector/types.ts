/**
 * Result of inspecting a Stellar transaction envelope.
 *
 * All fields are safe to expose — no private inputs (ScVal arguments,
 * contract function arguments, witness data, etc.) are included.
 */
export interface TransactionSummary {
  /** Source account (G... public key). */
  source: string;
  /** Transaction fee in stroops. */
  fee: string;
  /** Network passphrase (e.g. "Test SDF Network ; September 2015"). */
  network: string;
  /** Source account sequence number. */
  sequence: string;
  /** SHA-256 hash of the transaction envelope (hex-encoded). */
  hash: string;
  /** Number of signatures attached to the envelope. */
  signatureCount: number;
  /** Hex-encoded signature hints (last 4 bytes of each signer's public key). */
  signerHints: string[];
  /** Human-readable summaries of each operation (no private arguments leaked). */
  operations: OperationSummary[];
  /** Memo text (if the memo type is `MemoText`, `MemoHash`, or `MemoReturn`). */
  memo?: string;
  /** Memo type constant. */
  memoType?: string;
  /** Whether any operation includes Soroban authorization entries. */
  hasSorobanAuth: boolean;
  /** Total number of Soroban authorization entries across all operations. */
  sorobanAuthCount?: number;
  /** Optional time-bounds set on the transaction. */
  timeBounds?: {
    minTime?: string;
    maxTime?: string;
  };
}

/**
 * Safe summary of a single transaction operation.
 *
 * Argument values are NEVER included — only their count is reported,
 * so private inputs cannot leak through the inspection result.
 */
export interface OperationSummary {
  /**
   * Operation type name, as returned by the Stellar SDK
   * (e.g. "invokeHostFunction", "payment", "createAccount").
   */
  type: string;
  /**
   * Contract ID (C... address) for invokeHostFunction operations
   * that call a contract. Omitted for non-contract operations.
   */
  contractId?: string;
  /**
   * Contract function name for invokeHostFunction operations.
   */
  functionName?: string;
  /**
   * Number of function arguments. Count is reported so callers can
   * verify the operation shape without leaking argument values.
   */
  argumentCount?: number;
  /**
   * Number of Soroban authorization entries attached to this operation.
   */
  authCount?: number;
  /**
   * Human-readable one-line description of what this operation does.
   */
  description: string;
}
