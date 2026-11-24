/**
 * Token interface support policy (#777).
 *
 * Settlement helpers must reject tokens that do not implement the token
 * interface the SDK understands. Accepting an unsupported interface risks
 * calling methods that do not exist, misreading return values, or leaking
 * partial settlement state. The checks here are pure, structural, and never
 * echo recipient or amount data back on failure.
 */

/** Token interfaces the settlement helpers know how to talk to. */
export const SUPPORTED_TOKEN_INTERFACES = ["sep-41", "native"] as const;

export type SupportedTokenInterface = (typeof SUPPORTED_TOKEN_INTERFACES)[number];

/** Stable codes emitted by {@link checkTokenInterfaceSupport}. */
export const TokenInterfaceErrorCode = {
  INTERFACE_REQUIRED: "TOKEN_INTERFACE_REQUIRED",
  INTERFACE_MALFORMED: "TOKEN_INTERFACE_MALFORMED",
  INTERFACE_UNSUPPORTED: "TOKEN_INTERFACE_UNSUPPORTED",
} as const;

export type TokenInterfaceErrorCode =
  (typeof TokenInterfaceErrorCode)[keyof typeof TokenInterfaceErrorCode];

export type TokenInterfaceSupportResult =
  | { ok: true; interface: SupportedTokenInterface }
  | { ok: false; code: TokenInterfaceErrorCode; message: string };

/** Options for {@link checkTokenInterfaceSupport}. */
export interface TokenInterfaceSupportOptions {
  /**
   * Narrow the accepted set below {@link SUPPORTED_TOKEN_INTERFACES}. Useful
   * for settlement paths that cannot tolerate the native Stellar asset.
   */
  allowed?: readonly SupportedTokenInterface[];
}

function normalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Return a structured decision about a token interface identifier.
 *
 * Never throws, never echoes the raw input back verbatim. A rejected
 * identifier is reported by its sanitized lowercase form, truncated to 32
 * characters so that unexpected payloads cannot bloat log lines.
 */
export function checkTokenInterfaceSupport(
  value: unknown,
  options: TokenInterfaceSupportOptions = {}
): TokenInterfaceSupportResult {
  if (value === undefined || value === null) {
    return {
      ok: false,
      code: TokenInterfaceErrorCode.INTERFACE_REQUIRED,
      message:
        "Token interface is required. Pass one of: " + SUPPORTED_TOKEN_INTERFACES.join(", ") + ".",
    };
  }

  const normalized = normalize(value);
  if (normalized === null) {
    return {
      ok: false,
      code: TokenInterfaceErrorCode.INTERFACE_MALFORMED,
      message:
        "Token interface must be a non-empty string. Pass one of: " +
        SUPPORTED_TOKEN_INTERFACES.join(", ") +
        ".",
    };
  }

  const allowed = options.allowed ?? SUPPORTED_TOKEN_INTERFACES;
  const match = (SUPPORTED_TOKEN_INTERFACES as readonly string[]).includes(normalized)
    ? (normalized as SupportedTokenInterface)
    : null;

  if (match === null || !allowed.includes(match)) {
    const sanitized = normalized.length > 32 ? normalized.slice(0, 32) + "…" : normalized;
    return {
      ok: false,
      code: TokenInterfaceErrorCode.INTERFACE_UNSUPPORTED,
      message:
        `Token interface "${sanitized}" is not supported. Use one of: ` + allowed.join(", ") + ".",
    };
  }

  return { ok: true, interface: match };
}

/** Narrow a value to a {@link SupportedTokenInterface}. */
export function isSupportedTokenInterface(value: unknown): value is SupportedTokenInterface {
  return checkTokenInterfaceSupport(value).ok;
}
