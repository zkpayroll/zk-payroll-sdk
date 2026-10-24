/**
 * Interrupted Payroll Run Recovery Controls (#742).
 *
 * Self-contained, in-memory state tracking for payroll runs so a process crash
 * or lost connection mid-run can be resumed without double-paying. The tracker
 * never submits anything itself; callers record what happened around each
 * contract submission and ask `planRecovery` what is safe to do next.
 *
 * Privacy: only payment IDs, statuses, attempt counts and public transaction
 * hashes are stored. Recipients, amounts, keys and similar fields are redacted
 * from metadata, and error text is scrubbed before it is kept.
 */

import { redactDeep } from "../redaction";

export type PayrollRunPaymentStatus =
  "pending" | "submitted" | "confirmed" | "failed" | "retry_exhausted";

export type PayrollRunRecoveryErrorCode =
  | "RUN_NOT_FOUND"
  | "RUN_ALREADY_EXISTS"
  | "PAYMENT_NOT_FOUND"
  | "INVALID_RUN"
  | "INVALID_TRANSITION"
  | "RETRY_LIMIT_EXCEEDED";

export class PayrollRunRecoveryError extends Error {
  readonly code: PayrollRunRecoveryErrorCode;

  constructor(code: PayrollRunRecoveryErrorCode, message: string) {
    super(message);
    this.name = "PayrollRunRecoveryError";
    this.code = code;
  }
}

export interface PayrollRunPaymentState {
  readonly paymentId: string;
  readonly status: PayrollRunPaymentStatus;
  /** Number of submissions started for this payment. */
  readonly attempts: number;
  /** Public transaction hash of the latest submission, if any. */
  readonly txHash?: string;
  /** Redacted description of the latest failure, if any. */
  readonly lastError?: string;
  readonly updatedAt: number;
}

export interface PayrollRunSnapshot {
  readonly runId: string;
  readonly maxAttempts: number;
  readonly createdAt: number;
  readonly payments: readonly PayrollRunPaymentState[];
  /** Redacted caller-provided metadata. */
  readonly metadata?: Record<string, unknown>;
}

export interface StartPayrollRunInput {
  readonly runId: string;
  readonly paymentIds: readonly string[];
  /** Maximum submissions allowed per payment (default: 3). */
  readonly maxAttempts?: number;
  /** Free-form context; sensitive fields (recipient, amount, keys...) are redacted. */
  readonly metadata?: Record<string, unknown>;
}

export interface PayrollRunRecoveryPlan {
  readonly runId: string;
  /** Never submitted: safe to submit. */
  readonly submit: readonly string[];
  /** Failed with attempts left: safe to resubmit. */
  readonly retry: readonly string[];
  /** Submitted but unconfirmed: check the chain for the tx hash; do NOT resubmit. */
  readonly reconcile: readonly string[];
  /** Attempts exhausted: needs manual intervention. */
  readonly blocked: readonly string[];
  readonly confirmed: readonly string[];
  readonly complete: boolean;
  /** Actionable, privacy-safe instructions for the operator. */
  readonly actions: readonly string[];
}

const DEFAULT_MAX_ATTEMPTS = 3;
const STELLAR_SECRET = /\bS[A-Z2-7]{55}\b/g;
const STELLAR_ADDRESS = /\bG[A-Z2-7]{55}\b/g;
const KEY_VALUE_SECRET =
  /\b(secret|private[_-]?key|mnemonic|seed|password|token|api[_-]?key|authorization)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const MAX_ERROR_LENGTH = 200;

/** Scrubs secrets and account identifiers out of free-form error text. */
export function sanitizeRecoveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const scrubbed = raw
    .replace(STELLAR_SECRET, "[redacted]")
    .replace(STELLAR_ADDRESS, "[redacted]")
    .replace(KEY_VALUE_SECRET, "$1$2[redacted]");
  const text = scrubbed.trim() || "Unknown error";
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}...` : text;
}

interface MutablePayment {
  paymentId: string;
  status: PayrollRunPaymentStatus;
  attempts: number;
  txHash?: string;
  lastError?: string;
  updatedAt: number;
}

interface MutableRun {
  runId: string;
  maxAttempts: number;
  createdAt: number;
  payments: Map<string, MutablePayment>;
  metadata?: Record<string, unknown>;
}

export class PayrollRunRecoveryTracker {
  private readonly runs = new Map<string, MutableRun>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Registers a run and its payments. Every payment starts as `pending`. */
  startRun(input: StartPayrollRunInput): PayrollRunSnapshot {
    const runId = input.runId?.trim();
    if (!runId) {
      throw new PayrollRunRecoveryError("INVALID_RUN", "Run ID must not be empty.");
    }
    if (this.runs.has(runId)) {
      throw new PayrollRunRecoveryError(
        "RUN_ALREADY_EXISTS",
        `Run "${runId}" is already tracked. Use planRecovery("${runId}") to resume it instead of starting it again.`
      );
    }
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new PayrollRunRecoveryError("INVALID_RUN", "maxAttempts must be an integer >= 1.");
    }
    if (input.paymentIds.length === 0) {
      throw new PayrollRunRecoveryError("INVALID_RUN", "A run needs at least one payment ID.");
    }

    const createdAt = this.now();
    const payments = new Map<string, MutablePayment>();
    for (const raw of input.paymentIds) {
      const paymentId = raw?.trim();
      if (!paymentId) {
        throw new PayrollRunRecoveryError("INVALID_RUN", "Payment IDs must not be empty.");
      }
      if (payments.has(paymentId)) {
        throw new PayrollRunRecoveryError("INVALID_RUN", `Duplicate payment ID "${paymentId}".`);
      }
      payments.set(paymentId, { paymentId, status: "pending", attempts: 0, updatedAt: createdAt });
    }

    const run: MutableRun = { runId, maxAttempts, createdAt, payments };
    if (input.metadata) {
      run.metadata = redactDeep(input.metadata).redacted as Record<string, unknown>;
    }
    this.runs.set(runId, run);
    return this.getSnapshot(runId);
  }

  /**
   * Call immediately BEFORE/AS a contract submission is sent, with the tx hash
   * (public) once known. Consumes one attempt, so a crash right after this call
   * is recoverable via `reconcile` rather than a blind resubmit.
   */
  markSubmitted(runId: string, paymentId: string, txHash?: string): PayrollRunPaymentState {
    const run = this.getRun(runId);
    const payment = this.getPayment(run, paymentId);

    if (payment.status === "confirmed" || payment.status === "submitted") {
      throw new PayrollRunRecoveryError(
        "INVALID_TRANSITION",
        `Payment "${paymentId}" is already ${payment.status}. ` +
          (payment.status === "submitted"
            ? "Check the chain for its transaction and call markConfirmed or markFailed instead of resubmitting."
            : "It must not be paid twice.")
      );
    }
    if (payment.attempts >= run.maxAttempts) {
      payment.status = "retry_exhausted";
      throw new PayrollRunRecoveryError(
        "RETRY_LIMIT_EXCEEDED",
        `Payment "${paymentId}" used all ${run.maxAttempts} attempts. Investigate the last error and resolve it manually.`
      );
    }

    payment.attempts += 1;
    payment.status = "submitted";
    payment.txHash = txHash?.trim() || undefined;
    payment.lastError = undefined;
    payment.updatedAt = this.now();
    return this.toState(payment);
  }

  /** Attaches the tx hash once it is known for an already-submitted payment. */
  recordTxHash(runId: string, paymentId: string, txHash: string): PayrollRunPaymentState {
    const payment = this.getPayment(this.getRun(runId), paymentId);
    if (payment.status !== "submitted") {
      throw new PayrollRunRecoveryError(
        "INVALID_TRANSITION",
        `Cannot record a transaction hash for payment "${paymentId}" while it is ${payment.status}.`
      );
    }
    payment.txHash = txHash.trim();
    payment.updatedAt = this.now();
    return this.toState(payment);
  }

  markConfirmed(runId: string, paymentId: string): PayrollRunPaymentState {
    const payment = this.getPayment(this.getRun(runId), paymentId);
    if (payment.status !== "submitted") {
      throw new PayrollRunRecoveryError(
        "INVALID_TRANSITION",
        `Cannot confirm payment "${paymentId}" while it is ${payment.status}; call markSubmitted first.`
      );
    }
    payment.status = "confirmed";
    payment.lastError = undefined;
    payment.updatedAt = this.now();
    return this.toState(payment);
  }

  /** Records a failed submission. The error text is scrubbed before storage. */
  markFailed(runId: string, paymentId: string, error: unknown): PayrollRunPaymentState {
    const run = this.getRun(runId);
    const payment = this.getPayment(run, paymentId);
    if (payment.status !== "submitted") {
      throw new PayrollRunRecoveryError(
        "INVALID_TRANSITION",
        `Cannot fail payment "${paymentId}" while it is ${payment.status}; only submitted payments can fail.`
      );
    }
    payment.status = payment.attempts >= run.maxAttempts ? "retry_exhausted" : "failed";
    payment.lastError = sanitizeRecoveryError(error);
    payment.updatedAt = this.now();
    return this.toState(payment);
  }

  /** Works out what is safe to do next for an interrupted run. */
  planRecovery(runId: string): PayrollRunRecoveryPlan {
    const run = this.getRun(runId);
    const submit: string[] = [];
    const retry: string[] = [];
    const reconcile: string[] = [];
    const blocked: string[] = [];
    const confirmed: string[] = [];
    const actions: string[] = [];

    for (const p of run.payments.values()) {
      switch (p.status) {
        case "pending":
          submit.push(p.paymentId);
          break;
        case "failed":
          retry.push(p.paymentId);
          actions.push(
            `Payment "${p.paymentId}" failed (${p.lastError ?? "unknown error"}); ` +
              `retry is allowed (${run.maxAttempts - p.attempts} attempt(s) left).`
          );
          break;
        case "submitted":
          reconcile.push(p.paymentId);
          actions.push(
            `Payment "${p.paymentId}" was submitted but never confirmed. ` +
              (p.txHash
                ? `Look up transaction ${p.txHash} on-chain, then call markConfirmed or markFailed. Do not resubmit.`
                : "No transaction hash was recorded; check the contract for this payment before any resubmission.")
          );
          break;
        case "retry_exhausted":
          blocked.push(p.paymentId);
          actions.push(
            `Payment "${p.paymentId}" used all ${run.maxAttempts} attempts (${p.lastError ?? "unknown error"}). ` +
              "Resolve the underlying issue manually or start a new run."
          );
          break;
        case "confirmed":
          confirmed.push(p.paymentId);
          break;
      }
    }
    if (submit.length > 0) {
      actions.push(`${submit.length} payment(s) have not been submitted yet.`);
    }

    return {
      runId,
      submit,
      retry,
      reconcile,
      blocked,
      confirmed,
      complete: confirmed.length === run.payments.size,
      actions,
    };
  }

  /** Throws with an actionable message unless every payment is safe to continue. */
  assertRecoverable(runId: string): PayrollRunRecoveryPlan {
    const plan = this.planRecovery(runId);
    if (plan.blocked.length > 0 || plan.reconcile.length > 0) {
      throw new PayrollRunRecoveryError(
        plan.blocked.length > 0 ? "RETRY_LIMIT_EXCEEDED" : "INVALID_TRANSITION",
        `Run "${runId}" cannot resume automatically: ${plan.actions.join(" ")}`
      );
    }
    return plan;
  }

  /** Redacted, copy-on-read view of a run, safe to log or persist. */
  getSnapshot(runId: string): PayrollRunSnapshot {
    const run = this.getRun(runId);
    return {
      runId: run.runId,
      maxAttempts: run.maxAttempts,
      createdAt: run.createdAt,
      payments: [...run.payments.values()].map((p) => this.toState(p)),
      ...(run.metadata ? { metadata: structuredCloneJson(run.metadata) } : {}),
    };
  }

  /** Rebuilds a tracked run from a snapshot saved before an interruption. */
  restore(snapshot: PayrollRunSnapshot): void {
    if (this.runs.has(snapshot.runId)) {
      throw new PayrollRunRecoveryError(
        "RUN_ALREADY_EXISTS",
        `Run "${snapshot.runId}" is already tracked; cannot restore over it.`
      );
    }
    const payments = new Map<string, MutablePayment>();
    for (const p of snapshot.payments) {
      payments.set(p.paymentId, { ...p });
    }
    this.runs.set(snapshot.runId, {
      runId: snapshot.runId,
      maxAttempts: snapshot.maxAttempts,
      createdAt: snapshot.createdAt,
      payments,
      ...(snapshot.metadata
        ? { metadata: redactDeep(snapshot.metadata).redacted as Record<string, unknown> }
        : {}),
    });
  }

  private getRun(runId: string): MutableRun {
    const run = this.runs.get(runId);
    if (!run) {
      throw new PayrollRunRecoveryError(
        "RUN_NOT_FOUND",
        `Run "${runId}" is not tracked. Call startRun, or restore() a saved snapshot, first.`
      );
    }
    return run;
  }

  private getPayment(run: MutableRun, paymentId: string): MutablePayment {
    const payment = run.payments.get(paymentId);
    if (!payment) {
      throw new PayrollRunRecoveryError(
        "PAYMENT_NOT_FOUND",
        `Payment "${paymentId}" is not part of run "${run.runId}".`
      );
    }
    return payment;
  }

  private toState(p: MutablePayment): PayrollRunPaymentState {
    const { txHash, lastError, ...rest } = p;
    return {
      ...rest,
      ...(txHash ? { txHash } : {}),
      ...(lastError ? { lastError } : {}),
    };
  }
}

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
