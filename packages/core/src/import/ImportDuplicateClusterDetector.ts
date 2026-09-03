/**
 * Batch Import Duplicate Cluster Detector
 *
 * Scans a batch of imported employee records for possible duplicates across
 * four identity signals (employee id, wallet address, email hash, external
 * id) plus fuzzy name heuristics, then groups related rows into reviewable
 * clusters using union-find.
 *
 * Design goals:
 *  - Deterministic: identical input always yields identical output.
 *  - Reviewable: every cluster carries machine-readable confidence reasons
 *    and redacted previews so UIs can triage true positives from noise.
 *  - Safe: previews never expose full wallets, email hashes, names, or
 *    salaries.
 */

import {
  DuplicateClusterOptions,
  DuplicateConfidence,
  DuplicateMatchEvidence,
  DuplicateMatchField,
  DuplicateMatchKind,
  DuplicateReasonCode,
  ImportDuplicateAnalysis,
  ImportEmployeeRecord,
  ReviewableDuplicateCluster,
} from "./types";
import { namesAreSimilar, normalizeIdentifier } from "./fuzzyMatch";
import { buildRedactedPreview } from "./previewRedaction";

const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = {
  exact: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/** Disjoint-set (union-find) with path compression for deterministic clustering. */
class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = new Array<number>(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(i: number): number {
    let current = i;
    while (this.parent[current] !== current) {
      this.parent[current] = this.parent[this.parent[current]];
      current = this.parent[current];
    }
    return current;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return;
    }
    // Always attach the higher root under the lower root for determinism.
    if (rootA < rootB) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootA] = rootB;
    }
  }
}

/** Callback receiving a single piece of pair-level duplicate evidence. */
type EvidenceSink = (
  leftIndex: number,
  rightIndex: number,
  field: DuplicateMatchField,
  kind: DuplicateMatchKind,
  reason: DuplicateReasonCode,
  confidence: DuplicateConfidence
) => void;

/**
 * Detects duplicate employees in an imported batch and groups them into
 * clusters with confidence reasons and redacted previews.
 *
 * @param records — Imported employee records to analyse.
 * @param options — Optional sensitivity and redaction configuration.
 * @returns Deterministic analysis with reviewable duplicate clusters.
 *
 * @example
 * const analysis = detectDuplicateClusters(importRows);
 * for (const cluster of analysis.clusters) {
 *   console.log(cluster.id, cluster.confidence, cluster.reasons);
 *   renderPreviews(cluster.previews);
 * }
 */
export function detectDuplicateClusters(
  records: ImportEmployeeRecord[],
  options: DuplicateClusterOptions = {}
): ImportDuplicateAnalysis {
  const fuzzyThreshold = options.fuzzyNameThreshold ?? 2;
  const normalizedAsExact = options.treatNormalizedAsExact ?? false;
  const minClusterSize = Math.max(options.minClusterSize ?? 2, 2);
  const placeholder = options.redactionPlaceholder ?? "[redacted]";

  const unionFind = new UnionFind(records.length);
  const evidenceByPair = new Map<string, DuplicateMatchEvidence>();

  const sink: EvidenceSink = (leftIndex, rightIndex, field, kind, reason, confidence) => {
    unionFind.union(leftIndex, rightIndex);
    const key = `${leftIndex}:${rightIndex}`;
    // Keep the first (strongest) piece of evidence seen per pair.
    if (!evidenceByPair.has(key)) {
      evidenceByPair.set(key, { leftIndex, rightIndex, field, kind, confidence, reason });
    }
  };

  collectIdentityEvidence(records, normalizedAsExact, sink);
  collectFuzzyNameEvidence(records, fuzzyThreshold, sink);

  const clusters = buildClusters(records, unionFind, evidenceByPair, minClusterSize, placeholder);

  const memberSet = new Set<number>();
  for (const cluster of clusters) {
    for (const index of cluster.memberIndices) {
      memberSet.add(index);
    }
  }

  return {
    clusters,
    totalRecords: records.length,
    duplicateRowCount: memberSet.size,
    hasDuplicates: clusters.length > 0,
  };
}

/**
 * Groups records by each exact-match identity field and emits evidence for
 * every collision. Normalized-only collisions (case/whitespace differences)
 * are reported separately with lower confidence.
 */
function collectIdentityEvidence(
  records: ImportEmployeeRecord[],
  normalizedAsExact: boolean,
  sink: EvidenceSink
): void {
  const targets: Array<{
    field: DuplicateMatchField;
    exactReason: DuplicateReasonCode;
    normalizedReason: DuplicateReasonCode | null;
  }> = [
    {
      field: "employeeId",
      exactReason: "exact_employee_id",
      normalizedReason: "case_insensitive_employee_id",
    },
    {
      field: "walletAddress",
      exactReason: "exact_wallet_address",
      normalizedReason: "case_insensitive_wallet_address",
    },
    { field: "emailHash", exactReason: "exact_email_hash", normalizedReason: null },
    {
      field: "externalId",
      exactReason: "exact_external_id",
      normalizedReason: "case_insensitive_external_id",
    },
  ];

  for (const target of targets) {
    const rawGroups = new Map<string, number[]>();

    for (let i = 0; i < records.length; i++) {
      const raw = safeString(records[i][target.field]);
      if (raw.length === 0) {
        continue;
      }
      pushToGroup(rawGroups, raw, i);
    }

    // Pass 1: byte-equal collisions (strongest evidence).
    for (const indices of rawGroups.values()) {
      if (indices.length < 2) {
        continue;
      }
      for (let j = 1; j < indices.length; j++) {
        sink(indices[j - 1], indices[j], target.field, "exact", target.exactReason, "exact");
      }
    }

    // Pass 2: normalized-only collisions (differ beyond case/whitespace).
    if (target.normalizedReason === null) {
      continue;
    }
    const normalizedGroups = new Map<string, number[]>();
    for (const [raw, indices] of rawGroups) {
      const normalized = normalizeIdentifier(raw);
      if (normalized !== null) {
        for (const index of indices) {
          pushToGroup(normalizedGroups, normalized, index);
        }
      }
    }
    for (const [normalized, indices] of sortedNormalizedGroups(normalizedGroups)) {
      void normalized;
      if (indices.length < 2) {
        continue;
      }
      for (let a = 0; a < indices.length; a++) {
        for (let b = a + 1; b < indices.length; b++) {
          const leftRaw = safeString(records[indices[a]][target.field]);
          const rightRaw = safeString(records[indices[b]][target.field]);
          if (leftRaw === rightRaw) {
            continue; // already reported by the exact pass above
          }
          sink(
            indices[a],
            indices[b],
            target.field,
            "normalized",
            target.normalizedReason,
            normalizedAsExact ? "exact" : "high"
          );
        }
      }
    }
  }
}

/**
 * Emits fuzzy name-based evidence. Name-only similarity is weak ("low"),
 * but is strengthened when department or salary+asset also agree.
 */
function collectFuzzyNameEvidence(
  records: ImportEmployeeRecord[],
  threshold: number,
  sink: EvidenceSink
): void {
  for (let a = 0; a < records.length; a++) {
    for (let b = a + 1; b < records.length; b++) {
      const left = records[a];
      const right = records[b];
      if (!namesAreSimilar(left.name, right.name, threshold)) {
        continue;
      }

      const sameDepartment =
        normalizeIdentifier(left.department) !== null &&
        normalizeIdentifier(left.department) === normalizeIdentifier(right.department);

      const salaryLeft = normalizeAmount(left.salary);
      const salaryRight = normalizeAmount(right.salary);
      const sameSalaryAsset =
        salaryLeft !== null &&
        salaryRight !== null &&
        salaryLeft === salaryRight &&
        normalizeIdentifier(left.asset) !== null &&
        normalizeIdentifier(left.asset) === normalizeIdentifier(right.asset);

      if (sameDepartment && sameSalaryAsset) {
        sink(a, b, "name", "fuzzy", "same_name_department_salary_asset", "high");
      } else if (sameDepartment) {
        sink(a, b, "name", "fuzzy", "similar_name_same_department", "medium");
      } else if (sameSalaryAsset) {
        sink(a, b, "name", "fuzzy", "similar_name_same_salary_asset", "medium");
      } else {
        sink(a, b, "name", "fuzzy", "similar_name_only", "low");
      }
    }
  }
}

/**
 * Builds deterministic reviewable clusters from the union-find structure.
 */
function buildClusters(
  records: ImportEmployeeRecord[],
  unionFind: UnionFind,
  evidenceByPair: Map<string, DuplicateMatchEvidence>,
  minClusterSize: number,
  placeholder: string
): ReviewableDuplicateCluster[] {
  const groupsByRoot = new Map<number, number[]>();
  for (let i = 0; i < records.length; i++) {
    pushToGroup(groupsByRoot, unionFind.find(i), i);
  }

  const pending: Array<{ members: number[]; root: number }> = [];
  for (const [rootKey, members] of groupsByRoot) {
    if (members.length >= minClusterSize) {
      pending.push({ members, root: Number(rootKey) });
    }
  }
  // Order clusters by their first member index.
  pending.sort((a, b) => Math.min(...a.members) - Math.min(...b.members));

  return pending.map(({ members }, clusterOrdinal) => {
    const memberSet = new Set(members);
    const evidence: DuplicateMatchEvidence[] = [];
    let confidence: DuplicateConfidence = "low";

    for (const item of evidenceByPair.values()) {
      if (memberSet.has(item.leftIndex) && memberSet.has(item.rightIndex)) {
        evidence.push(item);
        if (CONFIDENCE_RANK[item.confidence] > CONFIDENCE_RANK[confidence]) {
          confidence = item.confidence;
        }
      }
    }

    evidence.sort(compareEvidence);

    const memberIndices = [...members].sort((a, b) => a - b);
    const reasons = [...new Set(evidence.map((e) => e.reason))].sort();
    const previews = memberIndices.map((index) =>
      buildRedactedPreview(records[index], index, placeholder)
    );

    return {
      id: `dup-${String(clusterOrdinal + 1).padStart(3, "0")}`,
      memberIndices,
      confidence,
      reasons,
      evidence,
      previews,
    };
  });
}

function compareEvidence(a: DuplicateMatchEvidence, b: DuplicateMatchEvidence): number {
  if (a.leftIndex !== b.leftIndex) {
    return a.leftIndex - b.leftIndex;
  }
  if (a.rightIndex !== b.rightIndex) {
    return a.rightIndex - b.rightIndex;
  }
  if (a.field !== b.field) {
    return a.field.localeCompare(b.field);
  }
  return a.reason.localeCompare(b.reason);
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAmount(value: unknown): string | null {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function pushToGroup<K>(map: Map<K, number[]>, key: K, index: number): void {
  const group = map.get(key);
  if (group) {
    group.push(index);
  } else {
    map.set(key, [index]);
  }
}

/** Normalized groups ordered by smallest member index for determinism. */
function sortedNormalizedGroups(map: Map<string, number[]>): Array<[string, number[]]> {
  return [...map.entries()].sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]));
}
