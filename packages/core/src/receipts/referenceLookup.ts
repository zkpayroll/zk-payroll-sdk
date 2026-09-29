/**
 * Payroll Receipt Reference Lookup (#560).
 *
 * `PayrollReceipt.transactionReference` is deliberately a union —
 * `PayrollTransactionReference | string` — so older receipts that only recorded
 * a bare transaction hash still parse. Every consumer of that field therefore
 * had to re-implement the same narrowing, and the ones that did it naively
 * produced a different answer for the two shapes: whether a hash is present at
 * all, whether it is well-formed, which network it belongs to, and what
 * timestamp to show.
 *
 * This module is the single, pure resolver for that field. It normalizes either
 * shape into one `ResolvedTransactionReference`, validates the hash and the
 * timestamps, and additionally answers the lookup question the field exists to
 * serve: *given a transaction hash, which receipt does it belong to?*
 *
 * Privacy: the receipt metadata digest, amounts, and recipient counts are
 * deliberately not surfaced here — the resolver returns only the reference
 * itself, plus a `redactReceiptReferenceForLogging` helper that masks the hash
 * for telemetry, so nothing here can leak a payroll value into a log line.
 */
import type { PayrollReceipt, PayrollTransactionReference } from "./types";

/**
 * A 64-character hexadecimal Stellar transaction hash.
 */
const TX_HASH_RE = /^[a-fA-F0-9]{64}$/;

/**
 * Networks a reference can name, normalised to lowercase.
 */
export type ReceiptReferenceNetwork = "testnet" | "mainnet" | "pubnet" | "futurenet" | "standalone";

/**
 * Normalized, always-structured form of a receipt's transaction reference.
 *
 * `isPresent` is the important part: a reference field that exists but holds
 * nothing usable reports `false` rather than throwing, so a partially populated
 * receipt can still be rendered.
 */
export interface ResolvedTransactionReference {
  /** The transaction hash, exactly as supplied (not case-normalised). */
  txHash: string;
  /** True when a non-empty hash was present, whatever its validity. */
  isPresent: boolean;
  /** True when the hash matched {@link TX_HASH_RE}. */
  isValidHash: boolean;
  /** Lowercased network name, when the reference recorded one. */
  network?: ReceiptReferenceNetwork;
  /** Ledger the transaction was included in, when recorded. */
  ledger?: number;
  /** Epoch ms the transaction was submitted, normalised from ms or ISO-8601. */
  submittedAt?: number;
  /** Epoch ms the transaction was confirmed, normalised from ms or ISO-8601. */
  confirmedAt?: number;
  /** Contract id involved in execution, when recorded. */
  contractId?: string;
  /** Timestamp fields that were present but unusable. */
  issues: ReceiptReferenceIssue[];
}

/**
 * One problem detected while resolving a reference.
 */
export interface ReceiptReferenceIssue {
  /** Stable code identifying the check that failed. */
  code: ReceiptReferenceCode;
  /** Human-readable description. Never contains payroll values. */
  message: string;
  /** Whether the reference is unusable for settlement reconciliation. */
  critical: boolean;
}

/**
 * Stable codes for reference-resolution problems.
 */
export const ReceiptReferenceCode = {
  /** The field was empty, null, or whitespace. */
  MISSING: "RECEIPT_REFERENCE_MISSING",
  /** A hash was present but is not 64 hex characters. */
  TX_HASH_MALFORMED: "RECEIPT_REFERENCE_TX_HASH_MALFORMED",
  /** `network` was present but is not a recognized network name. */
  NETWORK_UNRECOGNIZED: "RECEIPT_REFERENCE_NETWORK_UNRECOGNIZED",
  /** `ledger` was present but is not a non-negative integer. */
  LEDGER_INVALID: "RECEIPT_REFERENCE_LEDGER_INVALID",
  /** `submittedAt` / `confirmedAt` was present but could not be parsed. */
  TIMESTAMP_UNPARSEABLE: "RECEIPT_REFERENCE_TIMESTAMP_UNPARSEABLE",
  /** `confirmedAt` precedes `submittedAt`. */
  CONFIRMED_BEFORE_SUBMITTED: "RECEIPT_REFERENCE_CONFIRMED_BEFORE_SUBMITTED",
} as const;

export type ReceiptReferenceCode = (typeof ReceiptReferenceCode)[keyof typeof ReceiptReferenceCode];

const KNOWN_NETWORKS: readonly ReceiptReferenceNetwork[] = [
  "testnet",
  "mainnet",
  "pubnet",
  "futurenet",
  "standalone",
];

/** Anything a caller might hand us in place of a reference. */
export type TransactionReferenceInput = PayrollTransactionReference | string | null | undefined;

function toEpochMs(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function issue(
  code: ReceiptReferenceCode,
  message: string,
  critical: boolean
): ReceiptReferenceIssue {
  return { code, message, critical };
}

/**
 * Resolves a receipt's `transactionReference` into a normalized structure.
 *
 * Accepts either a bare transaction-hash string or a
 * {@link PayrollTransactionReference}, and never throws: a missing or malformed
 * reference is reported through `isPresent` / `isValidHash` and the `issues`
 * list, so one bad receipt cannot stop a batch from being rendered.
 *
 * @param reference - The reference to resolve.
 *
 * @example
 * ```ts
 * const resolved = resolveReceiptTransactionReference(receipt.transactionReference);
 * if (!resolved.isValidHash) {
 *   return; // surface resolved.issues rather than guessing
 * }
 * ```
 */
export function resolveReceiptTransactionReference(
  reference: TransactionReferenceInput
): ResolvedTransactionReference {
  const issues: ReceiptReferenceIssue[] = [];

  // ── Narrow the union ─────────────────────────────────────────────────────
  if (reference === null || reference === undefined) {
    issues.push(issue(ReceiptReferenceCode.MISSING, "Transaction reference is absent.", true));
    return { txHash: "", isPresent: false, isValidHash: false, issues };
  }

  if (typeof reference === "string") {
    const txHash = reference.trim();
    if (txHash === "") {
      issues.push(issue(ReceiptReferenceCode.MISSING, "Transaction reference is empty.", true));
      return { txHash: "", isPresent: false, isValidHash: false, issues };
    }
    const isValidHash = TX_HASH_RE.test(txHash);
    if (!isValidHash) {
      issues.push(
        issue(
          ReceiptReferenceCode.TX_HASH_MALFORMED,
          "Transaction hash is not a 64-character hex string.",
          true
        )
      );
    }
    return { txHash, isPresent: true, isValidHash, issues };
  }

  // Structured form. A reference with no usable hash is reported rather than
  // silently treated as absent, so the distinction stays visible to callers.
  const txHash = typeof reference.txHash === "string" ? reference.txHash.trim() : "";
  if (txHash === "") {
    issues.push(issue(ReceiptReferenceCode.MISSING, "Transaction reference has no txHash.", true));
    return { txHash: "", isPresent: false, isValidHash: false, issues };
  }

  const isValidHash = TX_HASH_RE.test(txHash);
  if (!isValidHash) {
    issues.push(
      issue(
        ReceiptReferenceCode.TX_HASH_MALFORMED,
        "Transaction hash is not a 64-character hex string.",
        true
      )
    );
  }

  let network: ReceiptReferenceNetwork | undefined;
  if (reference.network !== undefined && String(reference.network).trim() !== "") {
    const candidate = String(reference.network).trim().toLowerCase();
    if ((KNOWN_NETWORKS as readonly string[]).includes(candidate)) {
      network = candidate as ReceiptReferenceNetwork;
    } else {
      issues.push(
        issue(
          ReceiptReferenceCode.NETWORK_UNRECOGNIZED,
          `Network '${candidate}' is not a recognized Stellar network; the reference is kept as-is.`,
          false
        )
      );
    }
  }

  let ledger: number | undefined;
  if (reference.ledger !== undefined) {
    if (Number.isInteger(reference.ledger) && reference.ledger >= 0) {
      ledger = reference.ledger;
    } else {
      issues.push(
        issue(ReceiptReferenceCode.LEDGER_INVALID, "Ledger is not a non-negative integer.", false)
      );
    }
  }

  let submittedAt: number | undefined;
  if (reference.submittedAt !== undefined) {
    submittedAt = toEpochMs(reference.submittedAt);
    if (submittedAt === undefined) {
      issues.push(
        issue(
          ReceiptReferenceCode.TIMESTAMP_UNPARSEABLE,
          "submittedAt could not be parsed as a timestamp.",
          false
        )
      );
    }
  }

  let confirmedAt: number | undefined;
  if (reference.confirmedAt !== undefined) {
    confirmedAt = toEpochMs(reference.confirmedAt);
    if (confirmedAt === undefined) {
      issues.push(
        issue(
          ReceiptReferenceCode.TIMESTAMP_UNPARSEABLE,
          "confirmedAt could not be parsed as a timestamp.",
          false
        )
      );
    }
  }

  if (submittedAt !== undefined && confirmedAt !== undefined && confirmedAt < submittedAt) {
    issues.push(
      issue(
        ReceiptReferenceCode.CONFIRMED_BEFORE_SUBMITTED,
        "confirmedAt is earlier than submittedAt.",
        true
      )
    );
  }

  return {
    txHash,
    isPresent: true,
    isValidHash,
    network,
    ledger,
    submittedAt,
    confirmedAt,
    contractId: reference.contractId,
    issues,
  };
}

/**
 * The outcome of a receipt lookup by transaction hash.
 */
export interface ReceiptReferenceLookupResult {
  /** The hash that was searched for, normalised to lowercase. */
  queriedHash: string;
  /** The matching receipt, when exactly one was found. */
  receipt?: PayrollReceipt;
  /** How many receipts matched. More than one is a data-integrity problem. */
  matchCount: number;
  /** The resolved reference of the matched receipt, when found. */
  resolved?: ResolvedTransactionReference;
  /** True when a single receipt was found and its hash is well-formed. */
  isFound: boolean;
  /** Advisory message describing an ambiguous or negative outcome. */
  message: string;
}

/**
 * Finds the receipt a transaction hash refers to, in a collection of receipts.
 *
 * Comparison is case-insensitive on the hash, because Stellar hashes are hex
 * and appear in both cases depending on the producer. Each candidate's
 * `transactionReference` is resolved first, so a bare-string reference is
 * matched as readily as a structured one.
 *
 * @param receipts - Receipts to search.
 * @param txHash - The transaction hash to look for.
 *
 * @example
 * ```ts
 * const hit = findReceiptByTransactionHash(receipts, hashFromWebhook);
 * if (hit.isFound) {
 *   // hit.receipt and hit.resolved are both present
 * }
 * ```
 */
export function findReceiptByTransactionHash(
  receipts: readonly PayrollReceipt[],
  txHash: string
): ReceiptReferenceLookupResult {
  const normalized = txHash.trim().toLowerCase();

  if (!TX_HASH_RE.test(normalized)) {
    return {
      queriedHash: normalized,
      matchCount: 0,
      isFound: false,
      message: "Queried transaction hash is not a 64-character hex string.",
    };
  }

  const matches: Array<{ receipt: PayrollReceipt; resolved: ResolvedTransactionReference }> = [];
  for (const receipt of receipts) {
    const resolved = resolveReceiptTransactionReference(receipt?.transactionReference);
    if (resolved.isValidHash && resolved.txHash.toLowerCase() === normalized) {
      matches.push({ receipt, resolved });
    }
  }

  if (matches.length === 0) {
    return {
      queriedHash: normalized,
      matchCount: 0,
      isFound: false,
      message: "No receipt references that transaction hash.",
    };
  }

  if (matches.length > 1) {
    // Ambiguity is surfaced rather than resolved arbitrarily: picking one would
    // attach the wrong proof to a payment.
    return {
      queriedHash: normalized,
      matchCount: matches.length,
      isFound: false,
      message: `${matches.length} receipts reference that transaction hash; the reference is ambiguous.`,
    };
  }

  return {
    queriedHash: normalized,
    receipt: matches[0]!.receipt,
    resolved: matches[0]!.resolved,
    matchCount: 1,
    isFound: true,
    message: "Found the receipt for that transaction hash.",
  };
}

/**
 * Produces a log-safe view of a resolved reference, with the transaction hash
 * masked. Intended for telemetry and error context, where the full hash is
 * unnecessary and correlating a payment to an individual is undesirable.
 */
export function redactReceiptReferenceForLogging(
  resolved: ResolvedTransactionReference,
  placeholder = "[REDACTED]"
): Record<string, unknown> {
  return {
    txHash: resolved.isPresent ? maskTransactionHash(resolved.txHash) : placeholder,
    isPresent: resolved.isPresent,
    isValidHash: resolved.isValidHash,
    network: resolved.network,
    ledger: resolved.ledger,
    hasSubmittedAt: resolved.submittedAt !== undefined,
    hasConfirmedAt: resolved.confirmedAt !== undefined,
    contractId: resolved.contractId,
    issueCount: resolved.issues.length,
  };
}

/**
 * Masks a transaction hash for display, keeping a short prefix so two hashes
 * can still be told apart in a support conversation.
 */
export function maskTransactionHash(hash: string): string {
  const trimmed = hash.trim();
  if (trimmed.length <= 12) return "****";
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}
