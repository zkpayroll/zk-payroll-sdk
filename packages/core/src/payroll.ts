import { Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import type { ISigner } from "./signer/types";
import { toISigner } from "./signer/KeypairSigner";
import { PayrollContractWrapper } from "./adapters/PayrollContractWrapper";
import { IProofGenerator, ProofPayload } from "./crypto/IProofGenerator";
import { PayrollError, PayrollServiceErrorCode, ZkPayrollError } from "./errors";
import { PaymentParams, PaymentResult } from "./types";
import { SdkLogger } from "./logging/SdkLogger";
import type { ServerCacheAdapter } from "./cache/ServerCacheAdapter";
import { CacheNamespace } from "./cache/types";
import type { EmployerUpdatedEvent } from "./events/employerUpdated";
import { redactError } from "./redaction/RedactionEngine";
import {
  assertPayrollOperatorPermission,
  PayrollOperatorPermissionError,
} from "./roles/capabilityMatrix";
import { IdempotencyRegistry, createPaymentIdempotencyKey } from "./core/idempotency";
import { createPayrollProgressEvent } from "./progress";
import { assertValidPayrollWitness } from "./crypto/proofInputSanitizer";
import { assertValidPageSize, iterateBatches } from "./batch/paginate";
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
  submitSequentialPayrollBatches,
  type SafeBatchSubmissionOptions,
  type SafeBatchSubmissionResult,
  type SafeBatchProgressEvent,
  type SafeBatchProgressStage,
  type SafeBatchErrorDetail,
} from "./payroll/safeBatchSubmitter";
import {
  createBatchResumeToken,
  decodeBatchResumeToken,
  resolveResumeStart,
  RESUME_TOKEN_VERSION,
  RESUME_TOKEN_ERROR_CODE,
  type BatchResumeCheckpoint,
  type ResumeStartPoint,
} from "./payroll/batchResumeToken";
import {
  validateSettlementReceipt as validateSettlementReceiptHelper,
  type SettlementReceiptValidation,
  type SettlementReceiptValidationOptions,
} from "./settlement/receipt";
import {
  validateWithholdingConfig as validateWithholdingConfigHelper,
  type WithholdingConfigValidation,
  type WithholdingConfigValidationOptions,
} from "./payroll/withholdingConfig";
import {
  validatePaymentDestination,
  getRegisteredDestinationValidationHook,
  setDestinationValidationHook,
  resetDestinationValidationHook,
  type DestinationWorkflowValidation,
} from "./settlement/destination";
import type { DestinationValidationHook } from "./employees/payoutDestination";
import {
  fetchRecipientLockStatus as fetchRecipientLockStatusHelper,
  evaluateRecipientLockStatus as evaluateRecipientLockStatusHelper,
  evaluateBatchRecipientLockStatus as evaluateBatchRecipientLockStatusHelper,
  formatRecipientLockStatus as formatRecipientLockStatusHelper,
  isRecipientLocked as isRecipientLockedHelper,
  canRecipientReceivePayout as canRecipientReceivePayoutHelper,
  type RecipientLockStatus,
  type RecipientLockReason,
  type FetchRecipientLockStatusOptions,
  type RecipientLockReadOptions,
  type ActivePayrollExecution,
  type BatchRecipientLockSummary,
} from "./payroll/recipientLockStatus";
import {
  inspectDraftLock as inspectDraftLockHelper,
  assertDraftLockable as assertDraftLockableHelper,
  isDraftLockable as isDraftLockableHelper,
  formatDraftLockInspectionSummary as formatDraftLockInspectionSummaryHelper,
  createMockDraftLockInspectionResult as createMockDraftLockInspectionResultHelper,
  DraftLockError,
  type DraftLockInspectionResult,
  type DraftLockInspectionOptions,
  type DraftLockState,
  type DraftLockErrorCode,
  type DraftLockBlocker,
  type DraftLockWarning,
  type DraftLockWarningCode,
} from "./draft/draftLockInspection";

export {
  fetchRecipientLockStatusHelper as fetchRecipientLockStatus,
  evaluateRecipientLockStatusHelper as evaluateRecipientLockStatus,
  evaluateBatchRecipientLockStatusHelper as evaluateBatchRecipientLockStatus,
  formatRecipientLockStatusHelper as formatRecipientLockStatus,
  isRecipientLockedHelper as isRecipientLocked,
  canRecipientReceivePayoutHelper as canRecipientReceivePayout,
  type RecipientLockStatus,
  type RecipientLockReason,
  type FetchRecipientLockStatusOptions,
  type RecipientLockReadOptions,
  type ActivePayrollExecution,
  type BatchRecipientLockSummary,
};

export {
  inspectDraftLockHelper as inspectDraftLock,
  assertDraftLockableHelper as assertDraftLockable,
  isDraftLockableHelper as isDraftLockable,
  formatDraftLockInspectionSummaryHelper as formatDraftLockInspectionSummary,
  createMockDraftLockInspectionResultHelper as createMockDraftLockInspectionResult,
  DraftLockError,
  type DraftLockInspectionResult,
  type DraftLockInspectionOptions,
  type DraftLockState,
  type DraftLockErrorCode,
  type DraftLockBlocker,
  type DraftLockWarning,
  type DraftLockWarningCode,
};

import {
  diagnoseBlockedExecution as diagnoseBlockedExecutionHelper,
  assertCanExecute as assertCanExecuteHelper,
  hasExecutionBlocker as hasExecutionBlockerHelper,
  getDiagnosticsByCategory as getDiagnosticsByCategoryHelper,
  getFirstRemediation as getFirstRemediationHelper,
  formatBlockedExecutionReport as formatBlockedExecutionReportHelper,
  BlockedExecutionError,
  type BlockedExecutionInput,
  type BlockedExecutionReport,
  type BlockedExecutionDiagnostic,
  type BlockedExecutionReasonCode,
  type BlockerSeverity,
  type BlockerCategory,
  type ExecutionRemediation,
  type RemediationActionType,
} from "./payroll/blockedExecutionDiagnostics";

export {
  diagnoseBlockedExecutionHelper as diagnoseBlockedExecution,
  assertCanExecuteHelper as assertCanExecute,
  hasExecutionBlockerHelper as hasExecutionBlocker,
  getDiagnosticsByCategoryHelper as getDiagnosticsByCategory,
  getFirstRemediationHelper as getFirstRemediation,
  formatBlockedExecutionReportHelper as formatBlockedExecutionReport,
  BlockedExecutionError,
  type BlockedExecutionInput,
  type BlockedExecutionReport,
  type BlockedExecutionDiagnostic,
  type BlockedExecutionReasonCode,
  type BlockerSeverity,
  type BlockerCategory,
  type ExecutionRemediation,
  type RemediationActionType,
};

export {
  submitSequentialPayrollBatches,
  type SafeBatchSubmissionOptions,
  type SafeBatchSubmissionResult,
  type SafeBatchProgressEvent,
  type SafeBatchProgressStage,
  type SafeBatchErrorDetail,
};

export {
  createBatchResumeToken,
  decodeBatchResumeToken,
  resolveResumeStart,
  RESUME_TOKEN_VERSION,
  RESUME_TOKEN_ERROR_CODE,
  type BatchResumeCheckpoint,
  type ResumeStartPoint,
};

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

export interface PayrollServiceOptions {
  /** Resolve authoritative role assignments for an operator before payroll submission. */
  resolveOperatorRoles?: (operatorAddress: string) => Promise<readonly string[]>;
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
    private readonly logger?: SdkLogger,
    private readonly cache?: ServerCacheAdapter,
    private readonly options: PayrollServiceOptions = {}
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

    // 1b. Destination validation extension point (#531)
    // Runs organizational destination policy (if a hook is registered) after
    // built-in validation and before any proof generation or submission.
    // The error path is sanitized through redactError() so the rejected
    // destination can never surface in logs or events.
    const destinationCheck = await validatePaymentDestination(recipient);
    if (!destinationCheck.ok) {
      const destinationError = new PayrollError(
        destinationCheck.message,
        PayrollServiceErrorCode.INVALID_RECIPIENT
      );
      this.logger?.warn("payment_destination_rejected", {
        code: destinationCheck.code,
        state: destinationCheck.state,
        error: redactError(destinationError).message,
      });
      params.onProgress?.(
        createPayrollProgressEvent({
          operation: "payment",
          stage: "validation",
          message: "destination_validation_failed",
          progress: 100,
          metadata: { code: destinationCheck.code },
        })
      );
      throw destinationError;
    }

    if (this.options.resolveOperatorRoles) {
      try {
        const operatorAddress = await this.signer.getPublicKey();
        const operatorRoles = await this.options.resolveOperatorRoles(operatorAddress);
        assertPayrollOperatorPermission(operatorAddress, operatorRoles, "submit");
      } catch (error) {
        if (error instanceof PayrollOperatorPermissionError) throw error;
        throw new PayrollOperatorPermissionError(
          "OPERATOR_PERMISSION_LOOKUP_FAILED",
          "submit",
          "Unable to verify payroll operator permissions. Check the role registry connection and retry.",
          error
        );
      }
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
   * Optional progress events report batch lifecycle and cumulative successful
   * item counts without exposing payment details. Results are returned in the
   * original entry order either way.
   */
  async processBatchPayments(
    entries: unknown[],
    batchSize?: number,
    onProgress?: (event: SafeBatchProgressEvent) => void
  ): Promise<PaymentResult[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PayrollValidation } = require("./core/validation");
    const payload: BatchPayload = PayrollValidation.assertValidBatchPayload(entries);

    const results: PaymentResult[] = [];
    const totalItems = payload.entries.length;
    assertValidPageSize(batchSize);
    const totalBatches = totalItems === 0 ? 0 : Math.ceil(totalItems / (batchSize ?? totalItems));
    let itemsProcessed = 0;
    const emitProgress = (stage: SafeBatchProgressStage, batchIndex: number, message: string) => {
      onProgress?.({
        stage,
        batchIndex,
        totalBatches,
        itemsProcessed,
        totalItems,
        percentage:
          totalItems === 0 ? 100 : Math.min(100, Math.round((itemsProcessed / totalItems) * 100)),
        message,
        timestamp: new Date().toISOString(),
      });
    };

    emitProgress(
      "validating",
      0,
      `Validating ${totalItems} payroll item(s) across ${totalBatches} batch(es)...`
    );
    for (const batch of iterateBatches(payload.entries, batchSize)) {
      emitProgress(
        "batch_starting",
        batch.index,
        `Starting batch ${batch.index + 1} of ${totalBatches}...`
      );
      emitProgress(
        "batch_submitting",
        batch.index,
        `Processing batch ${batch.index + 1} of ${totalBatches}...`
      );
      try {
        for (const entry of batch.items) {
          const res = await this.processPayment(entry);
          results.push(res);
          itemsProcessed++;
        }
      } catch (error) {
        emitProgress("failed", batch.index, `Batch ${batch.index + 1} of ${totalBatches} failed.`);
        throw error;
      }
      emitProgress(
        "batch_completed",
        batch.index,
        `Completed batch ${batch.index + 1} of ${totalBatches}.`
      );
    }
    emitProgress("completed", totalBatches - 1, `Completed all ${totalBatches} payroll batch(es).`);
    return results;
  }

  /**
   * Submit payroll payments in safe, sequential batches with progress callbacks
   * and guarded retries (#472).
   *
   * Validates entries first, splits them into deterministic batches, and submits
   * each batch sequentially. Emits privacy-safe progress events, guards against transient
   * failures with exponential backoff retries, and redacts sensitive payment data on error.
   *
   * @param entries - Payment items to process
   * @param options - Configuration for batch size, retries, and progress callbacks
   * @returns Comprehensive batch submission result with execution statistics and results
   */
  async submitBatchPaymentsSafely(
    entries: unknown[],
    options?: SafeBatchSubmissionOptions<PaymentParams, PaymentResult>
  ): Promise<SafeBatchSubmissionResult<PaymentResult>> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PayrollValidation } = require("./core/validation");
    const payload: BatchPayload = PayrollValidation.assertValidBatchPayload(entries);

    return submitSequentialPayrollBatches(
      payload.entries,
      async (batchItems: PaymentParams[]) => {
        const batchResults: PaymentResult[] = [];
        for (const item of batchItems) {
          const res = await this.processPayment(item);
          batchResults.push(res);
        }
        return batchResults;
      },
      options
    );
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

  /**
   * Invalidates the cached configuration. If an employer address is provided,
   * you may optionally target just that employer's configuration if your cache
   * adapter supports it, otherwise this clears the entire CONFIGURATION namespace.
   */
  async invalidateConfigurationCache(employerAddress?: string): Promise<void> {
    if (!this.cache) {
      this.logger?.info("invalidateConfigurationCache called but no cache adapter is configured.");
      return;
    }

    try {
      this.logger?.info("invalidating_configuration_cache", { employerAddress });
      // In a more granular implementation, we might delete a specific key for the employer.
      // Here we invalidate the entire configuration namespace.
      await this.cache.clearNamespace(CacheNamespace.CONFIGURATION);
    } catch (error) {
      this.logger?.error("configuration_cache_invalidation_failed", {
        error: error instanceof Error ? redactError(error).message : String(error),
        employerAddress,
      });
      // Clear failure handling: we throw a safe ZkPayrollError if invalidation fails,
      // avoiding leakage of sensitive values.
      throw new PayrollError(
        `Failed to invalidate configuration cache: ${error instanceof Error ? error.message : String(error)}`,
        PayrollServiceErrorCode.UNKNOWN_ERROR // or a more specific code if available
      );
    }
  }

  /**
   * Handle an employer_updated event by invalidating the configuration cache.
   * This provides the authorization/validation point: we only act if the event
   * is a valid EmployerUpdatedEvent.
   */
  async handleEmployerUpdatedEvent(event: EmployerUpdatedEvent): Promise<void> {
    if (event.type !== "employer_updated" || !event.employer) {
      this.logger?.warn("invalid_employer_updated_event", { event });
      return;
    }

    this.logger?.info("handling_employer_updated_event", { employer: event.employer });
    await this.invalidateConfigurationCache(event.employer);
  }

  /**
   * Validates a settlement receipt against the settlement workflow policy (#532).
   *
   * Lightweight operational gate for receipts produced after payroll finalization:
   * checks receipt/payroll identifiers, settled status, transaction reference, and
   * metadata digest shape — without echoing rejected values. Returns an explicit
   * result instead of throwing; the display receipt ID inside the result is
   * redacted, so it is safe for logs and UI feedback.
   */
  validateSettlementReceipt(
    receipt: PayrollReceipt | unknown,
    options?: SettlementReceiptValidationOptions
  ): SettlementReceiptValidation {
    return validateSettlementReceiptHelper(receipt, options);
  }

  /**
   * Static helper: validates a settlement receipt (#532).
   */
  static validateSettlementReceipt(
    receipt: PayrollReceipt | unknown,
    options?: SettlementReceiptValidationOptions
  ): SettlementReceiptValidation {
    return validateSettlementReceiptHelper(receipt, options);
  }

  /**
   * Validates a withholding configuration before it is applied to a payroll
   * run (#519). Returns an explicit result instead of throwing, and never
   * echoes employee identifiers or configured amounts — failure messages carry
   * only stable codes, sanitized text, and redacted identifiers, so they are
   * safe for logs and UI feedback.
   */
  validateWithholdingConfig(
    config: unknown,
    options?: WithholdingConfigValidationOptions
  ): WithholdingConfigValidation {
    return validateWithholdingConfigHelper(config, options);
  }

  /**
   * Static helper: validates a withholding configuration (#519) without a
   * service instance.
   */
  static validateWithholdingConfig(
    config: unknown,
    options?: WithholdingConfigValidationOptions
  ): WithholdingConfigValidation {
    return validateWithholdingConfigHelper(config, options);
  }

  /**
   * Registers the destination validation extension hook (#531) for every
   * payment submitted through {@link PayrollService} in this process.
   *
   * The hook adds organizational destination policy (allowlists, compliance
   * holds, internal account classification) on top of the built-in Stellar
   * destination checks. Pass `undefined` to restore built-in validation.
   * Hooks must never echo the rejected destination in their messages; see
   * {@link DestinationValidationHook} for the required result shape.
   */
  static setDestinationValidationHook(hook?: DestinationValidationHook | null): void {
    setDestinationValidationHook(hook);
  }

  /**
   * Restores the default built-in destination validation, removing any
   * process-wide extension hook registered via
   * {@link PayrollService.setDestinationValidationHook} (#531).
   */
  static resetDestinationValidationHook(): void {
    resetDestinationValidationHook();
  }

  /**
   * Returns the currently registered destination validation extension hook,
   * or `undefined` when built-in validation is active (#531).
   */
  static getDestinationValidationHook(): DestinationValidationHook | undefined {
    return getRegisteredDestinationValidationHook();
  }

  /**
   * Runs the destination validation gate (#531) without submitting a payment:
   * built-in Stellar checks first, then the registered extension hook. Useful
   * for pre-flight checks in UIs and batch tooling. Never throws and never
   * echoes the rejected destination.
   */
  async validateDestination(value: unknown): Promise<DestinationWorkflowValidation> {
    return validatePaymentDestination(value);
  }

  /**
   * Static helper: runs the destination validation gate (#531) without a
   * service instance. Never throws and never echoes the rejected destination.
   */
  static async validateDestination(value: unknown): Promise<DestinationWorkflowValidation> {
    return validatePaymentDestination(value);
  }

  /**
   * Reads the on-chain lock status for a payout recipient (#512).
   *
   * Queries the contract to check whether the recipient is currently locked
   * by an active payroll execution. Returns typed, UI-safe status with
   * masked recipient identifiers and safe defaults on error.
   *
   * @param recipient - Recipient Stellar address or employee identifier
   * @param employer - Employer/company Stellar address
   * @param options - Query options (network, requestId, redact)
   */
  async getRecipientLockStatus(
    recipient: string,
    employer: string,
    options?: Partial<FetchRecipientLockStatusOptions>
  ): Promise<RecipientLockStatus> {
    return fetchRecipientLockStatusHelper(this.contractWrapper, recipient, employer, {
      signer: this.signer,
      network: this.network,
      ...options,
    });
  }

  /**
   * Evaluates whether a recipient is locked across active in-flight payroll executions (#512).
   *
   * @param recipient - Recipient identifier
   * @param activeExecutions - Array of in-flight payroll executions
   * @param options - Evaluation options
   */
  evaluateRecipientLock(
    recipient: string,
    activeExecutions: ActivePayrollExecution[],
    options?: RecipientLockReadOptions
  ): RecipientLockStatus {
    return evaluateRecipientLockStatusHelper(recipient, activeExecutions, options);
  }

  /**
   * Static helper: Evaluates recipient lock status without a service instance (#512).
   */
  static evaluateRecipientLock(
    recipient: string,
    activeExecutions: ActivePayrollExecution[],
    options?: RecipientLockReadOptions
  ): RecipientLockStatus {
    return evaluateRecipientLockStatusHelper(recipient, activeExecutions, options);
  }

  /**
   * Static helper: Evaluates lock statuses for a batch of recipients (#512).
   */
  static evaluateBatchRecipientLock(
    recipients: string[],
    activeExecutions: ActivePayrollExecution[],
    options?: RecipientLockReadOptions
  ): BatchRecipientLockSummary {
    return evaluateBatchRecipientLockStatusHelper(recipients, activeExecutions, options);
  }

  /**
   * Static helper: Formats a recipient lock status into a single human-readable line (#512).
   */
  static formatRecipientLockStatus(status: RecipientLockStatus): string {
    return formatRecipientLockStatusHelper(status);
  }

  /**
   * Static helper: Checks whether a recipient is locked (#512).
   */
  static isRecipientLocked(
    statusOrRecipient: RecipientLockStatus | { isLocked: boolean }
  ): boolean {
    return isRecipientLockedHelper(statusOrRecipient);
  }

  /**
   * Static helper: Checks whether a recipient is clear to receive a payout (#512).
   */
  static canRecipientReceivePayout(
    statusOrRecipient: RecipientLockStatus | { isLocked: boolean; canReceivePayout?: boolean }
  ): boolean {
    return canRecipientReceivePayoutHelper(statusOrRecipient);
  }

  /**
   * Inspects a payroll draft for lock readiness and operational lock state (#537).
   *
   * @param draft - Payroll draft, DraftBuilder, or entry array
   * @param options - Inspection options
   */
  inspectDraftLock(
    draft: unknown,
    options?: DraftLockInspectionOptions
  ): DraftLockInspectionResult {
    return inspectDraftLockHelper(draft, options);
  }

  /**
   * Static helper: Inspects a payroll draft for lock readiness (#537).
   */
  static inspectDraftLock(
    draft: unknown,
    options?: DraftLockInspectionOptions
  ): DraftLockInspectionResult {
    return inspectDraftLockHelper(draft, options);
  }

  /**
   * Asserts that a draft is clear to be locked and submitted, throwing DraftLockError if not (#537).
   */
  assertDraftLockable(draft: unknown, options?: DraftLockInspectionOptions): void {
    assertDraftLockableHelper(draft, options);
  }

  /**
   * Static helper: Asserts that a draft is clear to be locked and submitted (#537).
   */
  static assertDraftLockable(draft: unknown, options?: DraftLockInspectionOptions): void {
    assertDraftLockableHelper(draft, options);
  }
  /**
   * Evaluates an execution payload against all protocol, treasury, proof,
   * recipient, and governance constraints (#605).
   */
  diagnoseBlockedExecution(input: BlockedExecutionInput): BlockedExecutionReport {
    return diagnoseBlockedExecutionHelper(input);
  }

  /**
   * Static helper: Evaluates an execution payload for blocked execution diagnostics (#605).
   */
  static diagnoseBlockedExecution(input: BlockedExecutionInput): BlockedExecutionReport {
    return diagnoseBlockedExecutionHelper(input);
  }

  /**
   * Asserts that execution is not blocked. Throws BlockedExecutionError if blocked (#605).
   */
  assertCanExecute(reportOrInput: BlockedExecutionReport | BlockedExecutionInput): void {
    const report =
      "canExecute" in reportOrInput
        ? (reportOrInput as BlockedExecutionReport)
        : diagnoseBlockedExecutionHelper(reportOrInput as BlockedExecutionInput);
    assertCanExecuteHelper(report);
  }

  /**
   * Static helper: Asserts that execution is not blocked (#605).
   */
  static assertCanExecute(reportOrInput: BlockedExecutionReport | BlockedExecutionInput): void {
    const report =
      "canExecute" in reportOrInput
        ? (reportOrInput as BlockedExecutionReport)
        : diagnoseBlockedExecutionHelper(reportOrInput as BlockedExecutionInput);
    assertCanExecuteHelper(report);
  }
}
