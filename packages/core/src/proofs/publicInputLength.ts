/**
 * Length checks for public proof inputs. Validation happens before JSON
 * parsing so an oversized payload is rejected without being interpreted.
 * Error text never includes the input bytes.
 */

export const PUBLIC_INPUT_MAX_BYTES = 4096;
export const PUBLIC_INPUT_MAX_ELEMENTS = 64;
export const PUBLIC_INPUT_MAX_ELEMENT_LENGTH = 78;

export type PublicInputLengthCode =
  | "PUBLIC_INPUT_EMPTY"
  | "PUBLIC_INPUT_TOO_LONG"
  | "PUBLIC_INPUT_MALFORMED";

const MESSAGES: Record<PublicInputLengthCode, string> = {
  PUBLIC_INPUT_EMPTY: "Public proof input is empty.",
  PUBLIC_INPUT_TOO_LONG: "Public proof input exceeds the allowed length.",
  PUBLIC_INPUT_MALFORMED: "Public proof input could not be read.",
};

export class PublicInputLengthError extends Error {
  readonly code: PublicInputLengthCode;

  constructor(code: PublicInputLengthCode) {
    super(MESSAGES[code]);
    this.name = "PublicInputLengthError";
    this.code = code;
  }
}

export function assertPublicInputLength(raw: string | Uint8Array): void {
  const length = typeof raw === "string" ? byteLength(raw) : raw.byteLength;
  if (length === 0) throw new PublicInputLengthError("PUBLIC_INPUT_EMPTY");
  if (length > PUBLIC_INPUT_MAX_BYTES) throw new PublicInputLengthError("PUBLIC_INPUT_TOO_LONG");
}

export function parsePublicInputs(raw: string): string[] {
  assertPublicInputLength(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PublicInputLengthError("PUBLIC_INPUT_MALFORMED");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > PUBLIC_INPUT_MAX_ELEMENTS) {
    throw new PublicInputLengthError("PUBLIC_INPUT_MALFORMED");
  }
  if (
    !parsed.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= PUBLIC_INPUT_MAX_ELEMENT_LENGTH &&
        !item.includes(" "),
    )
  ) {
    throw new PublicInputLengthError("PUBLIC_INPUT_MALFORMED");
  }
  return parsed;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
