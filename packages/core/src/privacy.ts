import { ValidationError } from "./core/errors";
import { sha256Digest } from "./crypto/hashUtils";

/** A note hash reference safe to attach to a contract payload. */
export interface NoteHashReference {
  noteHash: string;
  source: "generated" | "provided";
}

const NOTE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** True when `value` is a 64-char lowercase hex SHA-256 digest. */
export function isValidNoteHash(value: unknown): value is string {
  return typeof value === "string" && NOTE_HASH_PATTERN.test(value);
}

/**
 * Build a note hash reference from note text or an existing hash.
 * Pass exactly one of `note` / `noteHash`. Raw note text is never returned.
 */
export async function buildNoteHash(input: {
  note?: string;
  noteHash?: string;
}): Promise<NoteHashReference> {
  if (input.noteHash !== undefined) {
    if (!isValidNoteHash(input.noteHash)) {
      throw new ValidationError("Invalid note hash", "noteHash", "INVALID_NOTE_HASH");
    }
    return { noteHash: input.noteHash, source: "provided" };
  }

  if (!input.note || input.note.trim() === "") {
    throw new ValidationError(
      "Provide `note` text or an existing `noteHash`",
      "note",
      "INVALID_NOTE_HASH_INPUT"
    );
  }

  const digest = await sha256Digest(new TextEncoder().encode(input.note));
  return { noteHash: digest, source: "generated" };
}

/** Attach a note hash to a payload, stripping any raw `note` text. */
export function attachNoteHash<T extends Record<string, unknown>>(
  payload: T,
  reference: NoteHashReference
): Omit<T, "note"> & { noteHash: string } {
  if (!isValidNoteHash(reference.noteHash)) {
    throw new ValidationError("Invalid note hash", "noteHash", "INVALID_NOTE_HASH");
  }
  const { note: _note, ...rest } = payload as T & { note?: unknown };
  return { ...(rest as Omit<T, "note">), noteHash: reference.noteHash };
}
