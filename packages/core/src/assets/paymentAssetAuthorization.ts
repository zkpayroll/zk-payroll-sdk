/**
 * Payment asset authorization preflight check.
 *
 * Verifies that a payment asset is authorized for payroll use before a
 * payment or batch is submitted. An asset is authorized when it is:
 *
 * 1. payment-compatible (`"native"` or a Soroban token contract ID),
 * 2. registered in the {@link AssetRegistry}, and
 * 3. present on the employer's allowlist, when one is supplied.
 *
 * Results are structured so validation pipelines and preflight surfaces can
 * surface the reason without throwing. Use
 * {@link assertPaymentAssetAuthorized} when a thrown error is more convenient.
 *
 * ## Privacy & Security Guarantees
 * - Messages only reference asset identifiers, never salaries or recipients.
 *
 * @module
 */

import { ValidationError } from "../core/errors";
import { AssetRegistry, AssetRegistryClass } from "./AssetRegistry";
import {
  PAYMENT_ASSET_COMPATIBILITY_MESSAGE,
  isPaymentAssetCompatible,
} from "./paymentAssetCompatibility";

/** Stable error code used when an unauthorized asset blocks a payment. */
export const PAYMENT_ASSET_UNAUTHORIZED_ERROR_CODE = "PAYMENT_ASSET_UNAUTHORIZED";

/** Longest asset identifier echoed back in results or errors. */
const MAX_ECHOED_ASSET_ID_LENGTH = 64;

/**
 * Privacy-safe, bounded representation of an identifier that failed a check.
 *
 * Strings are trimmed and truncated; any other value is reduced to its type
 * name so arbitrary payloads never reach logs or error details.
 */
function describeAssetIdentifier(asset: unknown): string {
  if (typeof asset !== "string") {
    return asset === null ? "null" : `<${typeof asset}>`;
  }
  const trimmed = asset.trim();
  return trimmed.length > MAX_ECHOED_ASSET_ID_LENGTH
    ? `${trimmed.slice(0, MAX_ECHOED_ASSET_ID_LENGTH)}…`
    : trimmed;
}

/** Non-authorized outcome codes carried by {@link PaymentAssetUnauthorizedError}. */
export type PaymentAssetUnauthorizedCode = Exclude<PaymentAssetAuthorizationCode, "ok">;

/** Structured, privacy-safe details attached to a {@link PaymentAssetUnauthorizedError}. */
export interface PaymentAssetUnauthorizedDetails {
  /** Why the asset was rejected. */
  authorizationCode: PaymentAssetUnauthorizedCode;
  /** Sanitized asset identifier. Bounded in length; non-strings are reduced to their type. */
  assetId: string;
}

/**
 * Thrown by {@link assertPaymentAssetAuthorized} when a payout asset is not
 * authorized for payroll use.
 *
 * Extends {@link ValidationError}, so existing `instanceof` and `.code` checks
 * keep working. Integrators can branch on `details.authorizationCode` instead
 * of parsing the message.
 *
 * @example
 * ```ts
 * try {
 *   assertPaymentAssetAuthorized(asset, { allowedAssetIds });
 * } catch (err) {
 *   if (isPaymentAssetUnauthorizedError(err) && err.details.authorizationCode === "not_allowlisted") {
 *     showAllowlistHint(err.details.assetId);
 *   }
 * }
 * ```
 */
export class PaymentAssetUnauthorizedError extends ValidationError {
  /** Privacy-safe structured details. */
  public readonly details: Readonly<PaymentAssetUnauthorizedDetails>;

  constructor(message: string, details: PaymentAssetUnauthorizedDetails) {
    super(message, "asset", PAYMENT_ASSET_UNAUTHORIZED_ERROR_CODE, {
      authorizationCode: details.authorizationCode,
    });
    this.name = "PaymentAssetUnauthorizedError";
    this.details = Object.freeze({ ...details });
  }
}

/** Type guard for {@link PaymentAssetUnauthorizedError}. */
export function isPaymentAssetUnauthorizedError(
  err: unknown
): err is PaymentAssetUnauthorizedError {
  return err instanceof PaymentAssetUnauthorizedError;
}

/**
 * Machine-readable outcome of a payment asset authorization check.
 *
 * - `"ok"` — the asset is compatible, registered, and allowlisted (when an
 *   allowlist is supplied).
 * - `"not_payment_compatible"` — the identifier cannot name a payment asset.
 * - `"unregistered"` — the identifier is valid but has no registry metadata.
 * - `"not_allowlisted"` — the asset is registered but not on the allowlist.
 */
export type PaymentAssetAuthorizationCode =
  "ok" | "not_payment_compatible" | "unregistered" | "not_allowlisted";

/** Options accepted by {@link checkPaymentAssetAuthorization}. */
export interface PaymentAssetAuthorizationOptions {
  /**
   * Registry to resolve asset metadata from. Defaults to the shared
   * `AssetRegistry` singleton.
   */
  registry?: AssetRegistryClass;

  /**
   * Employer allowlist of permitted asset IDs. When omitted, any registered
   * payment-compatible asset is considered authorized.
   */
  allowedAssetIds?: readonly string[];
}

/** Result of {@link checkPaymentAssetAuthorization}. */
export interface PaymentAssetAuthorizationResult {
  /** The canonical asset ID that was checked, when one could be resolved. */
  assetId: string;

  /** Whether the asset may be used for a new payment. */
  authorized: boolean;

  /** Machine-readable outcome code. */
  code: PaymentAssetAuthorizationCode;

  /** Actionable message for failures. Absent when `authorized` is true. */
  message?: string;
}

/**
 * Check a payment asset identifier for authorization.
 *
 * Never throws for invalid input; returns a structured result so preflight
 * pipelines and UIs can surface the reason.
 *
 * @param asset - Payment asset identifier (`"native"` or a Soroban contract ID).
 * @param options - Registry and allowlist overrides.
 *
 * @example
 * ```ts
 * const result = checkPaymentAssetAuthorization(asset, { allowedAssetIds });
 * if (!result.authorized) {
 *   console.warn(result.message);
 * }
 * ```
 */
export function checkPaymentAssetAuthorization(
  asset: unknown,
  options: PaymentAssetAuthorizationOptions = {}
): PaymentAssetAuthorizationResult {
  const registry = options.registry ?? AssetRegistry;

  if (!isPaymentAssetCompatible(asset)) {
    return {
      assetId: describeAssetIdentifier(asset),
      authorized: false,
      code: "not_payment_compatible",
      message: PAYMENT_ASSET_COMPATIBILITY_MESSAGE,
    };
  }

  const assetId = asset as string;
  const metadata = registry.get(assetId);

  if (!metadata) {
    return {
      assetId,
      authorized: false,
      code: "unregistered",
      message:
        `Asset "${assetId}" is not registered. Register its metadata with ` +
        `AssetRegistry.register({ id, symbol, label, decimals }) before creating payments.`,
    };
  }

  const allowedAssetIds = options.allowedAssetIds;
  if (allowedAssetIds && !allowedAssetIds.includes(metadata.id)) {
    return {
      assetId,
      authorized: false,
      code: "not_allowlisted",
      message:
        `Asset "${assetId}" is not authorized for this payroll. ` +
        "Add it to the employer's allowed payment assets before creating payments.",
    };
  }

  return { assetId, authorized: true, code: "ok" };
}

/**
 * Throw a {@link PaymentAssetUnauthorizedError} when the payment asset is not
 * authorized. Returns the resolved result when the asset is authorized.
 *
 * @throws PaymentAssetUnauthorizedError (a `ValidationError`) with
 *   `PAYMENT_ASSET_UNAUTHORIZED_ERROR_CODE` and safe `details`.
 */
export function assertPaymentAssetAuthorized(
  asset: unknown,
  options: PaymentAssetAuthorizationOptions = {}
): PaymentAssetAuthorizationResult {
  const result = checkPaymentAssetAuthorization(asset, options);
  if (!result.authorized) {
    throw new PaymentAssetUnauthorizedError(
      result.message ?? "Payment asset is not authorized.",
      {
        authorizationCode: result.code as PaymentAssetUnauthorizedCode,
        assetId: result.assetId,
      }
    );
  }
  return result;
}
