/**
 * Payroll Archival Eligibility Reader
 *
 * Provides batch evaluation and age-based filtering for payroll run archival eligibility.
 * Wraps the single-run evaluator with additional criteria for automated archival workflows.
 *
 * ## Privacy & Security Guarantees
 * - Run identifiers are redacted in public-facing results by default.
 * - No sensitive payroll amounts are included in eligibility results.
 */

import { PayrollRunItem } from "./types";
import {
  evaluateArchiveEligibility,
  ArchiveEligibilityEvaluation,
  redactRunId,
} from "./eligibility";

/** Configuration for the archival eligibility reader */
export interface ArchivalEligibilityReaderOptions {
  /** Minimum age in milliseconds a finalized run must have before it can be archived. Defaults to 0 (no minimum). */
  minimumAgeMs?: number;
  /** Reference timestamp for age calculation. Defaults to Date.now(). */
  referenceTime?: number | Date;
  /** Redact run identifiers in results. Defaults to true. */
  redact?: boolean;
}

/** Extended eligibility result including age check */
export interface ArchivalEligibilityReadResult {
  /** The base eligibility evaluation */
  evaluation: ArchiveEligibilityEvaluation;
  /** Whether the run meets the minimum age requirement */
  meetsAgeRequirement: boolean;
  /** Age of the run in milliseconds (if finalizedAt is available) */
  ageMs?: number;
  /** Overall eligibility combining base evaluation and age check */
  isArchivable: boolean;
  /** Reason if not archivable due to age */
  ageBlockerReason?: string;
}

/** Batch result for reading archival eligibility across multiple runs */
export interface ArchivalEligibilityBatchResult {
  /** Total runs evaluated */
  totalRuns: number;
  /** Count of runs eligible for archival */
  archivableCount: number;
  /** Count of runs blocked from archival */
  blockedCount: number;
  /** Individual results per run */
  results: ArchivalEligibilityReadResult[];
  /** Summary of blocker codes encountered */
  blockerSummary: Record<string, number>;
  /** Count of runs blocked by age requirement */
  ageBlockedCount: number;
}

/**
 * Read archival eligibility for a single payroll run with age-based criteria.
 */
export function readArchivalEligibility(
  run: PayrollRunItem,
  options: ArchivalEligibilityReaderOptions = {}
): ArchivalEligibilityReadResult {
  const { minimumAgeMs = 0, referenceTime, redact = true } = options;

  const refMs =
    referenceTime instanceof Date ? referenceTime.getTime() : (referenceTime ?? Date.now());

  const evaluation = evaluateArchiveEligibility(run, { redact });

  // Calculate age if finalizedAt is available
  let ageMs: number | undefined;
  let meetsAgeRequirement = true;
  let ageBlockerReason: string | undefined;

  const finalizedAt = run.finalizedAt as number | undefined;
  if (finalizedAt !== undefined && finalizedAt !== null && typeof finalizedAt === "number") {
    ageMs = refMs - finalizedAt;
    if (minimumAgeMs > 0 && ageMs < minimumAgeMs) {
      meetsAgeRequirement = false;
      const remainingMs = minimumAgeMs - ageMs;
      const remainingHours = Math.ceil(remainingMs / 3_600_000);
      const idDisplay = redact
        ? redactRunId(run.runId || run.id)
        : run.runId || run.id || "unknown";
      ageBlockerReason = `Run ${idDisplay} must wait approximately ${remainingHours} more hour(s) before archival.`;
    }
  } else if (minimumAgeMs > 0 && evaluation.isEligible) {
    // If no finalizedAt but age is required and run is otherwise eligible
    meetsAgeRequirement = false;
    ageBlockerReason = "Run is missing a finalization timestamp; cannot verify age requirement.";
  }

  const isArchivable = evaluation.isEligible && meetsAgeRequirement;

  return {
    evaluation,
    meetsAgeRequirement,
    ageMs,
    isArchivable,
    ageBlockerReason,
  };
}

/**
 * Read archival eligibility for a batch of payroll runs.
 */
export function readBatchArchivalEligibility(
  runs: PayrollRunItem[],
  options: ArchivalEligibilityReaderOptions = {}
): ArchivalEligibilityBatchResult {
  const results: ArchivalEligibilityReadResult[] = [];
  const blockerSummary: Record<string, number> = {};
  let archivableCount = 0;
  let blockedCount = 0;
  let ageBlockedCount = 0;

  for (const run of runs) {
    const result = readArchivalEligibility(run, options);
    results.push(result);

    if (result.isArchivable) {
      archivableCount++;
    } else {
      blockedCount++;
      if (result.evaluation.blockerCode) {
        blockerSummary[result.evaluation.blockerCode] =
          (blockerSummary[result.evaluation.blockerCode] || 0) + 1;
      }
      if (!result.meetsAgeRequirement) {
        ageBlockedCount++;
      }
    }
  }

  return {
    totalRuns: runs.length,
    archivableCount,
    blockedCount,
    results,
    blockerSummary,
    ageBlockedCount,
  };
}

/**
 * Boolean predicate: is the run archivable considering age requirements?
 */
export function isRunArchivable(
  run: PayrollRunItem,
  options: ArchivalEligibilityReaderOptions = {}
): boolean {
  return readArchivalEligibility(run, options).isArchivable;
}
