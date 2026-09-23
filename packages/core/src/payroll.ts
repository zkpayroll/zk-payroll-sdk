import { Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import type { ISigner } from "./signer/types";
import { toISigner } from "./signer/KeypairSigner";
import { PayrollContractWrapper } from "./adapters/PayrollContractWrapper";
import { IProofGenerator, ProofPayload } from "./crypto/IProofGenerator";
import { PayrollError, PayrollServiceErrorCode, ZkPayrollError } from "./errors";
import { PaymentParams, PaymentResult } from "./types";
import { SdkLogger } from "./logging/SdkLogger";
import { redactError } from "./redaction/RedactionEngine";
import { IdempotencyRegistry, createPaymentIdempotencyKey } from "./core/idempotency";
import { createPayrollProgressEvent } from "./progress";
import { assertValidPayrollWitness } from "./crypto/proofInputSanitizer";
import { iterateBatches } from "./batch/paginate";
import type { BatchPayload } from "./batch/BatchPayloadBuilder";
import {
  createPayrollReceipt,
  verifyPayrollReceipt,
  assertValidPayrollReceipt,
} from "./receipts/receiptVerifier";
import type {
  PayrollReceipt,
  ReceiptVerificationOptions,
  ReceiptVerificationResult,
  CreatePayrollReceiptParams,
} from "./receipts/types";

import {
  filterActiveRuns,
  filterArchivedRuns,
  filterDisputedRuns,
  filterFinalizedRuns,
  filterHeldRuns,
  PayrollRunItem,
} from "./archive";

export interface Transaction {
  amount: bigint;
  [key: string]: unknown;
}

export interface FilterCriteria {
  minAmount: bigint;
}

/**
 * PayrollService — API layer for private payroll payments.
 *
 * Orchestrates ZK proof generation and contract invocation through
 * injected dependencies (IProofGenerator and PayrollContractWrapper).
 *
 * Pass an SdkLogger to observe payment lifecycle events without patching internals.
 * Sensitive fields (recipient, amount, asset) are never written to the log.
 */
export class PayrollService {
  private readonly signer: ISigner;
  private readonly paymentIdempotency = new IdempotencyRegistry<PaymentResult>();

  constructor(
    private readonly contractWrapper: PayrollContractWrapper,
    private readonly proofGenerator: IProofGenerator,
    signer: Keypair | ISigner,
    private readonly network: string = Networks.TESTNET,
    private readonly logger?: SdkLogger
  ) {
    this.signer = toISigner(signer);
  }

  /**
   * Process a private payment by generating a ZK proof and submitting
   * the transaction to the Soroban contract.
   */
  async processPayment(params: PaymentParams): Promise<PaymentResult> {
    const explicitKey = params.idempotencyKey?.trim();
    if (!explicitKey) {
      return this.processPaymentInternal(params);
    }

    return this.paymentIdempotency.execute(explicitKey, async () => {
      return this.processPaymentInternal(params);
    });
  }

  /**
   * Build a deterministic idempotency key from payment data.
   */
  static createIdempotencyKey(
    params: Pick<PaymentParams, "recipient" | "amount" | "asset">
  ): string {
    return createPaymentIdempotencyKey(params);
  }

  private async processPaymentInternal(params: PaymentParams): Promise<PaymentResult> {
    const { recipient, amount, asset } = params;

    this.logger?.info("payment_start");

    // 1. Validate inputs
    params.onProgress?.(
      createPayrollProgressEvent({
        operation: "payment",
        stage: "validation",
        message: "validation_started",
        progress: 0,
      })
    );
    try {
      this.validatePaymentParams(params);
      params.onProgress?.(
        createPayrollProgressEvent({
          operation: "payment",
          stage: "validation",
          message: "validation_completed",
          progress: 100,
        })
      );
    } catch (error) {
      this.logger?.warn("payment_validation_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    // 2. Generate ZK proof
    // Build witness then sanitize it with payroll-specific validation
    // (required fields enforced; forbidden fields rejected; amounts normalized).
    const rawWitness: Record<string, unknown> = {
      recipient,
      amount: amount.toString(),
      asset,
    };

    // Throws ProofGenerationError if any required field is missing or invalid.
    // Error messages never contain raw input values.
    const witness = assertValidPayrollWitness(rawWitness);

    let proof: ProofPayload;
    try {
      proof = await this.proofGenerator.generateProof(witness, params.onProgress);
    } catch (error) {
      if (error instanceof PayrollError) {
        throw error;
      }
      throw new PayrollError(
        `Proof generation failed: ${error instanceof Error ? error.message : String(error)}`,
        PayrollServiceErrorCode.PROOF_GENERATION_FAILED
      );
    }

    // 3. Invoke contract
    params.onProgress?.(
      createPayrollProgressEvent({
        operation: "payment",
        stage: "submission_preparing",
        message: "submission_preparing",
        progress: 0,
        metadata: { method: "private_pay" },
      })
    );
    this.logger?.info("contract_invocation_start", { method: "private_pay" });

    let resultXdr: xdr.ScVal;
    try {
      resultXdr = await this.contractWrapper.privatePay(
        recipient,
        amount,
        asset,
        proof,
        this.signer,
        this.network,
        params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
      );
    } catch (error) {
      // Surfaces contract-level rejections -- including state-gating
      // failures where the contract reverts because e.g. the company or
      // payroll isn't in a state that allows this call -- with the same
      // observability the validation-failure path already gets above.
      // The error itself (its type and message, e.g. ContractExecutionError
      // with ContractErrorCode.CONTRACT_REVERT) is rethrown unchanged so
      // existing consumers that catch specific error types keep working.
      //
      // The error message is sanitized through redactError() before logging
      // to prevent sensitive field values (privateKey=..., recipient=..., etc.)
      // embedded in contract-level error messages from leaking into logs.
      const safeMessage = error instanceof Error ? redactError(error).message : String(error);
      this.logger?.error("contract_invocation_failed", {
        method: "private_pay",
        error: safeMessage,
        code: error instanceof ZkPayrollError ? error.code : undefined,
      });
      throw error;
    }

    params.onProgress?.(
      createPayrollProgressEvent({
        operation: "payment",
        stage: "submission_done",
        message: "submission_done",
        progress: 100,
        metadata: { method: "private_pay" },
      })
    );

    const result: PaymentResult = {
      txHash: resultXdr.toXDR("hex"),
      publicSignals: proof.publicSignals,
    };

    this.logger?.info("payment_complete", { txHash: result.txHash });

    return result;
  }

  filterTransactions(transactions: Transaction[], criteria: FilterCriteria): Transaction[] {
    return transactions.filter((t) => t.amount > criteria.minAmount);
  }

  /**
   * Validate a batch payroll payload locally before processing.
   * Returns structured validation errors or empty array if valid.
   */
  validateBatch(entries: unknown[]): unknown[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PayrollValidation } = require("./core/validation");
    return PayrollValidation.validateBatchPayload(entries);
  }

  /**
   * Process a batch of private payroll payments.
   * Validates all batch payment entries first; rejects invalid payloads before submission.
   *
   * When `batchSize` is provided, validated entries are processed incrementally
   * in deterministic, order-preserving batches via the batch pagination helper.
   * Results are returned in the original entry order either way.
   */
  async processBatchPayments(entries: unknown[], batchSize?: number): Promise<PaymentResult[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PayrollValidation } = require("./core/validation");
    const payload: BatchPayload = PayrollValidation.assertValidBatchPayload(entries);

    const results: PaymentResult[] = [];
    for (const batch of iterateBatches(payload.entries, batchSize)) {
      for (const entry of batch.items) {
        const res = await this.processPayment(entry);
        results.push(res);
      }
    }
    return results;
  }

  /** Filter archived, disputed, and held runs out of active operational views. */
  filterActivePayrollRuns<T extends PayrollRunItem>(runs: T[]): T[] {
    return filterActiveRuns(runs);
  }

  /** Filter safely archived runs (excluding disputed or held runs). */
  filterArchivedPayrollRuns<T extends PayrollRunItem>(runs: T[]): T[] {
    return filterArchivedRuns(runs);
  }

  /** Filter disputed payroll runs. */
  filterDisputedPayrollRuns<T extends PayrollRunItem>(runs: T[]): T[] {
    return filterDisputedRuns(runs);
  }

  /** Filter finalized payroll runs free of disputes or holds. */
  filterFinalizedPayrollRuns<T extends PayrollRunItem>(runs: T[]): T[] {
    return filterFinalizedRuns(runs);
  }

  /** Filter held payroll runs. */
  filterHeldPayrollRuns<T extends PayrollRunItem>(runs: T[]): T[] {
    return filterHeldRuns(runs);
  }

  private validatePaymentParams(params: PaymentParams): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PayrollValidation } = require("./core/validation");
    const result = PayrollValidation.validatePaymentParams(params);
    if (!result.isValid) {
      // Map to backward-compatible PayrollError
      const firstError = result.errors[0];
      let code: number | string = 0;
      if (firstError.field === "recipient") code = PayrollServiceErrorCode.INVALID_RECIPIENT;
      else if (firstError.field === "amount") code = PayrollServiceErrorCode.INVALID_AMOUNT;
      else if (firstError.field === "asset") code = PayrollServiceErrorCode.INVALID_ASSET;

      throw new PayrollError(firstError.message, code);
    }
  }

  /**
   * Generates a verifiable PayrollReceipt record for a completed payment.
   * Sensitive values remain safely formatted or redacted.
   */
  createReceipt(
    params: PaymentParams,
    result: PaymentResult,
    payrollId: string = `pr_${Date.now()}`,
    overrides: Partial<CreatePayrollReceiptParams> = {}
  ): PayrollReceipt {
    return createPayrollReceipt({
      payrollId,
      settlementStatus: "settled",
      transactionReference: {
        txHash: result.txHash,
        network: this.network,
        confirmedAt: Date.now(),
      },
      totalAmount: params.amount,
      currency: params.asset,
      recipientCount: 1,
      metadata: {
        recipient: params.recipient,
        asset: params.asset,
        idempotencyKey: params.idempotencyKey,
      },
      ...overrides,
    });
  }

  /**
   * Verifies a payroll receipt against defined integrity, settlement,
   * transaction reference, and metadata digest constraints.
   */
  verifyReceipt(
    receipt: PayrollReceipt | unknown,
    options?: ReceiptVerificationOptions
  ): ReceiptVerificationResult {
    return verifyPayrollReceipt(receipt, options);
  }

  /**
   * Asserts that a payroll receipt is valid, throwing `PayrollReceiptVerificationError`
   * if verification fails.
   */
  assertValidReceipt(
    receipt: PayrollReceipt | unknown,
    options?: ReceiptVerificationOptions
  ): PayrollReceipt {
    return assertValidPayrollReceipt(receipt, options);
  }

  /**
   * Static helper: verifies a payroll receipt.
   */
  static verifyReceipt(
    receipt: PayrollReceipt | unknown,
    options?: ReceiptVerificationOptions
  ): ReceiptVerificationResult {
    return verifyPayrollReceipt(receipt, options);
  }

  /**
   * Static helper: asserts validity of a payroll receipt.
   */
  static assertValidReceipt(
    receipt: PayrollReceipt | unknown,
    options?: ReceiptVerificationOptions
  ): PayrollReceipt {
    return assertValidPayrollReceipt(receipt, options);
  }
}
