/**
 * Memory benchmarking utilities for the ZK Payroll SDK.
 *
 * Measures heap and ArrayBuffer pressure before and after each scenario so
 * contributors can track regressions and guide optimisation work.
 *
 * ## Running with GC exposure (recommended)
 * ```
 * node --expose-gc node_modules/.bin/jest --config packages/core/jest.config.js \
 *   tests/benchmarks/memory-benchmarks.test.ts --no-coverage --runInBand
 * ```
 *
 * ## Browser-like environments
 * Replace `sampleMemory()` with a call to `performance.memory` (Chrome / Edge
 * DevTools) or the `measureUserAgentSpecificMemory()` API (cross-origin
 * isolated contexts). The `BenchmarkResult` shape is identical.
 */

/** Snapshot of Node.js memory counters, all values in MiB. */
export interface MemorySample {
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rssMB: number;
  arrayBuffersMB: number;
}

/** Stats produced by a single benchmark scenario. */
export interface BenchmarkResult {
  /** Short identifier — used as a key in baseline comparisons. */
  scenario: string;
  /** Human-readable sentence describing what was measured. */
  description: string;
  /** Number of measured iterations (excluding warmup). */
  runs: number;
  /** Average change in JS heap across measured runs. Can be negative after GC. */
  avgHeapDeltaMB: number;
  /** Highest heap observed across measured runs. */
  peakHeapUsedMB: number;
  /**
   * Average change in externally allocated ArrayBuffers.
   * This is the primary metric for artifact-load scenarios.
   */
  avgArrayBuffersDeltaMB: number;
  /** Average change in external (off-V8-heap) memory. */
  avgExternalDeltaMB: number;
  /** Average wall-clock duration in milliseconds. */
  avgDurationMs: number;
}

/** Baseline document written to disk after each benchmark run. */
export interface BenchmarkBaseline {
  generatedAt: string;
  nodeVersion: string;
  /** e.g. "darwin/arm64" */
  platform: string;
  results: BenchmarkResult[];
}

const MB = 1 / (1024 * 1024);

/** Capture current process memory counters. */
export function sampleMemory(): MemorySample {
  const m = process.memoryUsage();
  return {
    heapUsedMB: m.heapUsed * MB,
    heapTotalMB: m.heapTotal * MB,
    externalMB: m.external * MB,
    rssMB: m.rss * MB,
    arrayBuffersMB: m.arrayBuffers * MB,
  };
}

/** Nudge V8's GC if the process was started with --expose-gc. */
export function gcHint(): void {
  const g = global as unknown as { gc?: () => void };
  if (typeof g.gc === "function") g.gc();
}

/**
 * Runs a benchmark scenario and returns memory/timing statistics.
 *
 * @param scenario     - Short identifier (no spaces)
 * @param description  - Human-readable description for the baseline table
 * @param fn           - The operation to measure
 * @param warmupRuns   - Pre-measurement runs to let V8 JIT and stabilise GC
 * @param measuredRuns - Number of measured iterations for averaging
 */
export async function measureMemory(
  scenario: string,
  description: string,
  fn: () => Promise<void> | void,
  warmupRuns = 1,
  measuredRuns = 3
): Promise<BenchmarkResult> {
  // Warmup
  for (let i = 0; i < warmupRuns; i++) {
    await fn();
  }
  gcHint();

  const heapDeltas: number[] = [];
  const abDeltas: number[] = [];
  const externalDeltas: number[] = [];
  const durations: number[] = [];
  let peakHeap = 0;

  for (let i = 0; i < measuredRuns; i++) {
    gcHint();
    const before = sampleMemory();
    const t0 = Date.now();
    await fn();
    const after = sampleMemory();
    const elapsed = Date.now() - t0;

    heapDeltas.push(after.heapUsedMB - before.heapUsedMB);
    abDeltas.push(after.arrayBuffersMB - before.arrayBuffersMB);
    externalDeltas.push(after.externalMB - before.externalMB);
    durations.push(elapsed);
    peakHeap = Math.max(peakHeap, after.heapUsedMB);
  }

  const avg = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    scenario,
    description,
    runs: measuredRuns,
    avgHeapDeltaMB: avg(heapDeltas),
    peakHeapUsedMB: peakHeap,
    avgArrayBuffersDeltaMB: avg(abDeltas),
    avgExternalDeltaMB: avg(externalDeltas),
    avgDurationMs: avg(durations),
  };
}

/**
 * Wraps a list of results with environment metadata for archival.
 */
export function captureBaseline(results: BenchmarkResult[]): BenchmarkBaseline {
  return {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    results,
  };
}

/**
 * Renders a contributor-friendly ASCII table from a baseline document.
 *
 * ```
 * ---------------------------+-----------------------------------+...
 *  Scenario                  | Description                       |...
 * ---------------------------+-----------------------------------+...
 *  cold_artifact_small       | Cold: 500 KB wasm + 1 MB zkey     |...
 * ```
 */
export function formatTable(baseline: BenchmarkBaseline): string {
  const headers = [
    "Scenario",
    "Description",
    "Heap Δ MB",
    "ABuf Δ MB",
    "Ext Δ MB",
    "Avg ms",
    "Runs",
  ];

  const rows = baseline.results.map((r) => [
    r.scenario,
    r.description,
    r.avgHeapDeltaMB.toFixed(2),
    r.avgArrayBuffersDeltaMB.toFixed(2),
    r.avgExternalDeltaMB.toFixed(2),
    r.avgDurationMs.toFixed(0),
    String(r.runs),
  ]);

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));

  const cell = (s: string, w: number): string => ` ${s.padEnd(w)} `;
  const divider = widths.map((w) => "-".repeat(w + 2)).join("+");
  const headerRow = headers.map((h, i) => cell(h, widths[i])).join("|");
  const dataRows = rows.map((row) => row.map((c, i) => cell(c, widths[i])).join("|"));

  const lines = [
    `Memory Benchmark Baseline — ${baseline.generatedAt}`,
    `Node ${baseline.nodeVersion}  |  Platform: ${baseline.platform}`,
    "",
    divider,
    headerRow,
    divider,
    ...dataRows,
    divider,
  ];

  return lines.join("\n");
}
