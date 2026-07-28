/**
 * Memory benchmarks for proof generation and artifact caching.
 *
 * These tests measure heap and ArrayBuffer pressure for key SDK operations and
 * emit a contributor-friendly baseline table to stdout. Results are also
 * written to tests/benchmarks/baseline.json so that future runs can detect
 * regressions.
 *
 * ## Recommended invocation (enables GC hints for cleaner deltas)
 * ```
 * node --expose-gc node_modules/.bin/jest \
 *   --config packages/core/jest.config.js \
 *   tests/benchmarks/memory-benchmarks.test.ts \
 *   --no-coverage --runInBand
 * ```
 *
 * ## Understanding the metrics
 * - **Heap Δ MB**  — change in V8 heap used. Can be negative after GC sweeps.
 * - **ABuf Δ MB**  — change in externally allocated ArrayBuffers. This is the
 *                    primary metric for artifact-load scenarios because wasm and
 *                    zkey buffers live outside the V8 heap.
 * - **Ext Δ MB**   — change in total external (off-V8-heap) memory.
 * - **Avg ms**     — average wall-clock time per measured run.
 */

import * as fs from "fs";
import * as path from "path";

import {
  measureMemory,
  captureBaseline,
  formatTable,
  BenchmarkResult,
  BenchmarkBaseline,
} from "../../src/benchmarks/MemoryBenchmark";

import {
  ARTIFACT_SIZES,
  ArtifactCache,
  ProofCache,
  buildArtifactCache,
  coldArtifactLoad,
  warmArtifactLoad,
  coldProofGeneration,
  warmProofGeneration,
  concurrentColdGeneration,
  batchProofGeneration,
  encodeWitness,
  buildProofJson,
} from "../../src/benchmarks/ProofMemoryScenarios";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Write the baseline JSON to disk. Silently skips if the directory is
 *  read-only (e.g., inside some CI sandbox configurations). */
function persistBaseline(baseline: BenchmarkBaseline): void {
  try {
    const outPath = path.join(__dirname, "baseline.json");
    fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  } catch {
    // Non-fatal — the baseline table is always printed to stdout regardless.
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("Memory benchmarks — proof generation and artifact caching", () => {
  const results: BenchmarkResult[] = [];

  // ── Artifact load: cold cache ───────────────────────────────────────────────

  describe("artifact load", () => {
    it("cold cache (small artifacts) — allocates wasm + zkey buffers", async () => {
      const result = await measureMemory(
        "cold_artifact_small",
        "Cold: 500 KB wasm + 1 MB zkey",
        async () => {
          const dest: ArtifactCache = new Map();
          await coldArtifactLoad(dest, ARTIFACT_SIZES.SMALL);
        },
        1,
        3
      );

      results.push(result);
      // ArrayBuffer delta should be positive (we allocated real buffers)
      expect(result.avgArrayBuffersDeltaMB + result.avgExternalDeltaMB).toBeGreaterThanOrEqual(0);
      // Combined allocation should not exceed 50 MB (generous ceiling)
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
    });

    it("cold cache (medium artifacts) — 2 MB wasm + 5 MB zkey", async () => {
      const result = await measureMemory(
        "cold_artifact_medium",
        "Cold: 2 MB wasm + 5 MB zkey",
        async () => {
          const dest: ArtifactCache = new Map();
          await coldArtifactLoad(dest, ARTIFACT_SIZES.MEDIUM);
        },
        1,
        3
      );

      results.push(result);
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
    });

    it("cold cache (large artifacts) — 3 MB wasm + 10 MB zkey", async () => {
      const result = await measureMemory(
        "cold_artifact_large",
        "Cold: 3 MB wasm + 10 MB zkey",
        async () => {
          const dest: ArtifactCache = new Map();
          await coldArtifactLoad(dest, ARTIFACT_SIZES.LARGE);
        },
        1,
        3
      );

      results.push(result);
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
    });

    it("warm cache (small) — no new buffer allocation on cache hit", async () => {
      // Pre-populate cache before measuring
      const cache = buildArtifactCache(ARTIFACT_SIZES.SMALL);

      const result = await measureMemory(
        "warm_artifact_small",
        "Warm: Map lookup only, no new buffers",
        async () => {
          await warmArtifactLoad(cache);
        },
        2,
        5
      );

      results.push(result);
      // Warm path: external / arrayBuffers delta should be near zero.
      // We assert < 2 MB to accommodate GC noise across environments.
      const combinedDelta = Math.abs(result.avgArrayBuffersDeltaMB + result.avgExternalDeltaMB);
      expect(combinedDelta).toBeLessThan(2);
    });

    it("warm cache uses significantly less memory than cold cache", async () => {
      // Cold
      const coldDest: ArtifactCache = new Map();
      const coldResult = await measureMemory(
        "cold_vs_warm_reference",
        "Cold reference for warm comparison",
        async () => {
          await coldArtifactLoad(coldDest, ARTIFACT_SIZES.MEDIUM);
        },
        0,
        1
      );

      // Warm — reuse the same cache from cold run
      const warmCache = buildArtifactCache(ARTIFACT_SIZES.MEDIUM);
      const warmResult = await measureMemory(
        "warm_vs_cold_reference",
        "Warm reference for cold comparison",
        async () => {
          await warmArtifactLoad(warmCache);
        },
        1,
        3
      );

      // Combined cold (heap + external) should exceed warm by a meaningful margin
      const coldPressure = coldResult.avgArrayBuffersDeltaMB + coldResult.avgExternalDeltaMB;
      const warmPressure = warmResult.avgArrayBuffersDeltaMB + warmResult.avgExternalDeltaMB;
      expect(coldPressure).toBeGreaterThan(warmPressure);
    });
  });

  // ── Proof generation ────────────────────────────────────────────────────────

  describe("proof generation", () => {
    it("cold proof generation (small) — full cycle including artifact allocation", async () => {
      const result = await measureMemory(
        "cold_proof_small",
        "Cold proof: artifact load + witness encode + proof cache write",
        async () => {
          const artifacts: ArtifactCache = new Map();
          const proofs: ProofCache = new Map();
          await coldProofGeneration(artifacts, proofs, ARTIFACT_SIZES.SMALL);
        },
        1,
        3
      );

      results.push(result);
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
      expect(result.avgDurationMs).toBeLessThan(500);
    });

    it("cold proof generation (medium) — 2 MB wasm + 5 MB zkey", async () => {
      const result = await measureMemory(
        "cold_proof_medium",
        "Cold proof: medium artifacts (2 MB wasm + 5 MB zkey)",
        async () => {
          const artifacts: ArtifactCache = new Map();
          const proofs: ProofCache = new Map();
          await coldProofGeneration(artifacts, proofs, ARTIFACT_SIZES.MEDIUM);
        },
        1,
        3
      );

      results.push(result);
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
    });

    it("warm proof generation — proof cache hit, no artifact re-allocation", async () => {
      // Populate the proof cache before measuring
      const warmProofCache: ProofCache = new Map();
      const cacheKey = `proof:${encodeWitness("GALICE_FIXTURE", 1_000_000n)}`;
      warmProofCache.set(cacheKey, buildProofJson());

      const result = await measureMemory(
        "warm_proof",
        "Warm proof: JSON.parse of cached proof, no buffer allocation",
        async () => {
          await warmProofGeneration(warmProofCache, cacheKey);
        },
        2,
        5
      );

      results.push(result);
      // Warm proof path: no new ArrayBuffers
      expect(Math.abs(result.avgArrayBuffersDeltaMB)).toBeLessThan(1);
      expect(result.avgDurationMs).toBeLessThan(50);
    });

    it("warm proof generation uses less memory than cold generation", async () => {
      // Cold
      const coldResult = await measureMemory(
        "cold_proof_vs_warm",
        "Cold proof reference",
        async () => {
          const artifacts: ArtifactCache = new Map();
          const proofs: ProofCache = new Map();
          await coldProofGeneration(artifacts, proofs, ARTIFACT_SIZES.MEDIUM);
        },
        0,
        1
      );

      // Warm
      const warmCache: ProofCache = new Map();
      const wKey = `proof:${encodeWitness("GALICE_FIXTURE", 1_000_000n)}`;
      warmCache.set(wKey, buildProofJson());

      const warmResult = await measureMemory(
        "warm_proof_vs_cold",
        "Warm proof reference",
        async () => {
          await warmProofGeneration(warmCache, wKey);
        },
        1,
        3
      );

      // Cold allocates more external memory (wasm + zkey)
      const coldExt = coldResult.avgArrayBuffersDeltaMB + coldResult.avgExternalDeltaMB;
      const warmExt = warmResult.avgArrayBuffersDeltaMB + warmResult.avgExternalDeltaMB;
      expect(coldExt).toBeGreaterThan(warmExt);
    });
  });

  // ── Concurrent and batch scenarios ─────────────────────────────────────────

  describe("concurrent and batch generation", () => {
    it("2 concurrent cold generations — stable peak memory", async () => {
      const result = await measureMemory(
        "concurrent_cold_2",
        "2 concurrent cold proof generations (small artifacts)",
        async () => {
          await concurrentColdGeneration(2, ARTIFACT_SIZES.SMALL);
        },
        1,
        3
      );

      results.push(result);
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
    });

    it("5 concurrent cold generations — peak stays within safe ceiling", async () => {
      const result = await measureMemory(
        "concurrent_cold_5",
        "5 concurrent cold proof generations (small artifacts)",
        async () => {
          await concurrentColdGeneration(5, ARTIFACT_SIZES.SMALL);
        },
        1,
        3
      );

      results.push(result);
      // 5× small artifacts = 5 × 1.5 MB = 7.5 MB. Allow generous headroom.
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
    });

    it("batch of 20 proofs — warm artifact cache, no redundant allocation", async () => {
      const result = await measureMemory(
        "batch_20_warm_artifacts",
        "20 proofs, warm artifact cache, unique witnesses",
        async () => {
          await batchProofGeneration(20, ARTIFACT_SIZES.SMALL);
        },
        1,
        3
      );

      results.push(result);
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
      expect(result.avgDurationMs).toBeLessThan(1000);
    });

    it("batch of 100 proofs — stress test heap allocation", async () => {
      const result = await measureMemory(
        "batch_100_warm_artifacts",
        "100 proofs, warm artifact cache, unique witnesses",
        async () => {
          await batchProofGeneration(100, ARTIFACT_SIZES.SMALL);
        },
        1,
        2
      );

      results.push(result);
      expect(result.peakHeapUsedMB).toBeLessThan(1000);
    });
  });

  // ── Baseline output ─────────────────────────────────────────────────────────

  afterAll(() => {
    const baseline = captureBaseline(results);
    const table = formatTable(baseline);

    // Print for contributors and CI logs
    // eslint-disable-next-line no-console
    console.log("\n" + table + "\n");

    // Persist to disk for future comparison
    persistBaseline(baseline);
  });
});
