/**
 * Cache Invalidation Types & Domain Models.
 *
 * Defines cache domains, subscopes, triggers, invalidation plans, and
 * staleness models for SDK-managed caches.
 */

import { CacheNamespace } from "./types";

/**
 * Cache domains representing core data boundaries within the SDK.
 */
export type CacheDomain = "payroll" | "employee" | "treasury" | "contract";

/**
 * All supported cache domains as a constant list for runtime validation.
 */
export const CACHE_DOMAINS: readonly CacheDomain[] = [
  "payroll",
  "employee",
  "treasury",
  "contract",
] as const;

/**
 * Maps cache domains to their corresponding CacheNamespace.
 */
export const DOMAIN_TO_NAMESPACE: Record<CacheDomain, CacheNamespace> = {
  payroll: CacheNamespace.PAYROLL,
  employee: CacheNamespace.EMPLOYEE,
  treasury: CacheNamespace.TREASURY,
  contract: CacheNamespace.CONTRACT,
};

/**
 * Canonical subscopes within each cache domain for fine-grained invalidation.
 */
export type PayrollCacheSubscope = "run" | "cycle" | "draft" | "review" | "status";
export type EmployeeCacheSubscope = "profile" | "eligibility" | "destination" | "roster";
export type TreasuryCacheSubscope = "balance" | "reservations" | "reservation" | "checkpoints";
export type ContractCacheSubscope = "state" | "config" | "registry";

export type CacheSubscope =
  PayrollCacheSubscope | EmployeeCacheSubscope | TreasuryCacheSubscope | ContractCacheSubscope;

/**
 * Invalidation trigger types, categorized by event-driven or manual origin.
 */
export type InvalidationTriggerType =
  // Event-driven triggers (from contract events)
  | "event:registered"
  | "event:registry_updated"
  | "event:registry_deactivated"
  | "event:committed"
  | "event:salary_revealed"
  | "event:payment_executed"
  | "event:payment_scheduled"
  | "event:payment_cancelled"
  | "event:payment_failed"
  // Manual / Administrative triggers
  | "manual:payroll_draft_modified"
  | "manual:payroll_run_reset"
  | "manual:payroll_cycle_reset"
  | "manual:employee_profile_updated"
  | "manual:employee_roster_sync"
  | "manual:treasury_topup"
  | "manual:treasury_rebalance"
  | "manual:contract_upgrade"
  | "manual:domain_flush"
  | "manual:custom";

/**
 * Represents a single targeted cache entity or pattern to invalidate.
 */
export interface InvalidationTarget {
  /** The cache namespace to target. */
  readonly namespace: CacheNamespace;
  /** Specific cache key to delete, if known. */
  readonly key?: string;
  /** Key prefix pattern to delete (e.g. `payroll:run:emp123:`). */
  readonly pattern?: string;
  /** Whether to clear the entire namespace. */
  readonly clearNamespace?: boolean;
}

/**
 * Actionable plan produced by resolving invalidation triggers against rules.
 */
export interface InvalidationPlan {
  /** Identifier of the trigger that originated this plan. */
  readonly trigger: InvalidationTriggerType | string;
  /** Domains affected by this invalidation. */
  readonly domains: readonly CacheDomain[];
  /** Concrete cache targets to invalidate. */
  readonly targets: readonly InvalidationTarget[];
  /** Explanatory reasons why each target was flagged for invalidation. */
  readonly reasons: readonly string[];
  /** Milliseconds epoch timestamp when plan was generated. */
  readonly timestamp: number;
  /** Optional metadata associated with the event/trigger. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Result of executing an invalidation plan against a cache backend.
 */
export interface InvalidationResult {
  /** Whether all targeted invalidations succeeded without error. */
  readonly success: boolean;
  /** List of individual cache keys deleted. */
  readonly invalidatedKeys: readonly string[];
  /** List of namespaces cleared in bulk. */
  readonly clearedNamespaces: readonly CacheNamespace[];
  /** Domains that had cache entries modified. */
  readonly affectedDomains: readonly CacheDomain[];
  /** Errors encountered during execution (if any). */
  readonly errors: readonly Error[];
  /** Total count of keys or namespaces purged. */
  readonly purgedCount: number;
}

/**
 * Metadata stored alongside cached entries to facilitate staleness detection.
 */
export interface CacheEntryMetadata {
  /** Milliseconds epoch timestamp when the entry was written. */
  readonly storedAt: number;
  /** Optional ledger sequence number when the entry was retrieved from blockchain. */
  readonly ledger?: number;
  /** Optional version or revision counter (e.g. payroll draft revision). */
  readonly version?: number;
  /** Optional entity checksum or intent hash. */
  readonly checksum?: string;
}

/**
 * Categories of operational hazards prevented by cache invalidation.
 */
export type StalenessRisk =
  "unsafe_review_state" | "incorrect_warning" | "confusing_reconciliation" | "expired_ttl";

/**
 * Input options for evaluating whether a cached state is stale.
 */
export interface StalenessEvaluationOptions {
  /** Maximum acceptable age in milliseconds before entry is deemed stale. */
  readonly maxAgeMs?: number;
  /** Current ledger sequence from RPC; entry is stale if entry.ledger < currentLedger. */
  readonly currentLedger?: number;
  /** Known latest revision / version; entry is stale if entry.version !== expectedVersion. */
  readonly expectedVersion?: number;
  /** Latest checksum/hash; entry is stale if entry.checksum !== expectedChecksum. */
  readonly expectedChecksum?: string;
  /** If provided, compares against minimum timestamp required. */
  readonly staleBeforeTimestamp?: number;
  /** Known event occurrences that invalidate this entry. */
  readonly invalidatingEventOccurred?: boolean;
}

/**
 * Result of evaluating whether a cached state is stale.
 */
export interface StalenessEvaluationResult {
  /** Whether the cached state is considered stale. */
  readonly isStale: boolean;
  /** Domain of the evaluated cache entry. */
  readonly domain: CacheDomain;
  /** Detailed reason explaining why the state is stale (or why it is fresh). */
  readonly reason?: string;
  /** Specific risk that stale data poses (review, warning, or reconciliation). */
  readonly riskCategory?: StalenessRisk;
}
