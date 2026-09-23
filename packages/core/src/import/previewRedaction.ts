/**
 * Redacted preview builder for import duplicate review UIs.
 *
 * Sensitive fields (wallet addresses, email hashes, names, salaries) are
 * reduced to safe partial values so reviewers can compare records without
 * exposing full PII or on-chain identifiers.
 */

import { ImportEmployeeRecord, RedactedRecordPreview } from "./types";

/**
 * Builds a redacted preview for one imported record.
 *
 * Deterministic and side-effect free. The preview shape is fixed, so any
 * field not part of {@link RedactedRecordPreview} (e.g., raw salary) never
 * leaks into the output.
 */
export function buildRedactedPreview(
  record: ImportEmployeeRecord,
  index: number,
  placeholder = "[redacted]"
): RedactedRecordPreview {
  const employeeIdRaw = safeTrim(record.employeeId);
  const walletRaw = safeTrim(record.walletAddress);
  const emailHashRaw = safeTrim(record.emailHash);
  const externalIdRaw = safeTrim(record.externalId);
  const nameRaw = safeTrim(record.name);

  const fieldsRedacted: string[] = [];

  let employeeId = "";
  if (employeeIdRaw.length > 0) {
    employeeId =
      employeeIdRaw.length <= 6 ? maskHeadTail(employeeIdRaw, 2, 2) : keepTail(employeeIdRaw, 4);
    fieldsRedacted.push("employeeId");
  }

  let walletAddress = "";
  if (walletRaw.length > 0) {
    walletAddress =
      walletRaw.length >= 12 ? maskHeadTail(walletRaw, 6, 4) : maskHeadTail(walletRaw, 2, 2);
    fieldsRedacted.push("walletAddress");
  }

  let emailHash = "";
  if (emailHashRaw.length > 0) {
    emailHash = emailHashRaw.length > 8 ? `${emailHashRaw.slice(0, 8)}…` : placeholder;
    fieldsRedacted.push("emailHash");
  }

  let externalId = "";
  if (externalIdRaw.length > 0) {
    externalId =
      externalIdRaw.length <= 6 ? maskHeadTail(externalIdRaw, 2, 2) : keepTail(externalIdRaw, 4);
    fieldsRedacted.push("externalId");
  }

  let name = "";
  if (nameRaw.length > 0) {
    name = maskExceptFirst(nameRaw);
    fieldsRedacted.push("name");
  }

  if (hasValue(record.salary)) {
    fieldsRedacted.push("salary");
  }

  return {
    index,
    ...(record.rowNumber !== undefined ? { rowNumber: record.rowNumber } : {}),
    employeeId,
    walletAddress,
    emailHash,
    externalId,
    name,
    department: safeTrim(record.department),
    asset: safeTrim(record.asset),
    fieldsRedacted: [...fieldsRedacted].sort(),
  };
}

/** Keeps head/tail of a value and masks the middle; full mask when short. */
export function maskHeadTail(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, head)}${"*".repeat(
    Math.max(value.length - head - tail, 3)
  )}${value.slice(-tail)}`;
}

/** Masks every character except the first. */
export function maskExceptFirst(value: string): string {
  if (value.length <= 1) {
    return "*".repeat(value.length);
  }
  return `${value[0]}${"*".repeat(value.length - 1)}`;
}

/** Keeps only the trailing characters of an identifier. */
export function keepTail(value: string, tail = 4): string {
  return `***${value.slice(-tail).padStart(tail, "*")}`;
}

function safeTrim(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : value === undefined || value === null
      ? ""
      : String(value).trim();
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && `${value}`.length > 0;
}
