/**
 * Abstract cache interface for the ZK Payroll SDK.
 * Implement this to provide custom caching backends.
 *
 * Error codes reserved for cache failures: 500–599.
 */
export interface CacheProvider<T = string> {
	/** Returns the cached value for key, or null if absent. */
	get(key: string): Promise<T | null>;
	/** Stores value under key with an optional TTL in seconds. */
	set(key: string, value: T, ttlSeconds?: number): Promise<void>;
	/** Returns true if key exists in the cache. */
	has(key: string): Promise<boolean>;
}
