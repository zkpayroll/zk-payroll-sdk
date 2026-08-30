/**
 * Audit View-Key Helpers
 *
 * Focused helper functions for compliance integrations that need to
 * create, inspect, and revoke audit view keys. Each helper is
 * intentionally stateless and pure so it can be composed freely
 * into stores, API routes, or server-side compliance scripts.
 *
 * Contract alignment
 * ------------------
 * These helpers produce and consume the same shape used by the
 * ZK Payroll smart contracts:
 *   - `scope` maps directly to the contract's `ViewKeyScope` enum.
 *   - `keyId` is the token passed to contract `grant_view_key`.
 *   - `grantedBy` must be the Stellar public key of the authorised admin.
 *
 * Usage
 * -----
 * ```ts
 * import {
 *   createViewKeyRequest,
 *   revokeViewKey,
 *   getViewKeyStatus,
 *   buildViewKeyStatusSummary,
 * } from "@/lib/audit/viewKeyHelpers";
 * ```
 */

import type {
  ViewKey,
  ViewKeyRequest,
  ViewKeyResponse,
  ViewKeyRevokeRequest,
  ViewKeyRevokeResult,
  ViewKeyStatusEntry,
  ViewKeyStatusSummary,
} from "@/types";

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/** Generates a random view-key token with the "vk_" prefix. */
function generateKeyToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "vk_";
  for (let i = 0; i < 12; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

/** Returns an ISO-8601 string one year from now. */
function defaultExpiryFromNow(): string {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
}

/** Derives the display status of a ViewKey at a given point in time. */
function resolveKeyStatus(
  key: ViewKey,
  now: Date
): "active" | "revoked" | "expired" {
  if (!key.isActive) return "revoked";
  if (new Date(key.expiresAt) <= now) return "expired";
  return "active";
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new view-key response object from a `ViewKeyRequest`.
 *
 * This is a pure construction helper — it does **not** persist the key.
 * Persist the returned `ViewKeyResponse` via your store or API layer.
 *
 * @param request   Fields provided by the admin granting access.
 * @param grantedBy Stellar public key of the authorised admin.
 * @returns         A fully populated `ViewKeyResponse` ready to store or return.
 *
 * @example
 * ```ts
 * const key = createViewKeyRequest(
 *   { auditorName: "Sarah Chen", auditorOrg: "Deloitte", scope: "full-audit" },
 *   session.publicKey
 * );
 * addViewKey(key); // persist via Zustand store or API
 * ```
 */
export function createViewKeyRequest(
  request: ViewKeyRequest,
  grantedBy: string
): ViewKeyResponse {
  const now = new Date();
  return {
    id: `vk_${now.getTime()}`,
    keyId: generateKeyToken(),
    auditorName: request.auditorName.trim(),
    auditorOrg: request.auditorOrg.trim(),
    scope: request.scope,
    grantedBy,
    createdAt: now.toISOString(),
    expiresAt: request.expiresAt ?? defaultExpiryFromNow(),
    isActive: true,
  };
}

/**
 * Validates a `ViewKeyRequest` and returns a list of validation errors.
 *
 * Returns an empty array when the request is valid.
 *
 * @example
 * ```ts
 * const errors = validateViewKeyRequest(request);
 * if (errors.length > 0) throw new Error(errors.join(", "));
 * ```
 */
export function validateViewKeyRequest(request: ViewKeyRequest): string[] {
  const errors: string[] = [];

  if (!request.auditorName.trim()) {
    errors.push("auditorName is required");
  }
  if (!request.auditorOrg.trim()) {
    errors.push("auditorOrg is required");
  }
  if (request.scope !== "read-only" && request.scope !== "full-audit") {
    errors.push('scope must be "read-only" or "full-audit"');
  }
  if (request.expiresAt !== undefined) {
    const expiry = new Date(request.expiresAt);
    if (isNaN(expiry.getTime())) {
      errors.push("expiresAt must be a valid ISO-8601 date-time string");
    } else if (expiry <= new Date()) {
      errors.push("expiresAt must be a future date");
    }
  }

  return errors;
}

/**
 * Marks a view key as revoked and returns the updated record.
 *
 * This is a pure transformation — pass the returned object back to
 * your persistence layer (store / API) to commit the change.
 *
 * @param key     The existing `ViewKey` to revoke.
 * @param request Contains the `id` to revoke (guards against mismatches).
 * @returns       A `ViewKeyRevokeResult` describing the outcome.
 * @throws        When the key is already inactive or the id does not match.
 *
 * @example
 * ```ts
 * const result = revokeViewKey(existingKey, { id: "vk_1719578400000" });
 * // update the key in your store using result.revokedAt
 * ```
 */
export function revokeViewKey(
  key: ViewKey,
  request: ViewKeyRevokeRequest
): ViewKeyRevokeResult {
  if (key.id !== request.id) {
    throw new Error(
      `View key id mismatch: expected "${request.id}", got "${key.id}"`
    );
  }
  if (!key.isActive) {
    throw new Error(`View key "${key.id}" is already inactive`);
  }

  const revokedAt = new Date().toISOString();
  return { id: key.id, revokedAt, success: true };
}

/**
 * Returns a single `ViewKeyStatusEntry` for a given `ViewKey`.
 *
 * Useful when you need the derived status (active / revoked / expired)
 * without computing a full summary.
 *
 * @param key  The view key to inspect.
 * @param now  Optional reference time — defaults to the current time.
 *             Pass a fixed value in tests for determinism.
 *
 * @example
 * ```ts
 * const entry = getViewKeyStatus(viewKey);
 * console.log(entry.status); // "active" | "revoked" | "expired"
 * ```
 */
export function getViewKeyStatus(
  key: ViewKey,
  now: Date = new Date()
): ViewKeyStatusEntry {
  return {
    id: key.id,
    keyId: key.keyId,
    auditorName: key.auditorName,
    auditorOrg: key.auditorOrg,
    scope: key.scope,
    status: resolveKeyStatus(key, now),
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt ?? undefined,
  };
}

/**
 * Builds a status summary across a collection of view keys.
 *
 * Intended for compliance dashboards that need aggregated counts
 * alongside per-key detail in one call.
 *
 * @param keys  Full list of `ViewKey` records to summarise.
 * @param now   Optional reference time — defaults to the current time.
 *
 * @example
 * ```ts
 * const summary = buildViewKeyStatusSummary(viewKeys);
 * console.log(`Active: ${summary.totalActive}`);
 * ```
 */
export function buildViewKeyStatusSummary(
  keys: ViewKey[],
  now: Date = new Date()
): ViewKeyStatusSummary {
  const entries = keys.map((k) => getViewKeyStatus(k, now));

  return {
    totalActive: entries.filter((e) => e.status === "active").length,
    totalRevoked: entries.filter((e) => e.status === "revoked").length,
    totalExpired: entries.filter((e) => e.status === "expired").length,
    keys: entries,
  };
}

/**
 * Checks whether a view key is currently valid for use.
 *
 * A key is valid when it is active **and** has not yet reached its
 * expiry time. Use this as a guard before passing a key to the
 * contract's `grant_view_key` call.
 *
 * @param key  The view key to check.
 * @param now  Optional reference time — defaults to the current time.
 *
 * @example
 * ```ts
 * if (!isViewKeyValid(key)) {
 *   throw new Error("Key has expired or been revoked");
 * }
 * ```
 */
export function isViewKeyValid(key: ViewKey, now: Date = new Date()): boolean {
  return resolveKeyStatus(key, now) === "active";
}

/**
 * Filters a list of keys to only those currently valid.
 *
 * Convenience wrapper around `isViewKeyValid` for bulk filtering.
 *
 * @example
 * ```ts
 * const usable = filterActiveViewKeys(viewKeys);
 * ```
 */
export function filterActiveViewKeys(
  keys: ViewKey[],
  now: Date = new Date()
): ViewKey[] {
  return keys.filter((k) => isViewKeyValid(k, now));
}
