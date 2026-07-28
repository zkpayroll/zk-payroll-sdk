/**
 * Webhook Verification Module
 *
 * Helpers for verifying signed webhook payloads for payroll completion,
 * transaction updates, and audit notifications.
 *
 * Usage:
 * ```ts
 * import { verifyWebhookSignature } from "@zk-payroll/core";
 *
 * const payload = verifyWebhookSignature(req.body, process.env.WEBHOOK_SECRET);
 * ```
 */

export {
    computeSignature,
    verifyWebhookSignature,
    parseWebhookEnvelope,
} from "./verify";

export {
    WebhookVerificationError,
} from "./types";

export type {
    WebhookEventType,
    WebhookPayloadBase,
    PayrollCompletedPayload,
    PayrollFailedPayload,
    TransactionConfirmedPayload,
    TransactionFailedPayload,
    TransactionPendingPayload,
    AuditViewKeyGrantedPayload,
    AuditViewKeyRevokedPayload,
    AuditViewKeyExpiredPayload,
    WebhookPayload,
    SignedWebhookEnvelope,
    WebhookVerificationOptions,
} from "./types";