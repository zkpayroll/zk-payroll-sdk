import { DraftExportResult, DraftImportResult, PayrollDraft, PayrollDraftEntry } from "./types";
import { SerializationError } from "../errors";

const CURRENT_DRAFT_VERSION = 1;

function simpleChecksum(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function validateEntry(entry: unknown, index: number): string[] {
  const warnings: string[] = [];
  if (!entry || typeof entry !== "object") {
    warnings.push(`Entry at index ${index} is not an object.`);
    return warnings;
  }

  const e = entry as Record<string, unknown>;

  if (!e.recipientId || typeof e.recipientId !== "string" || e.recipientId.trim() === "") {
    warnings.push(`Entry ${index}: missing or empty recipientId.`);
  }

  const amount = BigInt(String(e.amount ?? "0"));
  if (amount <= 0n) {
    warnings.push(`Entry ${index}: amount must be a positive value.`);
  }

  if (!e.asset || typeof e.asset !== "string" || e.asset.trim() === "") {
    warnings.push(`Entry ${index}: missing or empty asset.`);
  }

  return warnings;
}

/**
 * Serializes a PayrollDraft to a portable JSON string with an integrity checksum.
 *
 * @example
 * const { data, checksum } = exportDraft(myDraft);
 * localStorage.setItem("draft", data);
 */
export function exportDraft(draft: PayrollDraft): DraftExportResult {
  const payload: PayrollDraft = {
    ...draft,
    version: CURRENT_DRAFT_VERSION,
    updatedAt: new Date().toISOString(),
  };
  const data = JSON.stringify(payload, null, 2);
  return { data, checksum: simpleChecksum(data) };
}

/**
 * Deserializes and validates a previously exported draft string.
 *
 * Throws if the data is not parseable or missing required top-level fields.
 * Entry-level issues are returned as warnings rather than errors so the
 * caller can decide whether to discard or surface them.
 *
 * @example
 * const { draft, warnings } = importDraft(raw);
 * if (warnings.length) console.warn(warnings);
 */
export function importDraft(raw: string, expectedChecksum?: string): DraftImportResult {
  if (!raw || raw.trim() === "") {
    throw new SerializationError("Draft data is empty.", "EMPTY_DRAFT_DATA");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SerializationError("Draft data is not valid JSON.", "INVALID_JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new SerializationError("Draft data must be a JSON object.", "INVALID_JSON_OBJECT");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.version !== "number") {
    throw new SerializationError("Draft is missing a numeric version field.", "MISSING_VERSION");
  }

  if (!Array.isArray(obj.entries)) {
    throw new SerializationError("Draft is missing an entries array.", "MISSING_ENTRIES");
  }

  if (expectedChecksum !== undefined && simpleChecksum(raw) !== expectedChecksum) {
    throw new SerializationError(
      "Draft checksum mismatch — data may have been tampered with.",
      "CHECKSUM_MISMATCH"
    );
  }

  const warnings: string[] = [];

  if (obj.version > CURRENT_DRAFT_VERSION) {
    warnings.push(
      `Draft version ${obj.version} is newer than the SDK supports (v${CURRENT_DRAFT_VERSION}). Some fields may be ignored.`
    );
  }

  const entries = obj.entries as unknown[];
  for (let i = 0; i < entries.length; i++) {
    warnings.push(...validateEntry(entries[i], i));
  }

  const draft: PayrollDraft = {
    version: obj.version as number,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
    label: typeof obj.label === "string" ? obj.label : undefined,
    entries: entries as PayrollDraftEntry[],
  };

  return { draft, warnings };
}

/**
 * Creates a new empty draft with sensible defaults.
 */
export function createDraft(label?: string): PayrollDraft {
  const now = new Date().toISOString();
  return {
    version: CURRENT_DRAFT_VERSION,
    createdAt: now,
    updatedAt: now,
    label,
    entries: [],
  };
}
