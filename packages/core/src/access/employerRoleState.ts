import { createHash } from "crypto";
import {
  EmployerRoleError,
  EmployerRoleErrorCode,
  SafeEmployerRoleIssue,
  formatSafeEmployerRoleError,
} from "./employerRoleErrors";
import {
  EmployerRole,
  EmployerRoleAction,
  EmployerRoleChangeInput,
  validateEmployerRoleChange,
} from "./employerRoleValidation";

export type EmployerRoleStateStatus = "ACTIVE" | "REVOKED" | "SUPERSEDED" | "EXPIRED";

export interface EmployerRoleChangeRecord {
  readonly changeId: string;
  readonly scopeId: string;
  readonly employer: string;
  readonly targetAccount: string;
  readonly role: EmployerRole;
  readonly action: EmployerRoleAction;
  readonly status: EmployerRoleStateStatus;
  readonly revision: number;
  readonly effectiveAt: number;
  readonly expiresAt?: number;
  readonly previousHash?: string;
  readonly stateHash: string;
}

export interface EmployerRoleChangeParams {
  readonly changeId: string;
  readonly employer: string;
  readonly targetAccount: string;
  readonly role: EmployerRole;
  readonly scopeId?: string;
  readonly effectiveAt?: number;
  readonly expiresAt?: number;
  readonly expectedRevision?: number;
  readonly now?: number;
}

export interface EmployerRoleTransferParams extends EmployerRoleChangeParams {
  readonly fromAccount: string;
}

export interface EmployerRoleTransferResult {
  readonly outgoing: EmployerRoleChangeRecord;
  readonly incoming: EmployerRoleChangeRecord;
}

export interface EmployerRoleExpiryParams {
  readonly changeId: string;
  readonly scopeId: string;
  readonly account: string;
  readonly role: EmployerRole;
  readonly expectedRevision?: number;
  readonly now?: number;
}

export function computeEmployerRoleStateHash(
  record: Omit<EmployerRoleChangeRecord, "stateHash">
): string {
  const payload = [
    "zkpayroll:employer-role-state:v1",
    record.changeId,
    record.scopeId,
    record.employer,
    record.targetAccount,
    record.role,
    record.action,
    record.status,
    String(record.revision),
    String(record.effectiveAt),
    record.expiresAt === undefined ? "" : String(record.expiresAt),
    record.previousHash ?? "GENESIS",
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function verifyEmployerRoleChangeIntegrity(record: EmployerRoleChangeRecord): boolean {
  if (!record || typeof record !== "object" || !record.stateHash) return false;
  return record.stateHash === computeEmployerRoleStateHash(record);
}

function roleError(code: EmployerRoleErrorCode, field: string): EmployerRoleError {
  const issue = formatSafeEmployerRoleError(code, field);
  return new EmployerRoleError(issue.message, code, [issue]);
}

function throwIssue(code: EmployerRoleErrorCode, field: string): never {
  throw roleError(code, field);
}

function requireIdentifier(value: unknown, field: string, code: EmployerRoleErrorCode): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throwIssue(code, field);
  }
  return value.trim();
}

function freezeRecord(
  record: Omit<EmployerRoleChangeRecord, "stateHash"> & { stateHash: string }
): EmployerRoleChangeRecord {
  return Object.freeze({ ...record });
}

export class EmployerRoleStateManager {
  private readonly changes = new Map<string, EmployerRoleChangeRecord>();
  private readonly scopeHeads = new Map<string, string>();
  private readonly scopeChanges = new Map<string, string[]>();

  public grantRole(params: EmployerRoleChangeParams): EmployerRoleChangeRecord {
    return this.applyChange(params, "GRANT", "ACTIVE");
  }

  public revokeRole(params: EmployerRoleChangeParams): EmployerRoleChangeRecord {
    return this.applyChange(params, "REVOKE", "REVOKED");
  }

  public transferRole(params: EmployerRoleTransferParams): EmployerRoleTransferResult {
    const changeId = requireIdentifier(params.changeId, "changeId", "INVALID_CHANGE_ID");
    const scopeId = this.resolveScopeId(params);
    const fromAccount = requireIdentifier(
      params.fromAccount,
      "targetAccount",
      "INVALID_TARGET_ADDRESS"
    );
    const targetAccount = requireIdentifier(
      params.targetAccount,
      "targetAccount",
      "INVALID_TARGET_ADDRESS"
    );
    this.assertScopeIntegrity(scopeId);
    const now = params.now ?? Date.now();
    const outgoingId = `${changeId}::out`;
    const incomingId = `${changeId}::in`;

    if (fromAccount === targetAccount) {
      throwIssue("SAME_ACCOUNT_TRANSFER", "targetAccount");
    }

    const existingOutgoing = this.changes.get(outgoingId);
    if (existingOutgoing) {
      this.assertRecordIntegrity(existingOutgoing);
      const existingIncoming = this.changes.get(incomingId);
      if (!existingIncoming) {
        throwIssue("STATE_INTEGRITY_COMPROMISED", "changeId");
      }
      this.assertRecordIntegrity(existingIncoming);
      if (!this.matchesRequest(existingIncoming, params, "TRANSFER", "ACTIVE", scopeId)) {
        throwIssue("DUPLICATE_CHANGE", "changeId");
      }
      return Object.freeze({ outgoing: existingOutgoing, incoming: existingIncoming });
    }

    const activeRoles = this.activeRoles(scopeId, targetAccount);
    this.assertValid(params, "TRANSFER", scopeId, activeRoles, now);

    if (activeRoles.includes(params.role)) {
      throwIssue("ROLE_ALREADY_ASSIGNED", "role");
    }

    const outgoing = this.latestChange(scopeId, fromAccount, params.role);
    if (!outgoing || outgoing.status !== "ACTIVE") {
      throwIssue("INVALID_CHANGE_STATE", "targetAccount");
    }
    this.assertRevision(outgoing, params.expectedRevision);
    this.assertRecordIntegrity(outgoing);

    const outgoingBase = {
      changeId: outgoingId,
      scopeId,
      employer: params.employer,
      targetAccount: fromAccount,
      role: params.role,
      action: "TRANSFER" as const,
      status: "REVOKED" as const,
      revision: outgoing.revision + 1,
      effectiveAt: params.effectiveAt ?? now,
      expiresAt: params.expiresAt,
      previousHash: this.scopeHeads.get(scopeId),
    };
    const outgoingRecord = freezeRecord({
      ...outgoingBase,
      stateHash: computeEmployerRoleStateHash(outgoingBase),
    });

    const incomingBase = {
      changeId: incomingId,
      scopeId,
      employer: params.employer,
      targetAccount,
      role: params.role,
      action: "TRANSFER" as const,
      status: "ACTIVE" as const,
      revision: 1,
      effectiveAt: params.effectiveAt ?? now,
      expiresAt: params.expiresAt,
      previousHash: outgoingRecord.stateHash,
    };
    const incomingRecord = freezeRecord({
      ...incomingBase,
      stateHash: computeEmployerRoleStateHash(incomingBase),
    });

    this.commit(scopeId, outgoingRecord);
    this.commit(scopeId, incomingRecord);
    return Object.freeze({ outgoing: outgoingRecord, incoming: incomingRecord });
  }

  public expireRole(params: EmployerRoleExpiryParams): EmployerRoleChangeRecord {
    const changeId = requireIdentifier(params.changeId, "changeId", "INVALID_CHANGE_ID");
    const scopeId = requireIdentifier(params.scopeId, "scopeId", "INVALID_SCOPE_ID");
    const account = requireIdentifier(params.account, "targetAccount", "INVALID_TARGET_ADDRESS");
    this.assertScopeIntegrity(scopeId);
    const current = this.latestChange(scopeId, account, params.role);
    if (!current || current.status !== "ACTIVE") {
      throwIssue("INVALID_CHANGE_STATE", "status");
    }
    this.assertRecordIntegrity(current);
    this.assertRevision(current, params.expectedRevision);

    const now = params.now ?? Date.now();
    const base = {
      changeId,
      scopeId,
      employer: current.employer,
      targetAccount: account,
      role: current.role,
      action: current.action,
      status: "EXPIRED" as const,
      revision: current.revision + 1,
      effectiveAt: now,
      expiresAt: current.expiresAt,
      previousHash: current.stateHash,
    };
    const expired = freezeRecord({
      ...base,
      stateHash: computeEmployerRoleStateHash(base),
    });
    this.commit(scopeId, expired);
    return expired;
  }

  public getChange(changeId: string): EmployerRoleChangeRecord | undefined {
    return this.changes.get(changeId?.trim() ?? "");
  }

  public latestChange(
    scopeId: string,
    account: string,
    role: EmployerRole
  ): EmployerRoleChangeRecord | undefined {
    const ids = this.scopeChanges.get(scopeId?.trim() ?? "") ?? [];
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const record = this.changes.get(ids[index]);
      if (record && record.targetAccount === account?.trim() && record.role === role) {
        return record;
      }
    }
    return undefined;
  }

  public activeRoles(scopeId: string, account: string): readonly EmployerRole[] {
    const latest = new Map<EmployerRole, EmployerRoleChangeRecord>();
    for (const record of this.recordsFor(scopeId)) {
      if (record.targetAccount === account?.trim()) {
        latest.set(record.role, record);
      }
    }
    return Object.freeze(
      [...latest.values()]
        .filter((record) => record.status === "ACTIVE")
        .map((record) => record.role)
        .sort()
    );
  }

  public activeAdministrators(scopeId: string): readonly string[] {
    const latest = new Map<string, EmployerRoleChangeRecord>();
    for (const record of this.recordsFor(scopeId)) {
      if (record.role === "EMPLOYER_ADMIN") {
        latest.set(record.targetAccount, record);
      }
    }
    return Object.freeze(
      [...latest.values()]
        .filter((record) => record.status === "ACTIVE")
        .map((record) => record.targetAccount)
        .sort()
    );
  }

  public verifyIntegrity(changeId: string): boolean {
    const record = this.getChange(changeId);
    return record ? verifyEmployerRoleChangeIntegrity(record) : false;
  }

  public verifyScopeIntegrity(scopeId: string): boolean {
    const ids = this.scopeChanges.get(scopeId?.trim() ?? "") ?? [];
    let previousHash: string | undefined;
    for (const id of ids) {
      const record = this.changes.get(id);
      if (!record || !verifyEmployerRoleChangeIntegrity(record)) return false;
      if (record.previousHash !== previousHash) return false;
      previousHash = record.stateHash;
    }
    return true;
  }

  private applyChange(
    params: EmployerRoleChangeParams,
    action: EmployerRoleAction,
    status: EmployerRoleStateStatus
  ): EmployerRoleChangeRecord {
    const changeId = requireIdentifier(params.changeId, "changeId", "INVALID_CHANGE_ID");
    const scopeId = this.resolveScopeId(params);
    this.assertScopeIntegrity(scopeId);
    const now = params.now ?? Date.now();
    const existing = this.changes.get(changeId);
    if (existing) {
      this.assertRecordIntegrity(existing);
      if (!this.matchesRequest(existing, params, action, status, scopeId)) {
        throwIssue("DUPLICATE_CHANGE", "changeId");
      }
      this.assertRevision(existing, params.expectedRevision);
      return existing;
    }

    const activeRoles = this.activeRoles(scopeId, params.targetAccount);
    this.assertValid(params, action, scopeId, activeRoles, now);

    if (
      action === "REVOKE" &&
      params.role === "EMPLOYER_ADMIN" &&
      this.activeAdministrators(scopeId).length === 1 &&
      activeRoles.includes("EMPLOYER_ADMIN")
    ) {
      throwIssue("LAST_ADMIN_REMOVAL", "role");
    }

    const current = this.latestChange(scopeId, params.targetAccount, params.role);
    this.assertRevision(current, params.expectedRevision);
    if (current) this.assertRecordIntegrity(current);

    const base = {
      changeId,
      scopeId,
      employer: params.employer,
      targetAccount: params.targetAccount,
      role: params.role,
      action,
      status,
      revision: (current?.revision ?? 0) + 1,
      effectiveAt: params.effectiveAt ?? now,
      expiresAt: params.expiresAt,
      previousHash: this.scopeHeads.get(scopeId),
    };
    const record = freezeRecord({
      ...base,
      stateHash: computeEmployerRoleStateHash(base),
    });
    this.commit(scopeId, record);
    return record;
  }

  private assertValid(
    params: EmployerRoleChangeParams,
    action: EmployerRoleAction,
    scopeId: string,
    activeRoles: readonly EmployerRole[],
    now: number
  ): void {
    const input: EmployerRoleChangeInput = {
      employer: params.employer,
      targetAccount: params.targetAccount,
      role: params.role,
      action,
      effectiveAt: params.effectiveAt ?? now,
      expiresAt: params.expiresAt,
      existingRoles: activeRoles,
    };
    const result = validateEmployerRoleChange(input, now);
    if (!result.isValid) {
      const first = result.issues[0] as SafeEmployerRoleIssue;
      throw new EmployerRoleError(first.message, first.code, result.issues);
    }
    if (scopeId.length === 0) {
      throwIssue("INVALID_SCOPE_ID", "scopeId");
    }
  }

  private assertRevision(
    record: EmployerRoleChangeRecord | undefined,
    expectedRevision?: number
  ): void {
    if (expectedRevision !== undefined && (record?.revision ?? 0) !== expectedRevision) {
      throwIssue("STALE_REVISION", "expectedRevision");
    }
  }

  private assertRecordIntegrity(record: EmployerRoleChangeRecord): void {
    if (!verifyEmployerRoleChangeIntegrity(record)) {
      throwIssue("STATE_INTEGRITY_COMPROMISED", "changeId");
    }
  }

  private assertScopeIntegrity(scopeId: string): void {
    if (!this.verifyScopeIntegrity(scopeId)) {
      throwIssue("STATE_INTEGRITY_COMPROMISED", "scopeId");
    }
  }

  private matchesRequest(
    record: EmployerRoleChangeRecord,
    params: EmployerRoleChangeParams,
    action: EmployerRoleAction,
    status: EmployerRoleStateStatus,
    scopeId: string
  ): boolean {
    return (
      record.scopeId === scopeId &&
      record.employer === params.employer &&
      record.targetAccount === params.targetAccount &&
      record.role === params.role &&
      record.action === action &&
      record.status === status &&
      (params.effectiveAt === undefined || record.effectiveAt === params.effectiveAt) &&
      (params.expiresAt === undefined || record.expiresAt === params.expiresAt)
    );
  }

  private resolveScopeId(params: EmployerRoleChangeParams): string {
    if (params.scopeId !== undefined) {
      return requireIdentifier(params.scopeId, "scopeId", "INVALID_SCOPE_ID");
    }
    return requireIdentifier(params.employer, "employer", "INVALID_EMPLOYER_ADDRESS");
  }

  private recordsFor(scopeId: string): readonly EmployerRoleChangeRecord[] {
    const records: EmployerRoleChangeRecord[] = [];
    for (const id of this.scopeChanges.get(scopeId?.trim() ?? "") ?? []) {
      const record = this.changes.get(id);
      if (record) records.push(record);
    }
    return records;
  }

  private commit(scopeId: string, record: EmployerRoleChangeRecord): void {
    this.changes.set(record.changeId, record);
    const ids = this.scopeChanges.get(scopeId) ?? [];
    ids.push(record.changeId);
    this.scopeChanges.set(scopeId, ids);
    this.scopeHeads.set(scopeId, record.stateHash);
  }
}
