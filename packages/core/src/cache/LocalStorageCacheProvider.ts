import { CacheProvider } from "./CacheProvider";
import { PayrollError } from "../errors";

interface Entry<T> {
  value: T;
  expiresAt: number | null;
}

/**
 * Browser-side cache provider backed by localStorage.
 * Throws PayrollError(500) if localStorage is unavailable.
 */
export class LocalStorageCacheProvider<T = string> implements CacheProvider<T> {
  private readonly prefix: string;

  constructor(prefix = "zk-payroll:") {
    if (typeof localStorage === "undefined") {
      throw new PayrollError("LocalStorageCacheProvider requires a browser environment", 500);
    }
    this.prefix = prefix;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(this.key(key));
      if (raw === null) return null;
      const entry: Entry<T> = JSON.parse(raw);
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        localStorage.removeItem(this.key(key));
        return null;
      }
      return entry.value;
    } catch (err) {
      throw new PayrollError(`LocalStorageCacheProvider.get failed: ${err}`, 503);
    }
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
      const entry: Entry<T> = { value, expiresAt };
      localStorage.setItem(this.key(key), JSON.stringify(entry));
    } catch (err) {
      throw new PayrollError(`LocalStorageCacheProvider.set failed: ${err}`, 504);
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }
}
