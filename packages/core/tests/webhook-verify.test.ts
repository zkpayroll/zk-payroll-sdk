/**
 * Tests for webhook signature verification.
 *
 * Covers:
 *  - computeSignature — produces a deterministic HMAC-SHA256 signature
 *  - verifyWebhookSignature — happy path, envelope validation, replay protection
 *  - parseWebhookEnvelope — valid and malformed bodies
 *  - WebhookVerificationError — thrown on all failure paths
 *  - Timing-safe comparison — implicit via crypto.timingSafeEqual
 */

import {
  computeSignature,
  verifyWebhookSignature,
  parseWebhookEnvelope,
} from "../src/webhooks/verify";
import { WebhookVerificationError } from "../src/webhooks/types";
import type {
  PayrollCompletedPayload,
  SignedWebhookEnvelope,
  WebhookPayload,
} from "../src/webhooks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "whsec_test_secret_12345";

function makeCompletedPayload(
  overrides: Partial<PayrollCompletedPayload> = {},
): PayrollCompletedPayload {
  return {
    eventId: "evt_001",
    timestamp: new Date().toISOString(),
    event: "payroll.completed",
    contractId: "CCXQGHVQVJ6M6V6V6J6M6V6V6J6M6V6V6J6M6V6V6J6",
    ledger: 12345,
    employer: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    employeeCount: 5,
    totalDisbursed: "10000",
    asset: "CAS3OD4G3ZQ3VQVJ6M6V6V6J6M6V6V6J6M6V6V6J6",
    cycleId: "cycle_42",
    txHash: "a1b2c3d4e5f6...",
    ...overrides,
  };
}

function makeSignedEnvelope(
  payload: WebhookPayload,
  secret: string = TEST_SECRET,
  version: string = "1",
): SignedWebhookEnvelope {
  const signature = computeSignature(payload, secret);
  return { payload, signature, version };
}

// ---------------------------------------------------------------------------
// computeSignature
// ---------------------------------------------------------------------------

describe("computeSignature()", () => {
  it("produces a deterministic signature for the same payload", () => {
    const payload = makeCompletedPayload();
    const sig1 = computeSignature(payload, TEST_SECRET);
    const sig2 = computeSignature(payload, TEST_SECRET);
    expect(sig1).toBe(sig2);
  });

  it("produces different signatures with different secrets", () => {
    const payload = makeCompletedPayload();
    const sig1 = computeSignature(payload, "secret_a");
    const sig2 = computeSignature(payload, "secret_b");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = computeSignature(
      makeCompletedPayload({ eventId: "evt_001" }),
      TEST_SECRET,
    );
    const sig2 = computeSignature(
      makeCompletedPayload({ eventId: "evt_002" }),
      TEST_SECRET,
    );
    expect(sig1).not.toBe(sig2);
  });

  it("returns a signature with the sha256= prefix", () => {
    const payload = makeCompletedPayload();
    const sig = computeSignature(payload, TEST_SECRET);
    expect(sig).toMatch(/^sha256=/);
  });

  it("accepts a Buffer as the secret", () => {
    const payload = makeCompletedPayload();
    const sig = computeSignature(payload, Buffer.from(TEST_SECRET));
    expect(sig).toMatch(/^sha256=/);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature — happy path
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature() — happy path", () => {
  it("returns the typed payload for a valid signature", () => {
    const payload = makeCompletedPayload();
    const envelope = makeSignedEnvelope(payload);
    const result = verifyWebhookSignature(envelope, TEST_SECRET);
    expect(result).toEqual(payload);
    expect(result.event).toBe("payroll.completed");
  });

  it("accepts a Buffer as the secret", () => {
    const payload = makeCompletedPayload();
    const envelope = makeSignedEnvelope(payload);
    const result = verifyWebhookSignature(envelope, Buffer.from(TEST_SECRET));
    expect(result).toEqual(payload);
  });

  it("works with transaction.confirmed payloads", () => {
    const payload: WebhookPayload = {
      eventId: "evt_002",
      timestamp: new Date().toISOString(),
      event: "transaction.confirmed",
      txHash: "0xabc123",
      status: "SUCCESS",
      ledger: 12345,
    };
    const envelope = makeSignedEnvelope(payload);
    const result = verifyWebhookSignature(envelope, TEST_SECRET);
    expect(result.event).toBe("transaction.confirmed");
  });

  it("works with audit.view_key_revoked payloads", () => {
    const payload: WebhookPayload = {
      eventId: "evt_003",
      timestamp: new Date().toISOString(),
      event: "audit.view_key_revoked",
      keyId: "vk_abc123",
      revokedBy: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      revokedAt: new Date().toISOString(),
    };
    const envelope = makeSignedEnvelope(payload);
    const result = verifyWebhookSignature(envelope, TEST_SECRET);
    expect(result.event).toBe("audit.view_key_revoked");
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature — envelope validation errors
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature() — envelope validation", () => {
  it("throws ENVELOPE_INVALID for null body", () => {
    expect(() => verifyWebhookSignature(null as never, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws ENVELOPE_INVALID for non-object body", () => {
    expect(() =>
      verifyWebhookSignature("string" as never, TEST_SECRET),
    ).toThrow(WebhookVerificationError);
  });

  it("throws PAYLOAD_MISSING when payload is missing", () => {
    expect(() =>
      verifyWebhookSignature(
        { signature: "sha256=abc", version: "1" } as never,
        TEST_SECRET,
      ),
    ).toThrow(WebhookVerificationError);
  });

  it("throws SIGNATURE_MISSING when signature is missing", () => {
    expect(() =>
      verifyWebhookSignature(
        { payload: makeCompletedPayload(), version: "1" } as never,
        TEST_SECRET,
      ),
    ).toThrow(WebhookVerificationError);
  });

  it("throws VERSION_MISSING when version is missing", () => {
    expect(() =>
      verifyWebhookSignature(
        { payload: makeCompletedPayload(), signature: "sha256=abc" } as never,
        TEST_SECRET,
      ),
    ).toThrow(WebhookVerificationError);
  });

  it("throws UNSUPPORTED_VERSION for unknown versions", () => {
    const payload = makeCompletedPayload();
    const envelope = makeSignedEnvelope(payload, TEST_SECRET, "2");
    expect(() => verifyWebhookSignature(envelope, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature — signature errors
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature() — signature errors", () => {
  it("throws SIGNATURE_FORMAT_INVALID for missing sha256= prefix", () => {
    const payload = makeCompletedPayload();
    const envelope = makeSignedEnvelope(payload);
    envelope.signature = "abc123";
    expect(() => verifyWebhookSignature(envelope, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws SIGNATURE_EMPTY for empty digest", () => {
    const payload = makeCompletedPayload();
    const envelope = makeSignedEnvelope(payload);
    envelope.signature = "sha256=";
    expect(() => verifyWebhookSignature(envelope, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws SIGNATURE_MISMATCH when payload has been tampered with", () => {
    const payload = makeCompletedPayload();
    const envelope = makeSignedEnvelope(payload);
    // Tamper with the payload after signing
    envelope.payload = makeCompletedPayload({ eventId: "evt_tampered" });
    expect(() => verifyWebhookSignature(envelope, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws SIGNATURE_MISMATCH with wrong secret", () => {
    const payload = makeCompletedPayload();
    const envelope = makeSignedEnvelope(payload, "correct_secret");
    expect(() => verifyWebhookSignature(envelope, "wrong_secret")).toThrow(
      WebhookVerificationError,
    );
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature — replay protection
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature() — replay protection", () => {
  it("throws PAYLOAD_EXPIRED for old payloads", () => {
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    const payload = makeCompletedPayload({ timestamp: oldTimestamp });
    const envelope = makeSignedEnvelope(payload);
    // Default max age is 5 minutes
    expect(() => verifyWebhookSignature(envelope, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it("accepts payloads within the max age window", () => {
    const recentTimestamp = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
    const payload = makeCompletedPayload({ timestamp: recentTimestamp });
    const envelope = makeSignedEnvelope(payload);
    const result = verifyWebhookSignature(envelope, TEST_SECRET);
    expect(result.event).toBe("payroll.completed");
  });

  it("uses a custom maxAgeMs when provided", () => {
    const oldTimestamp = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // 3 minutes ago
    const payload = makeCompletedPayload({ timestamp: oldTimestamp });
    const envelope = makeSignedEnvelope(payload);
    // Custom max age of 10 seconds — should fail
    expect(() =>
      verifyWebhookSignature(envelope, TEST_SECRET, { maxAgeMs: 10_000 }),
    ).toThrow(WebhookVerificationError);
  });

  it("throws TIMESTAMP_MISSING when payload has no timestamp", () => {
    const payload = { ...makeCompletedPayload() } as never;
    (payload as Record<string, unknown>).timestamp = undefined;
    const envelope = makeSignedEnvelope(payload);
    expect(() => verifyWebhookSignature(envelope, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws TIMESTAMP_INVALID for non-parseable timestamps", () => {
    const payload = makeCompletedPayload({ timestamp: "not-a-date" });
    const envelope = makeSignedEnvelope(payload);
    expect(() => verifyWebhookSignature(envelope, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws TIMESTAMP_FUTURE for future timestamps beyond tolerance", () => {
    const futureTimestamp = new Date(Date.now() + 60 * 1000).toISOString(); // 1 minute in the future
    const payload = makeCompletedPayload({ timestamp: futureTimestamp });
    const envelope = makeSignedEnvelope(payload);
    // Default tolerance is 0
    expect(() => verifyWebhookSignature(envelope, TEST_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it("accepts future timestamps within tolerance", () => {
    const slightlyFuture = new Date(Date.now() + 30 * 1000).toISOString(); // 30 seconds in the future
    const payload = makeCompletedPayload({ timestamp: slightlyFuture });
    const envelope = makeSignedEnvelope(payload);
    const result = verifyWebhookSignature(envelope, TEST_SECRET, {
      toleranceMs: 60_000, // 1 minute tolerance
    });
    expect(result.event).toBe("payroll.completed");
  });

  it("disables replay protection when maxAgeMs is 0", () => {
    const oldTimestamp = new Date(
      Date.now() - 365 * 24 * 60 * 60 * 1000,
    ).toISOString(); // 1 year ago
    const payload = makeCompletedPayload({ timestamp: oldTimestamp });
    const envelope = makeSignedEnvelope(payload);
    const result = verifyWebhookSignature(envelope, TEST_SECRET, {
      maxAgeMs: 0,
    });
    expect(result.event).toBe("payroll.completed");
  });
});

// ---------------------------------------------------------------------------
// parseWebhookEnvelope
// ---------------------------------------------------------------------------

describe("parseWebhookEnvelope()", () => {
  it("returns a SignedWebhookEnvelope from a valid JSON body", () => {
    const payload = makeCompletedPayload();
    const envelope = makeSignedEnvelope(payload);
    const body = { payload, signature: envelope.signature, version: "1" };
    const parsed = parseWebhookEnvelope(body);
    expect(parsed.payload).toEqual(payload);
    expect(parsed.signature).toBe(envelope.signature);
    expect(parsed.version).toBe("1");
  });

  it("throws BODY_INVALID for null body", () => {
    expect(() => parseWebhookEnvelope(null)).toThrow(WebhookVerificationError);
  });

  it("throws BODY_INVALID for non-object body", () => {
    expect(() => parseWebhookEnvelope("string")).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws ENVELOPE_MALFORMED for missing fields", () => {
    expect(() => parseWebhookEnvelope({ payload: {} })).toThrow(
      WebhookVerificationError,
    );
    expect(() => parseWebhookEnvelope({ signature: "x" })).toThrow(
      WebhookVerificationError,
    );
    expect(() => parseWebhookEnvelope({ version: "1" })).toThrow(
      WebhookVerificationError,
    );
  });
});
