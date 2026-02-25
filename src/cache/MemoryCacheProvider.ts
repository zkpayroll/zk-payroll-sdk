import { CacheProvider } from "./CacheProvider";
import { PayrollError } from "../errors";

interface Entry<T> {
	value: T;
	expiresAt: number | null;
}

/**
 * In-memory cache provider for Node.js environments.
 * Data does not persist across process restarts.
 */
export class MemoryCacheProvider<T = string> implements CacheProvider<T> {
	private store = new Map<string, Entry<T>>();

	async get(key: string): Promise<T | null> {
		try {
			const entry = this.store.get(key);
			if (!entry) return null;
			if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
				this.store.delete(key);
				return null;
			}
			return entry.value;
		} catch (err) {
			throw new PayrollError(`MemoryCacheProvider.get failed: ${err}`, 501);
		}
	}

	async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
		try {
			const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
			this.store.set(key, { value, expiresAt });
		} catch (err) {
			throw new PayrollError(`MemoryCacheProvider.set failed: ${err}`, 502);
		}
	}

	async has(key: string): Promise<boolean> {
		return (await this.get(key)) !== null;
	}
}
