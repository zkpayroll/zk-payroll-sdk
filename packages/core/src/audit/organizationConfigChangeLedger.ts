/**
 * Organization Configuration Change Ledger
 *
 * Append-only, hash-chained record of changes to an organization's SDK
 * configuration (Issue #701). Each entry captures who changed which setting,
 * when, and why, and links to the previous entry so tampering or gaps are
 * detectable via {@link verifyOrgConfigChangeLedger}.
 *
 * Sensitive settings (keys, secrets, tokens, ...) are never stored in clear:
 * their values are replaced with a redaction marker before hashing/storage.
 *
 * @module
 */

import { createHash } from "crypto";

/** Stable machine-readable codes for ledger validation failures. */
export type OrgConfigLedgerErrorCode =
  | "ORG_ID_REQUIRED"
  | "SETTING_KEY_REQUIRED"
  | "ACTOR_REQUIRED"
  | "REASON_REQUIRED"
  | "TIMESTAMP_INVALID"
  | "TIMESTAMP_REGRESSION"
  | "ORG_MISMATCH"
  | "NO_OP_CHANGE"
  | "VALUE_NOT_SERIALIZABLE"
  | "CHANGE_ID_DUPLICATE"
  | "LEDGER_CORRUPT";

/** Error thrown by {@link OrgConfigChangeLedger.record} on invalid input. */
export class OrgConfigChangeLedgerError extends Error {
  public readonly code: OrgConfigLedgerErrorCode;

  constructor(message: string, code: OrgConfigLedgerErrorCode) {
    super(message);
    this.name = "OrgConfigChangeLedgerError";
    this.code = code;
  }
}

/** JSON-compatible configuration value. */
export type OrgConfigValue =
  null | boolean | number | string | OrgConfigValue[] | { [key: string]: OrgConfigValue };

/** Input describing a single configuration change. */
export interface OrgConfigChangeInput {
  /** Optional caller-supplied id; generated from the sequence when omitted. */
  changeId?: string;
  /** Organization the setting belongs to. */
  organizationId: string;
  /** Dotted setting path, e.g. `"payroll.approvalThreshold"`. */
  settingKey: string;
  /** Value before the change (`undefined` for a newly created setting). */
  previousValue?: OrgConfigValue;
  /** Value after the change (`undefined` for a removed setting). */
  newValue?: OrgConfigValue;
  /** Identifier of the actor who made the change. */
  actor: string;
  /** Human-readable justification. */
  reason: string;
  /** Change time in epoch ms (defaults to the ledger clock). */
  timestampMs?: number;
}

/** Immutable ledger entry. */
export interface OrgConfigChangeEntry {
  sequence: number;
  changeId: string;
  organizationId: string;
  settingKey: string;
  previousValue?: OrgConfigValue;
  newValue?: OrgConfigValue;
  /** True when values were replaced with {@link ORG_CONFIG_REDACTED}. */
  redacted: boolean;
  actor: string;
  reason: string;
  timestampMs: number;
  /** Hash of the preceding entry (`GENESIS_HASH` for the first). */
  previousHash: string;
  /** Hash over this entry's content and `previousHash`. */
  hash: string;
}

export const ORG_CONFIG_REDACTED = "[REDACTED]";
export const ORG_CONFIG_LEDGER_GENESIS_HASH = "0".repeat(64);

const SENSITIVE_KEY = /(secret|password|passphrase|private|token|api[_-]?key|credential|seed)/i;

export interface OrgConfigLedgerVerification {
  valid: boolean;
  /** Sequence of the first bad entry, when invalid. */
  brokenAt?: number;
  /** Actionable description, when invalid. */
  reason?: string;
}

export interface OrgConfigLedgerQuery {
  settingKey?: string;
  actor?: string;
  fromMs?: number;
  toMs?: number;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSerializable(value: unknown, depth = 0): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (depth > 32) return false;
      if (Array.isArray(value)) return value.every((v) => isSerializable(v, depth + 1));
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(value as object).every((v) => isSerializable(v, depth + 1));
    }
    default:
      return false;
  }
}

/** Key-sorted JSON so equal values always hash and compare identically. */
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

function deepClone<T extends OrgConfigValue | undefined>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function computeHash(entry: Omit<OrgConfigChangeEntry, "hash">): string {
  return createHash("sha256")
    .update(
      canonical([
        entry.sequence,
        entry.changeId,
        entry.organizationId,
        entry.settingKey,
        entry.previousValue,
        entry.newValue,
        entry.redacted,
        entry.actor,
        entry.reason,
        entry.timestampMs,
        entry.previousHash,
      ])
    )
    .digest("hex");
}

/**
 * Append-only configuration change ledger scoped to one organization.
 */
export class OrgConfigChangeLedger {
  private readonly entries: OrgConfigChangeEntry[] = [];
  private readonly ids = new Set<string>();

  constructor(
    public readonly organizationId: string,
    private readonly now: () => number = Date.now
  ) {
    if (!isNonEmpty(organizationId)) {
      throw new OrgConfigChangeLedgerError(
        "organizationId is required to create a configuration change ledger.",
        "ORG_ID_REQUIRED"
      );
    }
  }

  get size(): number {
    return this.entries.length;
  }

  /** Validates and appends a change, returning the stored entry. */
  record(input: OrgConfigChangeInput): OrgConfigChangeEntry {
    const fail = (message: string, code: OrgConfigLedgerErrorCode): never => {
      throw new OrgConfigChangeLedgerError(message, code);
    };

    if (!input || typeof input !== "object") {
      return fail("Change input must be an object.", "SETTING_KEY_REQUIRED");
    }
    if (!isNonEmpty(input.organizationId)) {
      fail("organizationId is required on every configuration change.", "ORG_ID_REQUIRED");
    }
    if (input.organizationId !== this.organizationId) {
      fail(
        `Change targets organization "${input.organizationId}" but this ledger belongs to "${this.organizationId}".`,
        "ORG_MISMATCH"
      );
    }
    if (!isNonEmpty(input.settingKey)) {
      fail('settingKey is required (e.g. "payroll.approvalThreshold").', "SETTING_KEY_REQUIRED");
    }
    if (!isNonEmpty(input.actor)) {
      fail("actor is required so the change can be attributed.", "ACTOR_REQUIRED");
    }
    if (!isNonEmpty(input.reason)) {
      fail("reason is required to explain why the configuration changed.", "REASON_REQUIRED");
    }
    if (
      (input.previousValue !== undefined && !isSerializable(input.previousValue)) ||
      (input.newValue !== undefined && !isSerializable(input.newValue))
    ) {
      fail(
        "previousValue and newValue must be JSON-compatible (no functions, bigint, NaN/Infinity, or class instances).",
        "VALUE_NOT_SERIALIZABLE"
      );
    }
    if (canonical(input.previousValue) === canonical(input.newValue)) {
      fail(
        `Setting "${input.settingKey}" is unchanged; only record actual configuration changes.`,
        "NO_OP_CHANGE"
      );
    }

    const timestampMs = input.timestampMs ?? this.now();
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
      fail("timestampMs must be a non-negative integer (epoch ms).", "TIMESTAMP_INVALID");
    }
    const last = this.entries[this.entries.length - 1];
    if (last && timestampMs < last.timestampMs) {
      fail(
        `timestampMs ${timestampMs} precedes the latest ledger entry (${last.timestampMs}); the ledger is append-only and ordered.`,
        "TIMESTAMP_REGRESSION"
      );
    }

    const sequence = this.entries.length + 1;
    const changeId = input.changeId !== undefined ? input.changeId : `cfg-${sequence}`;
    if (!isNonEmpty(changeId)) {
      fail("changeId, when supplied, must be a non-empty string.", "CHANGE_ID_DUPLICATE");
    }
    if (this.ids.has(changeId)) {
      fail(`changeId "${changeId}" already exists in the ledger.`, "CHANGE_ID_DUPLICATE");
    }

    const redacted = SENSITIVE_KEY.test(input.settingKey);
    const mask = (v: OrgConfigValue | undefined): OrgConfigValue | undefined =>
      redacted && v !== undefined ? ORG_CONFIG_REDACTED : deepClone(v);

    const base: Omit<OrgConfigChangeEntry, "hash"> = {
      sequence,
      changeId,
      organizationId: this.organizationId,
      settingKey: input.settingKey.trim(),
      previousValue: mask(input.previousValue),
      newValue: mask(input.newValue),
      redacted,
      actor: input.actor.trim(),
      reason: input.reason.trim(),
      timestampMs,
      previousHash: last ? last.hash : ORG_CONFIG_LEDGER_GENESIS_HASH,
    };
    const entry = Object.freeze({ ...base, hash: computeHash(base) });
    this.entries.push(entry);
    this.ids.add(changeId);
    return entry;
  }

  /** Returns entries in append order, optionally filtered. */
  list(query: OrgConfigLedgerQuery = {}): readonly OrgConfigChangeEntry[] {
    return this.entries.filter(
      (e) =>
        (query.settingKey === undefined || e.settingKey === query.settingKey) &&
        (query.actor === undefined || e.actor === query.actor) &&
        (query.fromMs === undefined || e.timestampMs >= query.fromMs) &&
        (query.toMs === undefined || e.timestampMs <= query.toMs)
    );
  }

  /** Latest recorded entry for a setting, if any. */
  latestFor(settingKey: string): OrgConfigChangeEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].settingKey === settingKey) return this.entries[i];
    }
    return undefined;
  }

  /** Verifies the hash chain of this ledger. */
  verify(): OrgConfigLedgerVerification {
    return verifyOrgConfigChangeLedger(this.entries);
  }

  /** Copy of all entries, suitable for persistence or export. */
  export(): OrgConfigChangeEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }
}

/** Verifies sequence continuity, hash links, and entry integrity. */
export function verifyOrgConfigChangeLedger(
  entries: readonly OrgConfigChangeEntry[]
): OrgConfigLedgerVerification {
  let prevHash = ORG_CONFIG_LEDGER_GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const { hash, ...rest } = entries[i];
    const bad = (reason: string): OrgConfigLedgerVerification => ({
      valid: false,
      brokenAt: rest.sequence ?? i + 1,
      reason,
    });
    if (rest.sequence !== i + 1) {
      return bad(
        `Expected sequence ${i + 1} but found ${rest.sequence}; an entry is missing or reordered.`
      );
    }
    if (rest.previousHash !== prevHash) {
      return bad(`Entry ${rest.sequence} does not link to the preceding entry hash.`);
    }
    if (computeHash(rest) !== hash) {
      return bad(`Entry ${rest.sequence} content does not match its hash; it was modified.`);
    }
    prevHash = hash;
  }
  return { valid: true };
}
