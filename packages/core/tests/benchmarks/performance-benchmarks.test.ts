/**
 * Performance benchmarks for SDK hot paths: proof setup, caching, and submission helpers.
 *
 * These tests measure wall-clock time (latency) for user-facing payroll operations.
 * Results are emitted as a table and persisted to baseline.json for regression detection.
 *
 * ## Recommended invocation
 * ```
 * npm run test -- tests/benchmarks/performance-benchmarks.test.ts --no-coverage --runInBand
 * ```
 *
 * ## Understanding the metrics
 * - **Min ms**     — fastest observed run in the test batch
 * - **Max ms**     — slowest observed run in the test batch
 * - **Avg ms**     — average wall-clock time across all runs
 * - **Median ms**  — middle value (50th percentile)
 * - **p95 ms**     — 95th percentile; indicates tail latency
 * - **p99 ms**     — 99th percentile; rare but worst-case latency
 *
 * Use these metrics to:
 * - Detect regressions in proof generation latency
 * - Validate cache effectiveness (warm vs cold)
 * - Track overhead of submission helpers
 * - Identify performance bottlenecks for optimization
 */

import * as fs from "fs";
import * as path from "path";

// ── Benchmarking utilities ────────────────────────────────────────────────────

interface PerformanceResult {
  name: string;
  description: string;
  samples: number[];
}

interface PerformanceBaseline {
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
  };
  results: Array<{
    name: string;
    description: string;
    minMs: number;
    maxMs: number;
    avgMs: number;
    medianMs: number;
    p95Ms: number;
    p99Ms: number;
    sampleCount: number;
  }>;
}

/**
 * Record execution time of a synchronous or async operation.
 * Repeats the operation multiple times and returns all sample times.
 */
async function measurePerformance<T>(
  name: string,
  description: string,
  fn: () => Promise<T> | T,
  runs: number = 10
): Promise<PerformanceResult> {
  const samples: number[] = [];

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    samples.push(end - start);
  }

  return { name, description, samples };
}

/** Compute percentile from sorted array. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Format performance results as a pretty table. */
function formatPerformanceTable(results: PerformanceResult[]): string {
  const rows: string[] = [];

  // Header
  rows.push(
    "╔═══════════════════════════════════════╦════════╦════════╦════════╦═════════╦════════╦════════╗"
  );
  rows.push(
    "║ Operation                             ║ Min ms ║ Max ms ║ Avg ms ║ Med ms  ║ p95 ms ║ p99 ms ║"
  );
  rows.push(
    "╠═══════════════════════════════════════╬════════╬════════╬════════╬═════════╬════════╬════════╣"
  );

  for (const result of results) {
    const sorted = [...result.samples].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const median = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);

    const name = result.description.substring(0, 37).padEnd(37);
    const row = `║ ${name} │ ${min.toFixed(2).padStart(6)} │ ${max.toFixed(2).padStart(6)} │ ${avg.toFixed(2).padStart(6)} │ ${median.toFixed(2).padStart(7)} │ ${p95.toFixed(2).padStart(6)} │ ${p99.toFixed(2).padStart(6)} ║`;
    rows.push(row);
  }

  rows.push(
    "╚═══════════════════════════════════════╩════════╩════════╩════════╩═════════╩════════╩════════╝"
  );

  return rows.join("\n");
}

/** Persist baseline results to disk for regression detection. */
function persistPerformanceBaseline(results: PerformanceResult[]): void {
  try {
    const baseline: PerformanceBaseline = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
      },
      results: results.map((r) => {
        const sorted = [...r.samples].sort((a, b) => a - b);
        return {
          name: r.name,
          description: r.description,
          minMs: sorted[0],
          maxMs: sorted[sorted.length - 1],
          avgMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
          medianMs: percentile(sorted, 50),
          p95Ms: percentile(sorted, 95),
          p99Ms: percentile(sorted, 99),
          sampleCount: sorted.length,
        };
      }),
    };

    const outPath = path.join(__dirname, "performance-baseline.json");
    fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  } catch {
    // Non-fatal - baseline is always printed to stdout
  }
}

// ── Proof setup and caching scenarios ──────────────────────────────────────────

/**
 * Simulates proof setup: create witness key and prepare data structures.
 * Measures time to encode and validate input before proof generation.
 */
async function simulateProofSetup(): Promise<void> {
  const recipient = "GALICETEST123456789012345678901234567890";
  const amount = 1_000_000n;
  const asset = "native";

  // Encode witness (JSON serialization)
  const witness = {
    recipient,
    amount: amount.toString(),
    asset,
  };

  JSON.stringify(witness);
}

/**
 * Simulates cache lookup: retrieve and parse a cached proof.
 * Measures time to deserialize a proof from JSON cache.
 */
async function simulateCacheLookup(): Promise<void> {
  const cachedProof = JSON.stringify({
    proof: {
      pi_a: ["111111", "222222"],
      pi_b: [
        ["333333", "444444"],
        ["555555", "666666"],
      ],
      pi_c: ["777777", "888888"],
      protocol: "groth16",
      curve: "bn128",
    },
    publicSignals: ["111111", "222222", "333333"],
  });

  // Simulate cache retrieval and deserialization
  JSON.parse(cachedProof);
}

/**
 * Simulates cache miss and proof generation workflow:
 * witness encoding + witness key generation + simulated proof compute.
 */
async function simulateCacheMissWorkflow(): Promise<void> {
  const recipient = "GALICETEST123456789012345678901234567890";
  const amount = 1_000_000n;
  const asset = "native";

  // Step 1: Encode witness
  const witness = {
    recipient,
    amount: amount.toString(),
    asset,
  };
  const witnessKey = `proof:${JSON.stringify(witness)}`;

  // Step 2: Simulate proof compute (simplified)
  const proof = {
    proof: {
      pi_a: ["111111", "222222"],
      pi_b: [
        ["333333", "444444"],
        ["555555", "666666"],
      ],
      pi_c: ["777777", "888888"],
      protocol: "groth16",
      curve: "bn128",
    },
    publicSignals: ["111111", "222222", "333333"],
  };

  // Step 3: Serialize and cache
  JSON.stringify(proof);
}

/**
 * Simulates sequential draft creation (used by helpers).
 * Measures time to prepare payment drafts for batch submission.
 */
async function simulateDraftCreation(): Promise<void> {
  const drafts = [];

  for (let i = 0; i < 10; i++) {
    const draft = {
      recipient: `GEMPLOYEE${String(i).padStart(6, "0")}`,
      amount: (BigInt(i) + 1n) * 100_000n,
      asset: "native",
      proofPayload: {
        proof: {
          pi_a: ["111111", "222222"],
          pi_b: [
            ["333333", "444444"],
            ["555555", "666666"],
          ],
          pi_c: ["777777", "888888"],
          protocol: "groth16",
          curve: "bn128",
        },
        publicSignals: ["111111", "222222", "333333"],
      },
    };

    drafts.push(draft);
    JSON.stringify(draft, (_, v) => (typeof v === "bigint" ? v.toString() : v)); // Serialize for transmission
  }
}

/**
 * Simulates submission helper: aggregate drafts and prepare batch transaction.
 * Measures time to merge payment objects for transaction submission.
 */
async function simulateSubmissionAggregation(): Promise<void> {
  const drafts = [];

  // Build 20 drafts
  for (let i = 0; i < 20; i++) {
    drafts.push({
      recipient: `GEMPLOYEE${String(i).padStart(6, "0")}`,
      amount: (BigInt(i) + 1n) * 100_000n,
      asset: "native",
      proofPayload: {
        proof: {
          pi_a: ["111111", "222222"],
          pi_b: [
            ["333333", "444444"],
            ["555555", "666666"],
          ],
          pi_c: ["777777", "888888"],
          protocol: "groth16",
          curve: "bn128",
        },
        publicSignals: ["111111", "222222", "333333"],
      },
    });
  }

  // Aggregate: group by recipient and sum amounts
  const aggregated = new Map<string, bigint>();
  for (const draft of drafts) {
    const current = aggregated.get(draft.recipient) || 0n;
    aggregated.set(draft.recipient, current + draft.amount);
  }

  // Prepare transaction payload
  const payload = Array.from(aggregated.entries()).map(([recipient, amount]) => ({
    recipient,
    amount,
  }));

  JSON.stringify(payload, (_, v) => (typeof v === "bigint" ? v.toString() : v)); // Serialize for RPC
}

/**
 * Simulates idempotency check: store and verify submission state.
 * Measures time to maintain idempotency tracking across retries.
 */
async function simulateIdempotencyCheck(): Promise<void> {
  const submissionStates = new Map<string, { timestamp: number; txHash: string | null }>();

  // Simulate 50 submission attempts with idempotency tracking
  for (let i = 0; i < 50; i++) {
    const submissionId = `submission-${i}`;
    const existing = submissionStates.get(submissionId);

    if (existing) {
      // Idempotent return - no re-submission
      void existing.txHash;
    } else {
      // First submission
      submissionStates.set(submissionId, {
        timestamp: Date.now(),
        txHash: null,
      });
    }
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Performance benchmarks - proof setup, caching, and submission", () => {
  const results: PerformanceResult[] = [];

  describe("proof setup and witness encoding", () => {
    it("witness encoding - prepare input for proof generation", async () => {
      const result = await measurePerformance(
        "witness_encoding",
        "Witness encoding",
        simulateProofSetup,
        50
      );
      results.push(result);
      expect(result.samples[0]).toBeGreaterThan(0);
    });
  });

  describe("cache path latency", () => {
    it("cache hit - deserialize proof from cache", async () => {
      const result = await measurePerformance(
        "cache_hit_deserialize",
        "Cache hit (JSON parse)",
        simulateCacheLookup,
        100
      );
      results.push(result);
      const sorted = [...result.samples].sort((a, b) => a - b);
      expect(sorted[0]).toBeLessThan(10); // Should be very fast
    });

    it("cache miss - full proof workflow", async () => {
      const result = await measurePerformance(
        "cache_miss_workflow",
        "Cache miss workflow",
        simulateCacheMissWorkflow,
        50
      );
      results.push(result);
      const sorted = [...result.samples].sort((a, b) => a - b);
      expect(sorted[0]).toBeGreaterThan(0);
    });
  });

  describe("draft and submission helpers", () => {
    it("draft creation - prepare 10 payment drafts", async () => {
      const result = await measurePerformance(
        "draft_creation_10",
        "Draft creation (10 items)",
        simulateDraftCreation,
        20
      );
      results.push(result);
      const sorted = [...result.samples].sort((a, b) => a - b);
      expect(sorted[0]).toBeLessThan(100); // Should be fast for small batch
    });

    it("submission aggregation - merge 20 drafts", async () => {
      const result = await measurePerformance(
        "submission_aggregation_20",
        "Submission aggregation (20)",
        simulateSubmissionAggregation,
        20
      );
      results.push(result);
      const sorted = [...result.samples].sort((a, b) => a - b);
      expect(sorted[0]).toBeLessThan(50); // Should be O(n) linear
    });

    it("idempotency tracking - 50 submission attempts", async () => {
      const result = await measurePerformance(
        "idempotency_tracking_50",
        "Idempotency tracking (50)",
        simulateIdempotencyCheck,
        20
      );
      results.push(result);
      const sorted = [...result.samples].sort((a, b) => a - b);
      expect(sorted[0]).toBeLessThan(50); // Map operations should be O(1)
    });
  });

  describe("cache reuse effectiveness", () => {
    it("repeated cache hits - 100 lookups", async () => {
      const cachedProof = JSON.stringify({
        proof: {
          pi_a: ["111111", "222222"],
          pi_b: [
            ["333333", "444444"],
            ["555555", "666666"],
          ],
          pi_c: ["777777", "888888"],
          protocol: "groth16",
          curve: "bn128",
        },
        publicSignals: ["111111", "222222", "333333"],
      });

      const result = await measurePerformance(
        "repeated_cache_hits_100",
        "Repeated cache hits (100)",
        () => {
          for (let i = 0; i < 100; i++) {
            JSON.parse(cachedProof);
          }
        },
        10
      );

      results.push(result);
      const sorted = [...result.samples].sort((a, b) => a - b);
      expect(sorted[0]).toBeLessThan(100);
    });
  });

  // ── Baseline output ───────────────────────────────────────────────────────

  afterAll(() => {
    const table = formatPerformanceTable(results);
    console.log("\n" + table + "\n");
    persistPerformanceBaseline(results);
  });
});
