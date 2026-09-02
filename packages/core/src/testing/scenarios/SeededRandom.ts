/**
 * SeededRandom
 *
 * A tiny, deterministic pseudo-random number generator used to build edge
 * payroll fixtures. The generator is a Linear Congruential Generator (LCG)
 * with the same constants as the PayrollFixtureGenerator so that a given
 * seed always produces an identical fixture, across runs and processes.
 *
 * This is a test utility only. It must never be used for anything
 * security-sensitive (keys, nonces, proof randomness, etc.).
 */

const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MASK = 0x7fffffff;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state * LCG_MULTIPLIER + LCG_INCREMENT) & LCG_MASK;
    return this.state / LCG_MASK;
  }

  /** Next integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Next bigint in [min, max] inclusive. */
  nextBigInt(min: bigint, max: bigint): bigint {
    if (max <= min) return min;
    const range = max - min + 1n;
    const randomPart = BigInt(Math.floor(this.next() * Number.MAX_SAFE_INTEGER));
    return min + (randomPart % range);
  }

  /** Pick a random element from a list. */
  pick<T>(items: readonly T[]): T {
    return items[this.nextInt(0, items.length - 1)];
  }

  /** Deterministic lowercase hex string of the given byte length. */
  hex(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) {
      out += this.nextInt(0, 15).toString(16);
    }
    return out;
  }

  /**
   * Deterministic, syntactically valid-looking Stellar-style G address.
   *
   * The returned string is always 56 characters starting with "G" and drawn
   * from the base32 alphabet, but it is NOT guaranteed to be a real account.
   * Callers that need a checksum-valid address should use
   * `syntheticStellarAddress` from the scenario factory instead.
   */
  placeholderAddress(prefix: "G" | "C" = "G"): string {
    let out = prefix;
    for (let i = 1; i < 56; i++) {
      out += BASE32_ALPHABET[this.nextInt(0, BASE32_ALPHABET.length - 1)];
    }
    return out;
  }
}
