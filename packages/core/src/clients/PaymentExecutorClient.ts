import {
  rpc,
  xdr,
  nativeToScVal,
  scValToNative,
  Address,
  Keypair,
  Networks,
} from "@stellar/stellar-sdk";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import {
  ClientOptions,
  ExecutePaymentRequest,
  SchedulePaymentRequest,
  ScheduledPayment,
} from "./types";

export interface ExecutePaymentResponse {
  txHash: string;
}

export interface SchedulePaymentResponse {
  paymentId: bigint;
}

/**
 * Structured diagnostics for a failed payout execution.
 */
export interface PayoutFailureDiagnostics {
  /** Whether the failure is considered retryable. */
  retryable: boolean;
  /** A stable, machine-readable classification of the failure. */
  code: PayoutFailureCode;
  /** Human-readable explanation of the failure. */
  message: string;
  /** Actionable guidance for the integrator. */
  action: string;
  /** Suggested backoff in milliseconds before retrying, if retryable. */
  retryAfterMs?: number;
  /** The underlying error message, if any. */
  cause?: string;
}

export type PayoutFailureCode =
  | "TRANSIENT_FAILED"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_ALLOWANCE"
  | "UNAUTHORIZED"
  | "INVALID_RECIPIENT"
  | "INVALID_AMOUNT"
  | "CONTRACT_REJECTED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UNKNOWN";

/**
 * Error thrown when a payout execution fails. Carries structured
 * diagnostics so integrators can decide whether and when to retry.
 */
export class PayoutExecutionError extends Error {
  readonly diagnostics: PayoutFailureDiagnostics;

  constructor(diagnostics: PayoutFailureDiagnostics) {
    super(diagnostics.message);
    this.name = "PayoutExecutionError";
    this.diagnostics = diagnostics;
  }
}

export class PaymentExecutorClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  async execute(
    request: ExecutePaymentRequest,
    signer: Keypair,
    network?: string
  ): Promise<ExecutePaymentResponse> {
    const validationError = this.validateExecuteRequest(request);
    if (validationError) {
      throw new PayoutExecutionError(validationError);
    }

    const args: xdr.ScVal[] = [
      new Address(request.recipient).toScVal(),
      nativeToScVal(request.amount, { type: "i128" }),
      new Address(request.asset).toScVal(),
      nativeToScVal(request.memo ?? "", { type: "string" }),
    ];

    try {
      const result = await this.invoke(
        "execute",
        args,
        signer,
        network ?? this.networkPassphrase
      );
      return { txHash: this.scValToHex(result) };
    } catch (error) {
      throw this.buildExecutionError(request, error);
    }
  }

  /**
   * Classify a failed payout and return actionable retry diagnostics.
   * This is exposed so integrators can inspect failures without retrying.
   */
  diagnoseExecutionFailure(error: unknown): PayoutFailureDiagnostics {
    return this.classifyFailure(error);
  }

  async schedule(
    request: SchedulePaymentRequest,
    signer: Keypair,
    network?: string
  ): Promise<SchedulePaymentResponse> {
    const args: xdr.ScVal[] = [
      new Address(request.recipient).toScVal(),
      nativeToScVal(request.amount, { type: "i128" }),
      new Address(request.asset).toScVal(),
      nativeToScVal(request.executeAt, { type: "u64" }),
      nativeToScVal(request.memo ?? "", { type: "string" }),
    ];

    const result = await this.invoke("schedule", args, signer, network ?? this.networkPassphrase);
    return { paymentId: this.scValToBigInt(result) };
  }

  async cancel(
    paymentId: bigint,
    signer: Keypair,
    reasonCode?: string,
    network?: string
  ): Promise<void> {
    if (reasonCode) {
      const { isSupportedCancellationReason } = require("../payroll/cancellation");
      if (!isSupportedCancellationReason(reasonCode)) {
        throw new Error(`Unsupported cancellation reason: ${reasonCode}`);
      }
    }

    const args: xdr.ScVal[] = [nativeToScVal(paymentId, { type: "u64" })];
    if (reasonCode) {
      args.push(nativeToScVal(reasonCode, { type: "symbol" }));
    }
    await this.invoke("cancel", args, signer, network ?? this.networkPassphrase);
  }

  async getScheduledPayment(
    paymentId: bigint,
    signer: Keypair,
    network?: string
  ): Promise<ScheduledPayment> {
    const args: xdr.ScVal[] = [nativeToScVal(paymentId, { type: "u64" })];
    const result = await this.invoke(
      "get_scheduled_payment",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return this.decodeScheduledPayment(result);
  }

  async getPendingPayments(
    employer: string,
    start: bigint,
    limit: number,
    signer: Keypair,
    network?: string
  ): Promise<ScheduledPayment[]> {
    const args: xdr.ScVal[] = [
      new Address(employer).toScVal(),
      nativeToScVal(start, { type: "u64" }),
      nativeToScVal(limit, { type: "u32" }),
    ];

    const result = await this.invoke(
      "get_pending_payments",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return this.decodeScheduledPaymentVec(result);
  }

  async getPaymentCount(employer: string, signer: Keypair, network?: string): Promise<number> {
    const args: xdr.ScVal[] = [new Address(employer).toScVal()];
    const result = await this.invoke(
      "get_payment_count",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return Number(result.u32());
  }

  private validateExecuteRequest(
    request: ExecutePaymentRequest
  ): PayoutFailureDiagnostics | null {
    if (!request.recipient || !this.isValidAddress(request.recipient)) {
      return {
        retryable: false,
        code: "INVALID_RECIPIENT",
        message: "Recipient address is missing or malformed.",
        action: "Provide a valid stellar address for the recipient.",
      };
    }
    if (!request.asset || !this.isValidAddress(request.asset)) {
      return {
        retryable: false,
        code: "INVALID_RECIPIENT",
        message: "Asset address is missing or malformed.",
        action: "Provide a valid stellar asset address.",
      };
    }
    if (request.amount == null || request.amount <= 0n) {
      return {
        retryable: false,
        code: "INVALID_AMOUNT",
        message: "Payment amount must be greater than zero.",
        action: "Set a positive amount in the smallest unit of the asset.",
      };
    }
    return null;
  }

  private buildExecutionError(
    request: ExecutePaymentRequest,
    error: unknown
  ): PayoutExecutionError {
    const diagnostics = this.classifyFailure(error);
    return new PayoutExecutionError(diagnostics);
  }

  private classifyFailure(error: unknown): PayoutFailureDiagnostics {
    const cause = this.extractMessage(error);
    const lower = cause.toLowerCase();

    if (lower.includes("insufficient balance") || lower.includes("balance is too low")) {
      return {
        retryable: true,
        code: "INSUFFICIENT_BALANCE",
        message: "The source account has insufficient balance for this payout.",
        action: "Fund the source account and retry.",
        retryAfterMs: 5000,
        cause,
      };
    }

    if (lower.includes("insufficient allowance") || lower.includes("allowance")) {
      return {
        retryable: true,
        code: "INSUFFICIENT_ALLOWANCE",
        message: "The spender allowance is insufficient for this payout.",
        action: "Increase the token allowance for the payment executor and retry.",
        retryAfterMs: 5000,
        cause,
      };
    }

    if (lower.includes("unauthorized") || lower.includes("not authorized") || lower.includes("auth")) {
      return {
        retryable: false,
        code: "UNAUTHORIZED",
        message: "The signer is not authorized to execute this payout.",
        action: "Verify the signer key and its role in the payroll contract.",
        cause,
      };
    }

    if (lower.includes("timeout") || lower.includes("timed out")) {
      return {
        retryable: true,
        code: "TIMEOUT",
        message: "The payout transaction timed out.",
        action: "Retry the payout after a short backoff.",
        retryAfterMs: 2000,
        cause,
      };
    }

    if (
      lower.includes("network") ||
      lower.includes("connection") ||
      lower.includes("fetch") ||
      lower.includes("rpc")
    ) {
      return {
        retryable: true,
        code: "NETWORK_ERROR",
        message: "A network error occurred while submitting the payout.",
        action: "Check network connectivity and retry.",
        retryAfterMs: 3000,
        cause,
      };
    }

    if (lower.includes("contract") || lower.includes("reject")) {
      return {
        retryable: false,
        code: "CONTRACT_REJECTED",
        message: "The payroll contract rejected the payout.",
        action: "Review the contract state and payout parameters before retrying.",
        cause,
      };
    }

    return {
      retryable: false,
      code: "TRANSIENT_FAILED",
      message: "The payout transaction failed.",
      action: "Inspect the cause and contact support if the issue persists.",
      cause,
    };
  }

  private extractMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private isValidAddress(value: string): boolean {
    try {
      // Address.fromString throws for malformed addresses.
      Address.fromString(value);
      return true;
    } catch {
      return false;
    }
  }

  private decodeScheduledPayment(scVal: xdr.ScVal): ScheduledPayment {
    const map = scVal.map();
    if (!map) {
      throw new Error("Expected scvMap for ScheduledPayment");
    }

    const entries: Record<string, xdr.ScVal> = {};
    for (const entry of map) {
      const key = entry.key().sym()?.toString() ?? "";
      entries[key] = entry.val();
    }

    return {
      id: this.scValToBigInt(entries.id),
      employer: Address.fromScVal(entries.employer).toString(),
      recipient: Address.fromScVal(entries.recipient).toString(),
      amount: this.scValToBigInt(entries.amount),
      asset: Address.fromScVal(entries.asset).toString(),
      executeAt: Number(this.scValToBigInt(entries.execute_at)),
      memo: entries.memo?.str()?.toString() ?? "",
      executed: entries.executed?.b() ?? false,
      cancelled: entries.cancelled?.b() ?? false,
      createdAt: Number(this.scValToBigInt(entries.created_at)),
    };
  }

  private decodeScheduledPaymentVec(scVal: xdr.ScVal): ScheduledPayment[] {
    const vec = scVal.vec();
    if (!vec) return [];
    return vec.map((v) => this.decodeScheduledPayment(v));
  }

  private scValToHex(scVal: xdr.ScVal): string {
    const bytes = scVal.bytes();
    if (bytes) return Buffer.from(bytes).toString("hex");
    const str = scVal.str();
    if (str) return str.toString();
    return "";
  }

  private scValToBigInt(scVal: xdr.ScVal): bigint {
    try {
      const native = scValToNative(scVal);
      if (typeof native === "bigint") return native;
      if (typeof native === "number") return BigInt(native);
      if (typeof native === "string") {
        try {
          return BigInt(native);
        } catch {
          return 0n;
        }
      }
    } catch {}
    try {
      const i128 = scVal.i128();
      if (i128) {
        const hi = BigInt((i128.hi() as unknown as { toString: () => string }).toString());
        const lo = BigInt((i128.lo() as unknown as { toString: () => string }).toString());
        return (hi << 64n) | lo;
      }
    } catch {}
    try {
      const u64 = scVal.u64();
      if (u64) {
        return BigInt((u64 as unknown as { toString: () => string }).toString());
      }
    } catch {}
    return 0n;
  }
}
