/**
 * Deterministic Same-Ledger Settlement Event Sorting (#849)
 *
 * Provides deterministic, reproducible ordering for settlement events occurring
 * within the same ledger sequence, ensuring consistent event ingestion, audit trail
 * generation, and multi-node indexer convergence.
 */

export interface SettlementSortableEvent {
  readonly type: string;
  readonly contractId?: string;
  readonly ledger?: number;
  readonly ledgerClosedAt?: string;
  readonly txHash?: string;
  readonly txIndex?: number;
  readonly eventIndex?: number;
  readonly id?: string;
  readonly pagingToken?: string;
  readonly [key: string]: unknown;
}

/**
 * Deterministic comparator for settlement events.
 *
 * Precedence:
 * 1. Ledger sequence number (numeric asc)
 * 2. Transaction index in block (numeric asc)
 * 3. Event index in transaction (numeric asc)
 * 4. Paging token or unique event ID (lexicographical asc)
 * 5. Transaction hash (lexicographical asc)
 * 6. Event type name (lexicographical asc)
 * 7. Contract ID (lexicographical asc)
 */
export function compareSettlementEvents<T extends SettlementSortableEvent>(a: T, b: T): number {
  // 1. Ledger sequence
  const ledgerA = a.ledger ?? 0;
  const ledgerB = b.ledger ?? 0;
  if (ledgerA !== ledgerB) {
    return ledgerA - ledgerB;
  }

  // 2. Transaction index
  if (typeof a.txIndex === "number" && typeof b.txIndex === "number") {
    if (a.txIndex !== b.txIndex) {
      return a.txIndex - b.txIndex;
    }
  } else if (typeof a.txIndex === "number") {
    return -1;
  } else if (typeof b.txIndex === "number") {
    return 1;
  }

  // 3. Event index within transaction
  if (typeof a.eventIndex === "number" && typeof b.eventIndex === "number") {
    if (a.eventIndex !== b.eventIndex) {
      return a.eventIndex - b.eventIndex;
    }
  } else if (typeof a.eventIndex === "number") {
    return -1;
  } else if (typeof b.eventIndex === "number") {
    return 1;
  }

  // 4. Paging token / ID
  const tokenA = a.pagingToken ?? a.id ?? "";
  const tokenB = b.pagingToken ?? b.id ?? "";
  if (tokenA !== tokenB) {
    return tokenA.localeCompare(tokenB);
  }

  // 5. Transaction hash
  const hashA = a.txHash ?? "";
  const hashB = b.txHash ?? "";
  if (hashA !== hashB) {
    return hashA.localeCompare(hashB);
  }

  // 6. Event type
  const typeA = a.type ?? "";
  const typeB = b.type ?? "";
  if (typeA !== typeB) {
    return typeA.localeCompare(typeB);
  }

  // 7. Contract ID
  const contractA = a.contractId ?? "";
  const contractB = b.contractId ?? "";
  return contractA.localeCompare(contractB);
}

/**
 * Returns a new array containing all settlement events sorted in deterministic order.
 */
export function sortSettlementEventsDeterministically<T extends SettlementSortableEvent>(
  events: readonly T[]
): T[] {
  return [...events].sort(compareSettlementEvents);
}

/**
 * Checks whether an event list is already sorted deterministically.
 */
export function isEventsSortedDeterministically<T extends SettlementSortableEvent>(
  events: readonly T[]
): boolean {
  for (let i = 1; i < events.length; i++) {
    if (compareSettlementEvents(events[i - 1], events[i]) > 0) {
      return false;
    }
  }
  return true;
}
