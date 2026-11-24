/**
 * SDK-layer guard for public proof inputs (#841).
 * The length is checked before the payload is parsed.
 */

export const PUBLIC_INPUT_MAX_BYTES = 4096;
export const PUBLIC_INPUT_MAX_ELEMENTS = 64;

export class PublicInputLengthError extends Error {
  readonly code: "PUBLIC_INPUT_EMPTY" | "PUBLIC_INPUT_TOO_LONG" | "PUBLIC_INPUT_MALFORMED";

  constructor(code: PublicInputLengthError["code"]) {
    super(
      code === "PUBLIC_INPUT_EMPTY"
        ? "Public proof input is empty."
        : code === "PUBLIC_INPUT_TOO_LONG"
          ? "Public proof input exceeds the allowed length."
          : "Public proof input could not be read.",
    );
    this.name = "PublicInputLengthError";
    this.code = code;
  }
}

export function assertPublicInputLength(raw: string | Uint8Array): void {
  const length = typeof raw === "string" ? new TextEncoder().encode(raw).length : raw.byteLength;
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
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > PUBLIC_INPUT_MAX_ELEMENTS ||
    parsed.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new PublicInputLengthError("PUBLIC_INPUT_MALFORMED");
  }
  return parsed as string[];
}
