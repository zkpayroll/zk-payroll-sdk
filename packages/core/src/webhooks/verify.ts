/**
 * Webhook Signature Verification
 *
 * Provides helpers to verify HMAC-SHA256 signed webhook payloads
 * delivered to backend consumers.  Backends should call
 * `verifyWebhookSignature()` as the first step in their webhook
 * handler, before parsing or processing the event payload.
 *
 * Usage (Express.js example):
 * ```ts
 * import { verifyWebhookSignature } from "@zk-payroll/core";
 *
 * app.post("/webhooks/payroll", (req, res) => {
 *   try {
 *     const event = verifyWebhookSignature(req.body, process.env.WEBHOOK_SECRET);
 *     // event is now a verified, typed WebhookPayload
 *     switch (event.event) {
 *       case "payroll.completed":
 *         // process payroll completion
 *         break;
 *     }
 *     res.sendStatus(200);
 *   } catch (err) {
 *     res.status(400).send("Invalid signature");
 *   }
 * });
 * ```
 *
 * The verification steps are:
 * 1. Extract the signature from the envelope.
 * 2. Recompute the HMAC-SHA256 digest of the canonical JSON payload.
 * 3. Compare using timing-safe comparison.
 * 4. Optionally enforce a maximum payload age for replay protection.
 * 5. Return the typed payload on success or throw WebhookVerificationError.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { SignedWebhookEnvelope, WebhookPayload, WebhookVerificationOptions } from "./types";
import { WebhookVerificationError } from "./types";

/** Default maximum age for webhook payloads: 5 minutes. */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** Prefix used in the signature header value. */
const SIGNATURE_PREFIX = "sha256=";

/**
 * Canonically serialises a `WebhookPayload` object to a JSON string.
 *
 * Uses JSON.stringify with sorted keys to produce a deterministic
 * representation that both the signer and verifier agree on.
 */
function canonicalSerialize(payload: WebhookPayload): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/**
 * Computes an HMAC-SHA256 signature for the given payload using the
 * provided secret.
 *
 * @param payload - The webhook event payload to sign.
 * @param secret  - The shared HMAC secret (raw string or Buffer).
 * @returns       The signature string in `sha256=<hex>` format.
 *
 * @example
 * ```ts
 * const sig = computeSignature(payload, "my-secret");
 * // "sha256=a1b2c3d4e5..."
 * ```
 */
export function computeSignature(payload: WebhookPayload, secret: string | Buffer): string {
  const canonical = canonicalSerialize(payload);
  const hmac = createHmac("sha256", secret);
  hmac.update(canonical, "utf8");
  const digest = hmac.digest("hex");
  return `${SIGNATURE_PREFIX}${digest}`;
}

/**
 * Verifies a signed webhook envelope and returns the typed payload.
 *
 * Throws `WebhookVerificationError` if:
 * - The envelope is malformed (missing payload, signature, or version).
 * - The signature does not match the computed HMAC.
 * - The payload has exceeded the maximum allowed age.
 *
 * @param envelope       - The full signed webhook envelope received from the SDK.
 * @param secret         - The shared HMAC secret.
 * @param options        - Optional verification parameters (max age, tolerance).
 * @returns              The verified, typed `WebhookPayload`.
 * @throws WebhookVerificationError
 *
 * @example
 * ```ts
 * const payload = verifyWebhookSignature(req.body, process.env.WEBHOOK_SECRET);
 * console.log(payload.event); // "payroll.completed"
 * ```
 */
export function verifyWebhookSignature(
  envelope: SignedWebhookEnvelope,
  secret: string | Buffer,
  options?: WebhookVerificationOptions
): WebhookPayload {
  // ── Envelope structural validation ────────────────────────────────────────
  if (!envelope || typeof envelope !== "object") {
    throw new WebhookVerificationError(
      "Invalid webhook envelope: expected an object",
      "ENVELOPE_INVALID"
    );
  }

  if (!envelope.payload) {
    throw new WebhookVerificationError(
      "Invalid webhook envelope: missing payload",
      "PAYLOAD_MISSING"
    );
  }

  if (!envelope.signature) {
    throw new WebhookVerificationError(
      "Invalid webhook envelope: missing signature",
      "SIGNATURE_MISSING"
    );
  }

  if (!envelope.version) {
    throw new WebhookVerificationError(
      "Invalid webhook envelope: missing version",
      "VERSION_MISSING"
    );
  }

  if (envelope.version !== "1") {
    throw new WebhookVerificationError(
      `Unsupported webhook envelope version: "${envelope.version}"`,
      "UNSUPPORTED_VERSION",
      { version: envelope.version }
    );
  }

  const payload = envelope.payload as WebhookPayload;

  // ── Signature format validation ───────────────────────────────────────────
  if (!envelope.signature.startsWith(SIGNATURE_PREFIX)) {
    throw new WebhookVerificationError(
      "Invalid signature format: expected 'sha256=...' prefix",
      "SIGNATURE_FORMAT_INVALID"
    );
  }

  const receivedSig = envelope.signature.slice(SIGNATURE_PREFIX.length);

  if (!receivedSig || receivedSig.length === 0) {
    throw new WebhookVerificationError(
      "Invalid signature: empty digest after prefix",
      "SIGNATURE_EMPTY"
    );
  }

  // ── Recompute signature ───────────────────────────────────────────────────
  const computedSig = computeSignature(payload, secret);
  const computedDigest = computedSig.slice(SIGNATURE_PREFIX.length);

  // Timing-safe comparison to prevent timing attacks.
  const receivedBuf = Buffer.from(receivedSig, "hex");
  const computedBuf = Buffer.from(computedDigest, "hex");

  if (receivedBuf.length !== computedBuf.length || !timingSafeEqual(receivedBuf, computedBuf)) {
    throw new WebhookVerificationError(
      "Webhook signature mismatch: payload may have been tampered with",
      "SIGNATURE_MISMATCH",
      {
        eventId: (payload as unknown as Record<string, unknown>).eventId as string | undefined,
      }
    );
  }

  // ── Replay protection: enforce payload freshness ──────────────────────────
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const toleranceMs = options?.toleranceMs ?? 0;

  if (maxAgeMs > 0) {
    const timestamp = (payload as unknown as Record<string, unknown>).timestamp as
      string | undefined;
    if (!timestamp) {
      throw new WebhookVerificationError(
        "Webhook payload is missing timestamp; cannot enforce max age",
        "TIMESTAMP_MISSING"
      );
    }

    const eventTime = new Date(timestamp).getTime();
    if (isNaN(eventTime)) {
      throw new WebhookVerificationError(
        "Webhook payload has an invalid timestamp",
        "TIMESTAMP_INVALID",
        { timestamp }
      );
    }

    const now = Date.now();
    const age = now - eventTime + toleranceMs;

    if (age > maxAgeMs) {
      throw new WebhookVerificationError(
        "Webhook payload has expired (exceeded maximum allowed age)",
        "PAYLOAD_EXPIRED",
        {
          timestamp,
          age: Math.round(age / 1000),
          maxAge: Math.round(maxAgeMs / 1000),
        }
      );
    }

    // Reject payloads from the future beyond the allowed tolerance.
    if (eventTime > now + toleranceMs) {
      throw new WebhookVerificationError(
        "Webhook payload timestamp is in the future",
        "TIMESTAMP_FUTURE",
        { timestamp, toleranceMs }
      );
    }
  }

  return payload;
}

/**
 * Convenience helper: extracts the `SignedWebhookEnvelope` from a
 * raw JSON body (as received by an Express/Koa/Fastify handler).
 *
 * This is useful when the webhook body has already been parsed by
 * middleware (e.g. `express.json()`).
 *
 * @param body - The parsed JSON body from the HTTP request.
 * @returns    A `SignedWebhookEnvelope` if the structure is valid.
 * @throws WebhookVerificationError if the body cannot be parsed.
 *
 * @example
 * ```ts
 * const envelope = parseWebhookEnvelope(req.body);
 * const payload = verifyWebhookSignature(envelope, secret);
 * ```
 */
export function parseWebhookEnvelope(body: unknown): SignedWebhookEnvelope {
  if (!body || typeof body !== "object") {
    throw new WebhookVerificationError("Webhook body must be a JSON object", "BODY_INVALID");
  }

  const candidate = body as Record<string, unknown>;

  if (!candidate.payload || !candidate.signature || !candidate.version) {
    throw new WebhookVerificationError(
      "Webhook body is missing required fields (payload, signature, version)",
      "ENVELOPE_MALFORMED"
    );
  }

  return {
    payload: candidate.payload as SignedWebhookEnvelope["payload"],
    signature: String(candidate.signature),
    version: String(candidate.version),
  };
}
