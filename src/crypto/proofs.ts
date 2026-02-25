import { CacheProvider } from "../cache/CacheProvider";

/**
 * Derives a stable cache key from the proof witness.
 * Handles bigint values so common witness fields (e.g. amount) are serializable.
 */
function witnessKey(witness: any): string {
	return `proof:${JSON.stringify(witness, (_, value) =>
		typeof value === "bigint" ? value.toString() : value,
	)}`;
}

function uint8ArrayToBase64(arr: Uint8Array): string {
	return Buffer.from(arr).toString("base64");
}

function base64ToUint8Array(str: string): Uint8Array {
	return new Uint8Array(Buffer.from(str, "base64"));
}

export class ZKProofGenerator {
	/**
	 * Generates a ZK proof for the given witness.
	 * If a CacheProvider is supplied, a cached proof is returned on hit
	 * and the result is stored on miss — avoiding repeated .zkey downloads.
	 *
	 * @param witness  - Circuit inputs (recipient, amount, etc.)
	 * @param cache    - Optional cache provider (MemoryCacheProvider or LocalStorageCacheProvider)
	 */
	static async generateProof(
		witness: any,
		cache?: CacheProvider<string>,
	): Promise<Uint8Array> {
		if (cache) {
			const key = witnessKey(witness);
			const cached = await cache.get(key);
			if (cached !== null) {
				return base64ToUint8Array(cached);
			}

			// Proof generation (simulated — replace with real snarkjs / .zkey call).
			const proof = new Uint8Array(32);
			await cache.set(key, uint8ArrayToBase64(proof));
			return proof;
		}

		// Proof generation without caching.
		return new Uint8Array(32);
	}
}
