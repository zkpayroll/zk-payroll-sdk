/**
 * Tests for the funding/hold/dispute webhook event categories added
 * alongside the existing payroll/transaction/audit events.
 *
 * These payloads round-trip through the same `computeSignature` /
 * `verifyWebhookSignature` pipeline as the pre-existing categories
 * (see webhook-verify.test.ts) — this file focuses on the new payload
 * shapes themselves: that each is a valid member of the discriminated
 * `WebhookPayload` union and survives sign/verify unchanged.
 */

import { computeSignature, verifyWebhookSignature } from "../src/webhooks/verify";
import type {
  DisputeOpenedPayload,
  DisputeResolvedPayload,
  FundingFinalizedPayload,
  FundingReservedPayload,
  HoldActivePayload,
  HoldExpiredPayload,
  HoldReleasedPayload,
  SignedWebhookEnvelope,
  WebhookPayload,
} from "../src/webhooks/types";

const TEST_SECRET = "whsec_test_secret_12345";
const EMPLOYER = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const ASSET = "CAS3OD4G3ZQ3VQVJ6M6V6V6J6M6V6V6J6M6V6V6J6";

function sign(payload: WebhookPayload): SignedWebhookEnvelope {
  return { payload, signature: computeSignature(payload, TEST_SECRET), version: "1" };
}

function base(event: WebhookPayload["event"]) {
  return { eventId: `evt_${event}`, timestamp: new Date().toISOString(), event };
}

describe("funding.* webhook events", () => {
  it("round-trips a funding.reserved payload", () => {
    const payload: FundingReservedPayload = {
      ...base("funding.reserved"),
      event: "funding.reserved",
      reservationId: "res_001",
      employer: EMPLOYER,
      reservedAmount: "500000000",
      asset: ASSET,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    const result = verifyWebhookSignature(sign(payload), TEST_SECRET);
    expect(result).toEqual(payload);
    expect(result.event).toBe("funding.reserved");
  });

  it("round-trips a funding.finalized payload", () => {
    const payload: FundingFinalizedPayload = {
      ...base("funding.finalized"),
      event: "funding.finalized",
      reservationId: "res_001",
      employer: EMPLOYER,
      usedAmount: "480000000",
      remainingAmount: "20000000",
      asset: ASSET,
      txHash: "a1b2c3",
    };

    const result = verifyWebhookSignature(sign(payload), TEST_SECRET);
    expect(result.event).toBe("funding.finalized");
    if (result.event === "funding.finalized") {
      expect(result.usedAmount).toBe("480000000");
    }
  });
});

describe("hold.* webhook events", () => {
  it("round-trips a hold.active payload", () => {
    const payload: HoldActivePayload = {
      ...base("hold.active"),
      event: "hold.active",
      reservationId: "res_002",
      employer: EMPLOYER,
      reservedAmount: "100000000",
      asset: ASSET,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    const result = verifyWebhookSignature(sign(payload), TEST_SECRET);
    expect(result.event).toBe("hold.active");
  });

  it("round-trips a hold.released payload with an optional reason", () => {
    const payload: HoldReleasedPayload = {
      ...base("hold.released"),
      event: "hold.released",
      reservationId: "res_002",
      employer: EMPLOYER,
      releasedAmount: "100000000",
      asset: ASSET,
      reason: "payroll cancelled",
    };

    const result = verifyWebhookSignature(sign(payload), TEST_SECRET);
    expect(result.event).toBe("hold.released");
    if (result.event === "hold.released") {
      expect(result.reason).toBe("payroll cancelled");
    }
  });

  it("round-trips a hold.expired payload", () => {
    const payload: HoldExpiredPayload = {
      ...base("hold.expired"),
      event: "hold.expired",
      reservationId: "res_003",
      employer: EMPLOYER,
      reservedAmount: "50000000",
      asset: ASSET,
    };

    const result = verifyWebhookSignature(sign(payload), TEST_SECRET);
    expect(result.event).toBe("hold.expired");
  });
});

describe("dispute.* webhook events", () => {
  it("round-trips a dispute.opened payload", () => {
    const payload: DisputeOpenedPayload = {
      ...base("dispute.opened"),
      event: "dispute.opened",
      disputeId: "dis_001",
      category: "amount_discrepancy",
      severity: "critical",
      relatedPayrollId: "cycle_42",
      employer: EMPLOYER,
      reasonCode: "ERR_AMOUNT_MISMATCH",
    };

    const result = verifyWebhookSignature(sign(payload), TEST_SECRET);
    expect(result.event).toBe("dispute.opened");
    if (result.event === "dispute.opened") {
      expect(result.severity).toBe("critical");
    }
  });

  it("round-trips a dispute.resolved payload", () => {
    const payload: DisputeResolvedPayload = {
      ...base("dispute.resolved"),
      event: "dispute.resolved",
      disputeId: "dis_001",
      category: "amount_discrepancy",
      relatedPayrollId: "cycle_42",
      employer: EMPLOYER,
    };

    const result = verifyWebhookSignature(sign(payload), TEST_SECRET);
    expect(result.event).toBe("dispute.resolved");
  });

  it("rejects a tampered dispute payload the same way as other categories", () => {
    const payload: DisputeOpenedPayload = {
      ...base("dispute.opened"),
      event: "dispute.opened",
      disputeId: "dis_002",
      category: "timing_violation",
      severity: "warning",
    };
    const envelope = sign(payload);
    const tampered: SignedWebhookEnvelope = {
      ...envelope,
      payload: { ...payload, severity: "critical" } as WebhookPayload,
    };

    expect(() => verifyWebhookSignature(tampered, TEST_SECRET)).toThrow(
      /signature mismatch/i
    );
  });
});
