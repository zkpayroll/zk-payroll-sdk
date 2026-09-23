/**
 * Asset Domain Normalization
 *
 * Utilities that normalize how Stellar assets — native XLM, issued (Stellar
 * classic `code:issuer`) assets, and Soroban token contract IDs — are
 * identified across the SDK, contracts, and dashboards.
 *
 * ## Why this module exists
 *
 * `AssetRegistry` stores metadata *once an asset has already been identified*
 * by a canonical id. This module solves the step before that: turning loose,
 * user- or config-supplied asset inputs (a raw code, a `"CODE:ISSUER"` string,
 * mixed-case input, `"native"`/`"XLM"`, or a Soroban contract id) into one
 * stable canonical identifier, so the contract, SDK, and dashboard never
 * disagree about which asset is being referenced.
 *
 * ## Canonical forms
 *
 * - Native XLM always normalizes to the reserved id `"native"`.
 * - Issued Stellar classic assets normalize to `"CODE:ISSUER"` where `CODE`
 *   is upper-cased and `ISSUER` is the verbatim (case-sensitive) StrKey
 *   account id — Stellar issuer addresses are not case-insensitive, so the
 *   issuer segment is validated but never case-folded.
 * - Soroban token contract ids (`C...`) normalize to themselves, unchanged.
 *
 * @module
 */

import { StrKey } from "@stellar/stellar-sdk";

// ── Error types ─────────────────────────────────────────────────────────────

/** Machine-readable error codes for asset identity normalization failures. */
export enum AssetIdentityErrorCode {
  /** Input is empty, whitespace-only, or not a string. */
  EMPTY_INPUT = "EMPTY_INPUT",
  /** The asset code segment is missing, empty, or exceeds Stellar's length limits. */
  INVALID_CODE = "INVALID_CODE",
  /** The asset code contains characters outside Stellar's allowed alphanumeric set. */
  INVALID_CODE_CHARACTERS = "INVALID_CODE_CHARACTERS",
  /** An issued asset was supplied without an issuer, or with an empty issuer segment. */
  MISSING_ISSUER = "MISSING_ISSUER",
  /** The issuer segment is not a valid Stellar Ed25519 public key (G...). */
  INVALID_ISSUER = "INVALID_ISSUER",
  /** The input contains more than one `:` separator, making the code/issuer split ambiguous. */
  AMBIGUOUS_SEPARATOR = "AMBIGUOUS_SEPARATOR",
}

/**
 * Structured error thrown when an asset identifier cannot be normalized.
 *
 * Carries a machine-readable `code` and optional `context` (the raw input and
 * any partially-parsed segments) so callers can build precise, actionable
 * validation messages without string-matching `error.message`.
 */
export class AssetIdentityError extends Error {
  constructor(
    message: string,
    public readonly code: AssetIdentityErrorCode,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AssetIdentityError";
  }
}

// ── Public types ────────────────────────────────────────────────────────────

/** Discriminated kind of a normalized asset identifier. */
export type CanonicalAssetKind = "native" | "issued" | "contract";

/**
 * Canonical, unambiguous representation of a Stellar/Soroban asset identity.
 *
 * `id` is always safe to use as a map key, a contract-call argument, or an
 * `AssetRegistry` lookup key. `displayLabel` is deliberately kept separate
 * from `id` — it is intended for UI rendering only and must never be parsed
 * back or used for equality checks.
 */
export interface CanonicalAsset {
  /** Discriminant describing which kind of asset this is. */
  kind: CanonicalAssetKind;
  /**
   * The canonical, stable identifier for this asset:
   * - `"native"` for XLM.
   * - `"CODE:ISSUER"` for issued Stellar classic assets.
   * - The verbatim contract id (`"C..."`) for Soroban tokens.
   */
  id: string;
  /** Upper-cased asset code (`"XLM"`, `"USDC"`, ...). Absent for bare contract ids. */
  code?: string;
  /** Verbatim (case-sensitive) issuer account id, for issued assets only. */
  issuer?: string;
  /**
   * Human-readable label suitable for display in a UI.
   * Distinct from `id` by design — never use this for lookups or equality.
   */
  displayLabel: string;
}

/** Options accepted by {@link normalizeAssetIdentity}. */
export interface NormalizeAssetIdentityOptions {
  /**
   * When `true` (default), an asset code supplied with lower/mixed case is
   * accepted and normalized to upper case. When `false`, any non-upper-case
   * code is rejected as ambiguous input rather than silently corrected.
   */
  coerceCodeCase?: boolean;
}

/**
 * Discriminated result of {@link tryNormalizeAssetIdentity}.
 */
export type TryNormalizeAssetIdentityResult =
  { ok: true; value: CanonicalAsset } | { ok: false; error: AssetIdentityError };

// ── Internal helpers ────────────────────────────────────────────────────────

const NATIVE_ALIASES = new Set(["native", "xlm"]);

/** Stellar classic asset codes: 1–12 alphanumeric characters. */
const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

function isValidIssuer(issuer: string): boolean {
  try {
    if (typeof StrKey?.isValidEd25519PublicKey === "function") {
      return StrKey.isValidEd25519PublicKey(issuer);
    }
  } catch {
    // fall through to the pattern fallback below
  }
  // Fallback pattern for a G-address (56 chars, base32) if StrKey is unavailable.
  return /^G[A-Z2-7]{55}$/.test(issuer);
}

function isContractId(id: string): boolean {
  try {
    if (typeof StrKey?.isValidContract === "function") {
      return StrKey.isValidContract(id);
    }
  } catch {
    // fall through to the pattern fallback below
  }
  return /^C[A-Z2-7]{55}$/.test(id);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Normalize a loose asset identifier into a stable {@link CanonicalAsset}.
 *
 * Accepts:
 * - `"native"` / `"XLM"` (any case) → native XLM.
 * - `"CODE:ISSUER"` → an issued Stellar classic asset. The code is upper-cased
 *   (unless `coerceCodeCase: false`); the issuer is validated but never
 *   case-folded, since Stellar account ids are case-sensitive.
 * - A bare Soroban contract id (`"C..."`) → returned unchanged.
 * - A bare code with no issuer (other than `"native"`/`"XLM"`) is rejected —
 *   issued assets require an explicit issuer to avoid silently colliding two
 *   different issuers of the same ticker (e.g. two different "USDC" issuers).
 *
 * @throws {AssetIdentityError} when the input cannot be normalized.
 *
 * @example
 * ```ts
 * normalizeAssetIdentity("native");
 * // { kind: "native", id: "native", code: "XLM", displayLabel: "XLM (native)" }
 *
 * normalizeAssetIdentity("usdc:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
 * // { kind: "issued", id: "USDC:GA5ZSEJYB37...", code: "USDC", issuer: "GA5ZSEJYB37...", displayLabel: "USDC" }
 *
 * normalizeAssetIdentity("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
 * // { kind: "contract", id: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", displayLabel: "CDLZFC3S…GCYSC" }
 * ```
 */
export function normalizeAssetIdentity(
  input: string,
  options: NormalizeAssetIdentityOptions = {}
): CanonicalAsset {
  const { coerceCodeCase = true } = options;

  if (typeof input !== "string" || input.trim() === "") {
    throw new AssetIdentityError(
      "Asset identifier must be a non-empty string.",
      AssetIdentityErrorCode.EMPTY_INPUT,
      { input }
    );
  }

  const trimmed = input.trim();

  // Native XLM (by reserved keyword or symbol).
  if (NATIVE_ALIASES.has(trimmed.toLowerCase())) {
    return {
      kind: "native",
      id: "native",
      code: "XLM",
      displayLabel: "XLM (native)",
    };
  }

  const segments = trimmed.split(":");

  if (segments.length > 2) {
    throw new AssetIdentityError(
      `Asset identifier "${trimmed}" has more than one ":" separator.`,
      AssetIdentityErrorCode.AMBIGUOUS_SEPARATOR,
      { input: trimmed }
    );
  }

  if (segments.length === 1) {
    // No issuer segment — either a bare Soroban contract id, or an invalid
    // bare code (issued assets must always carry an explicit issuer).
    if (isContractId(trimmed)) {
      return {
        kind: "contract",
        id: trimmed,
        displayLabel: `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`,
      };
    }

    throw new AssetIdentityError(
      `Issued asset "${trimmed}" is missing an issuer. Use the "CODE:ISSUER" form.`,
      AssetIdentityErrorCode.MISSING_ISSUER,
      { input: trimmed, code: trimmed }
    );
  }

  // segments.length === 2 → "CODE:ISSUER"
  const [rawCode, issuer] = segments;

  if (!rawCode || rawCode.trim() === "") {
    throw new AssetIdentityError(
      `Asset identifier "${trimmed}" has an empty code segment.`,
      AssetIdentityErrorCode.INVALID_CODE,
      { input: trimmed }
    );
  }

  if (!ASSET_CODE_PATTERN.test(rawCode)) {
    throw new AssetIdentityError(
      `Asset code "${rawCode}" must be 1-12 alphanumeric characters.`,
      AssetIdentityErrorCode.INVALID_CODE_CHARACTERS,
      { input: trimmed, code: rawCode }
    );
  }

  const hasLowerCase = /[a-z]/.test(rawCode);
  if (hasLowerCase && !coerceCodeCase) {
    throw new AssetIdentityError(
      `Asset code "${rawCode}" is not upper case and coerceCodeCase is disabled.`,
      AssetIdentityErrorCode.INVALID_CODE_CHARACTERS,
      { input: trimmed, code: rawCode }
    );
  }

  const code = rawCode.toUpperCase();

  if (!issuer || issuer.trim() === "") {
    throw new AssetIdentityError(
      `Issued asset "${code}" is missing an issuer after ":".`,
      AssetIdentityErrorCode.MISSING_ISSUER,
      { input: trimmed, code }
    );
  }

  if (!isValidIssuer(issuer)) {
    throw new AssetIdentityError(
      `Issuer "${issuer}" for asset "${code}" is not a valid Stellar account id.`,
      AssetIdentityErrorCode.INVALID_ISSUER,
      { input: trimmed, code, issuer }
    );
  }

  return {
    kind: "issued",
    id: `${code}:${issuer}`,
    code,
    issuer,
    displayLabel: code,
  };
}

/**
 * Non-throwing variant of {@link normalizeAssetIdentity}.
 *
 * Returns a discriminated union: `{ ok: true, value }` on success,
 * `{ ok: false, error }` on any `AssetIdentityError`. Useful for form
 * validation flows that want to collect errors rather than throw.
 *
 * @example
 * ```ts
 * const result = tryNormalizeAssetIdentity("usdc");
 * if (!result.ok) {
 *   // result.error.code === AssetIdentityErrorCode.MISSING_ISSUER
 * }
 * ```
 */
export function tryNormalizeAssetIdentity(
  input: string,
  options: NormalizeAssetIdentityOptions = {}
): TryNormalizeAssetIdentityResult {
  try {
    return { ok: true, value: normalizeAssetIdentity(input, options) };
  } catch (err) {
    if (err instanceof AssetIdentityError) {
      return { ok: false, error: err };
    }
    throw err;
  }
}

/**
 * Check whether two loose asset identifiers refer to the same canonical
 * asset, without throwing on invalid input (returns `false` instead).
 *
 * @example
 * ```ts
 * assetIdentitiesEqual("xlm", "native"); // true
 * assetIdentitiesEqual("usdc:GABC...", "USDC:GABC..."); // true (code case-insensitive, issuer verbatim)
 * assetIdentitiesEqual("usdc:GABC...", "usdc:GXYZ..."); // false (different issuer)
 * ```
 */
export function assetIdentitiesEqual(a: string, b: string): boolean {
  const resultA = tryNormalizeAssetIdentity(a);
  const resultB = tryNormalizeAssetIdentity(b);
  if (!resultA.ok || !resultB.ok) return false;
  return resultA.value.id === resultB.value.id;
}
