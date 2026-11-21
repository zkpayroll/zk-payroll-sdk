import { createHash } from "crypto";
import { ZkPayrollError } from "../core/errors";

export type SalaryCommitmentVersion = 1 | 2 | 3;

export const SUPPORTED_SALARY_COMMITMENT_VERSIONS: readonly SalaryCommitmentVersion[] =
  Object.freeze([1, 2, 3]);

export const LATEST_SALARY_COMMITMENT_VERSION: SalaryCommitmentVersion = 3;

export const ALLOWED_SALARY_COMMITMENT_VERSION_UPGRADES: Readonly<
  Record<SalaryCommitmentVersion, readonly SalaryCommitmentVersion[]>
> = Object.freeze({
  1: Object.freeze([1, 2, 3]) as readonly SalaryCommitmentVersion[],
  2: Object.freeze([2, 3]) as readonly SalaryCommitmentVersion[],
  3: Object.freeze([3]) as readonly SalaryCommitmentVersion[],
});

export type SalaryCommitmentVersionStatus = "ACTIVE" | "SUPERSEDED" | "RETIRED";

export interface SalaryCommitmentVersionSnapshot {
  readonly snapshotId: string;
  readonly scopeId: string;
  readonly commitmentVersion: SalaryCommitmentVersion;
  readonly commitmentDigest: string;
  readonly nullifierDigest?: string;
  readonly status: SalaryCommitmentVersionStatus;
  readonly revision: number;
  readonly createdAt: number;
  readonly previousHash?: string;
  readonly stateHash: string;
}

export const SalaryCommitmentVersionErrorCode = {
  UNSUPPORTED_VERSION: "SALARY_COMMITMENT_VERSION_UNSUPPORTED",
  VERSION_MISMATCH: "SALARY_COMMITMENT_VERSION_MISMATCH",
  VERSION_HEADER_MISSING: "SALARY_COMMITMENT_VERSION_HEADER_MISSING",
  VERSION_DOWNGRADE: "SALARY_COMMITMENT_VERSION_DOWNGRADE",
  DIGEST_MISMATCH: "SALARY_COMMITMENT_DIGEST_MISMATCH",
  SNAPSHOT_NOT_FOUND: "SALARY_COMMITMENT_SNAPSHOT_NOT_FOUND",
  SNAPSHOT_NOT_ACTIVE: "SALARY_COMMITMENT_SNAPSHOT_NOT_ACTIVE",
  DUPLICATE_SNAPSHOT: "SALARY_COMMITMENT_SNAPSHOT_DUPLICATE",
  NULLIFIER_REUSE: "SALARY_COMMITMENT_NULLIFIER_REUSE",
  STALE_REVISION: "SALARY_COMMITMENT_STALE_REVISION",
  STATE_INTEGRITY_COMPROMISED: "SALARY_COMMITMENT_STATE_INTEGRITY_COMPROMISED",
  INVALID_IDENTIFIER: "SALARY_COMMITMENT_INVALID_IDENTIFIER",
  INVALID_DIGEST: "SALARY_COMMITMENT_INVALID_DIGEST",
} as const;

export type SalaryCommitmentVersionErrorCode =
  (typeof SalaryCommitmentVersionErrorCode)[keyof typeof SalaryCommitmentVersionErrorCode];

const SAFE_CONTEXT_KEY_ALLOWLIST: ReadonlySet<string> = new Set([
  "field",
  "expectedVersion",
  "currentVersion",
  "expectedRevision",
  "snapshotId",
  "revision",
]);

const SENSITIVE_CONTEXT_KEY_REGEX =
  /(salary|recipient|address|amount|secret|key|priv|token|nullifier|blinder|digest|hash|preimage|employee)/i;

export class SalaryCommitmentVersionError extends ZkPayrollError {
  public readonly versionCode: SalaryCommitmentVersionErrorCode;

  constructor(
    message: string,
    code: SalaryCommitmentVersionErrorCode = SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    const safeContext: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (!SAFE_CONTEXT_KEY_ALLOWLIST.has(key) && SENSITIVE_CONTEXT_KEY_REGEX.test(key)) {
        continue;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        safeContext[key] = value;
      }
    }
    super(`[${code}] ${message}`, code, safeContext, cause);
    this.name = "SalaryCommitmentVersionError";
    this.versionCode = code;
  }
}

export function isSupportedSalaryCommitmentVersion(
  value: unknown
): value is SalaryCommitmentVersion {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (SUPPORTED_SALARY_COMMITMENT_VERSIONS as readonly number[]).includes(value)
  );
}

export function parseSalaryCommitmentVersion(value: unknown): SalaryCommitmentVersion {
  if (isSupportedSalaryCommitmentVersion(value)) return value;
  if (typeof value === "string") {
    const match = /^(?:v)?([1-3])$/i.exec(value.trim());
    if (match) return Number(match[1]) as SalaryCommitmentVersion;
  }
  throw new SalaryCommitmentVersionError(
    "Unsupported salary commitment version. Use a supported V1, V2, or V3 version header before proof witness compilation.",
    SalaryCommitmentVersionErrorCode.UNSUPPORTED_VERSION,
    { field: "commitmentVersion" }
  );
}

export function assertSalaryCommitmentVersionMatches(
  actual: unknown,
  expected: SalaryCommitmentVersion
): void {
  const parsed = parseSalaryCommitmentVersion(actual);
  if (parsed !== expected) {
    throw new SalaryCommitmentVersionError(
      "Salary commitment version does not match the active snapshot. Reload the current snapshot before compiling the witness.",
      SalaryCommitmentVersionErrorCode.VERSION_MISMATCH,
      { expectedVersion: expected, field: "commitmentVersion" }
    );
  }
}

export function assertWitnessCommitmentVersion(
  witness: unknown,
  expected: SalaryCommitmentVersion
): void {
  if (
    !witness ||
    typeof witness !== "object" ||
    Array.isArray(witness) ||
    (witness as Record<string, unknown>).commitmentVersion === undefined
  ) {
    throw new SalaryCommitmentVersionError(
      "Proof witness is missing a salary commitment version header. Read the version from the active commitment snapshot.",
      SalaryCommitmentVersionErrorCode.VERSION_HEADER_MISSING,
      { field: "commitmentVersion" }
    );
  }
  assertSalaryCommitmentVersionMatches(
    (witness as Record<string, unknown>).commitmentVersion,
    expected
  );
}

export function computeSalaryCommitmentVersionStateHash(
  snapshot: Omit<SalaryCommitmentVersionSnapshot, "stateHash">
): string {
  const payload = [
    "zkpayroll:salary-commitment-version-state:v1",
    snapshot.snapshotId,
    snapshot.scopeId,
    String(snapshot.commitmentVersion),
    snapshot.commitmentDigest,
    snapshot.nullifierDigest ?? "",
    snapshot.status,
    String(snapshot.revision),
    String(snapshot.createdAt),
    snapshot.previousHash ?? "GENESIS",
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function verifySalaryCommitmentVersionSnapshotIntegrity(
  snapshot: SalaryCommitmentVersionSnapshot
): boolean {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.stateHash) return false;
  return snapshot.stateHash === computeSalaryCommitmentVersionStateHash(snapshot);
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SalaryCommitmentVersionError(
      "Snapshot and scope identifiers must be non-empty strings.",
      SalaryCommitmentVersionErrorCode.INVALID_IDENTIFIER,
      { field }
    );
  }
  return value.trim();
}

function normalizeDigest(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new SalaryCommitmentVersionError(
      "Invalid commitment digest. Provide a 32-byte hexadecimal digest; raw salary or preimage values are never accepted.",
      SalaryCommitmentVersionErrorCode.INVALID_DIGEST,
      { field }
    );
  }
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(normalized)) {
    throw new SalaryCommitmentVersionError(
      "Invalid commitment digest. Provide a 32-byte hexadecimal digest; raw salary or preimage values are never accepted.",
      SalaryCommitmentVersionErrorCode.INVALID_DIGEST,
      { field }
    );
  }
  return normalized.toLowerCase();
}

function freezeSnapshot(
  snapshot: Omit<SalaryCommitmentVersionSnapshot, "stateHash"> & { stateHash: string }
): SalaryCommitmentVersionSnapshot {
  return Object.freeze({ ...snapshot });
}

function assertExpectedRevision(
  snapshot: SalaryCommitmentVersionSnapshot,
  expected?: number
): void {
  if (expected !== undefined && expected !== snapshot.revision) {
    throw new SalaryCommitmentVersionError(
      "Concurrent salary commitment snapshot change detected. Reload the snapshot and retry with the current revision.",
      SalaryCommitmentVersionErrorCode.STALE_REVISION,
      { expectedRevision: expected, revision: snapshot.revision }
    );
  }
}

export interface RegisterSalaryCommitmentVersionSnapshotParams {
  readonly snapshotId: string;
  readonly scopeId: string;
  readonly commitmentVersion: SalaryCommitmentVersion | number | string;
  readonly commitmentDigest: string;
  readonly nullifierDigest?: string;
  readonly expectedRevision?: number;
  readonly now?: number;
}

export class SalaryCommitmentVersionStateManager {
  private readonly snapshots = new Map<string, SalaryCommitmentVersionSnapshot>();
  private readonly activeByScope = new Map<string, string>();
  private readonly nullifierOwners = new Map<string, string>();

  public registerSnapshot(
    params: RegisterSalaryCommitmentVersionSnapshotParams
  ): SalaryCommitmentVersionSnapshot {
    const snapshotId = requireIdentifier(params.snapshotId, "snapshotId");
    const scopeId = requireIdentifier(params.scopeId, "scopeId");
    const commitmentVersion = parseSalaryCommitmentVersion(params.commitmentVersion);
    const commitmentDigest = normalizeDigest(params.commitmentDigest, "commitmentDigest");
    const nullifierDigest =
      params.nullifierDigest === undefined
        ? undefined
        : normalizeDigest(params.nullifierDigest, "nullifierDigest");
    const now = params.now ?? Date.now();

    const existing = this.snapshots.get(snapshotId);
    if (existing) {
      if (!verifySalaryCommitmentVersionSnapshotIntegrity(existing)) {
        throw this.integrityError(snapshotId);
      }
      if (
        existing.scopeId === scopeId &&
        existing.commitmentVersion === commitmentVersion &&
        existing.commitmentDigest === commitmentDigest &&
        existing.nullifierDigest === nullifierDigest
      ) {
        assertExpectedRevision(existing, params.expectedRevision);
        return existing;
      }
      throw new SalaryCommitmentVersionError(
        "A salary commitment snapshot with this identifier already exists. Use a new snapshot identifier.",
        SalaryCommitmentVersionErrorCode.DUPLICATE_SNAPSHOT,
        { snapshotId, field: "snapshotId" }
      );
    }

    const previous = this.getActiveSnapshot(scopeId);
    if (previous) {
      if (!verifySalaryCommitmentVersionSnapshotIntegrity(previous)) {
        throw this.integrityError(previous.snapshotId);
      }
      assertExpectedRevision(previous, params.expectedRevision);
      if (previous.commitmentVersion !== commitmentVersion) {
        if (
          !ALLOWED_SALARY_COMMITMENT_VERSION_UPGRADES[previous.commitmentVersion].includes(
            commitmentVersion
          )
        ) {
          throw new SalaryCommitmentVersionError(
            "Salary commitment versions cannot be downgraded for an active scope. Use the current version or a supported upgrade.",
            SalaryCommitmentVersionErrorCode.VERSION_DOWNGRADE,
            { expectedVersion: previous.commitmentVersion, field: "commitmentVersion" }
          );
        }
      } else if (previous.commitmentDigest !== commitmentDigest) {
        throw new SalaryCommitmentVersionError(
          "The commitment digest differs from the active snapshot. Reload the snapshot or use a new snapshot identifier for a rotation.",
          SalaryCommitmentVersionErrorCode.DIGEST_MISMATCH,
          { field: "commitmentDigest" }
        );
      }
    }

    if (nullifierDigest) {
      const owner = this.nullifierOwners.get(nullifierDigest);
      if (owner && owner !== snapshotId) {
        throw new SalaryCommitmentVersionError(
          "This proof nullifier is already bound to another commitment snapshot. Generate a fresh nullifier instead of reusing one.",
          SalaryCommitmentVersionErrorCode.NULLIFIER_REUSE,
          { field: "nullifierDigest" }
        );
      }
    }

    if (previous) {
      const supersededState = {
        ...previous,
        status: "SUPERSEDED" as const,
        revision: previous.revision + 1,
        previousHash: previous.stateHash,
      };
      this.snapshots.set(
        previous.snapshotId,
        freezeSnapshot({
          ...supersededState,
          stateHash: computeSalaryCommitmentVersionStateHash(supersededState),
        })
      );
    }

    const base = {
      snapshotId,
      scopeId,
      commitmentVersion,
      commitmentDigest,
      nullifierDigest,
      status: "ACTIVE" as const,
      revision: 1,
      createdAt: now,
      previousHash: previous?.stateHash,
    };
    const snapshot = freezeSnapshot({
      ...base,
      stateHash: computeSalaryCommitmentVersionStateHash(base),
    });
    this.snapshots.set(snapshotId, snapshot);
    this.activeByScope.set(scopeId, snapshotId);
    if (nullifierDigest) this.nullifierOwners.set(nullifierDigest, snapshotId);
    return snapshot;
  }

  public getSnapshot(snapshotId: string): SalaryCommitmentVersionSnapshot | undefined {
    return this.snapshots.get(snapshotId?.trim() ?? "");
  }

  public getActiveSnapshot(scopeId: string): SalaryCommitmentVersionSnapshot | undefined {
    const activeId = this.activeByScope.get(scopeId?.trim() ?? "");
    return activeId ? this.snapshots.get(activeId) : undefined;
  }

  public getActiveVersion(scopeId: string): SalaryCommitmentVersion | undefined {
    return this.getActiveSnapshot(scopeId)?.commitmentVersion;
  }

  public assertWitnessVersion(params: {
    scopeId: string;
    commitmentVersion: unknown;
    commitmentDigest?: string;
    nullifierDigest?: string;
    snapshotId?: string;
    expectedRevision?: number;
  }): SalaryCommitmentVersionSnapshot {
    const scopeId = requireIdentifier(params.scopeId, "scopeId");
    const snapshot = params.snapshotId
      ? this.getSnapshot(params.snapshotId)
      : this.getActiveSnapshot(scopeId);

    if (!snapshot || snapshot.scopeId !== scopeId) {
      throw new SalaryCommitmentVersionError(
        "No salary commitment snapshot is active for this scope. Register the snapshot before proof input validation.",
        SalaryCommitmentVersionErrorCode.SNAPSHOT_NOT_FOUND,
        { field: "scopeId" }
      );
    }
    if (snapshot.status !== "ACTIVE") {
      throw new SalaryCommitmentVersionError(
        "The salary commitment snapshot is no longer active. Reload the current snapshot before compiling the witness.",
        SalaryCommitmentVersionErrorCode.SNAPSHOT_NOT_ACTIVE,
        { snapshotId: snapshot.snapshotId }
      );
    }
    if (!verifySalaryCommitmentVersionSnapshotIntegrity(snapshot)) {
      throw this.integrityError(snapshot.snapshotId);
    }
    assertExpectedRevision(snapshot, params.expectedRevision);
    assertSalaryCommitmentVersionMatches(params.commitmentVersion, snapshot.commitmentVersion);

    if (params.commitmentDigest !== undefined) {
      const digest = normalizeDigest(params.commitmentDigest, "commitmentDigest");
      if (digest !== snapshot.commitmentDigest) {
        throw new SalaryCommitmentVersionError(
          "The commitment digest differs from the active snapshot. Reload the snapshot before compiling the witness.",
          SalaryCommitmentVersionErrorCode.DIGEST_MISMATCH,
          { field: "commitmentDigest" }
        );
      }
    }
    if (params.nullifierDigest !== undefined) {
      const digest = normalizeDigest(params.nullifierDigest, "nullifierDigest");
      if (snapshot.nullifierDigest !== digest) {
        throw new SalaryCommitmentVersionError(
          "The proof nullifier does not match the active commitment snapshot. Generate a fresh proof from the current snapshot.",
          SalaryCommitmentVersionErrorCode.NULLIFIER_REUSE,
          { field: "nullifierDigest" }
        );
      }
    }
    return snapshot;
  }

  public retireSnapshot(
    scopeId: string,
    expectedRevision?: number
  ): SalaryCommitmentVersionSnapshot {
    const snapshot = this.getActiveSnapshot(scopeId);
    if (!snapshot) {
      throw new SalaryCommitmentVersionError(
        "No salary commitment snapshot is active for this scope. Register the snapshot before retiring it.",
        SalaryCommitmentVersionErrorCode.SNAPSHOT_NOT_FOUND,
        { field: "scopeId" }
      );
    }
    if (!verifySalaryCommitmentVersionSnapshotIntegrity(snapshot)) {
      throw this.integrityError(snapshot.snapshotId);
    }
    assertExpectedRevision(snapshot, expectedRevision);
    const retiredState = {
      ...snapshot,
      status: "RETIRED" as const,
      revision: snapshot.revision + 1,
      previousHash: snapshot.stateHash,
    };
    const retired = freezeSnapshot({
      ...retiredState,
      stateHash: computeSalaryCommitmentVersionStateHash(retiredState),
    });
    this.snapshots.set(snapshot.snapshotId, retired);
    this.activeByScope.delete(snapshot.scopeId);
    return retired;
  }

  public verifyIntegrity(snapshotId: string): boolean {
    const snapshot = this.getSnapshot(snapshotId);
    return snapshot ? verifySalaryCommitmentVersionSnapshotIntegrity(snapshot) : false;
  }

  private integrityError(snapshotId: string): SalaryCommitmentVersionError {
    return new SalaryCommitmentVersionError(
      "Salary commitment snapshot integrity check failed. Reload the trusted snapshot instead of using the local copy.",
      SalaryCommitmentVersionErrorCode.STATE_INTEGRITY_COMPROMISED,
      { snapshotId }
    );
  }
}
