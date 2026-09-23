import {
  rpc,
  Contract,
  Transaction,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  Keypair,
} from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { ContractExecutionError, ContractErrorCode, mapRpcError, RpcTimeoutError } from "../errors";
import { RunIdentifier } from "../core/run-identifier";
import {
  RetryOperationType,
  RetryBudgetExhaustedError,
  RetryCancelledError,
  withRetryBudget,
} from "../core/retry-budget";
import { IdempotencyRegistry } from "../core/idempotency";
import type { RetryBudgetsConfig } from "../config";

/** How long (ms) to wait between transaction status polls */
const POLL_INTERVAL_MS = 2_000;
/** Maximum number of polls before declaring a timeout */
const MAX_POLLS = 15;

/**
 * BaseContractWrapper — Adapters layer
 *
 * Encapsulates the boilerplate required for every Soroban contract call:
 *  1. Build a transaction
 *  2. Simulate to get the resource footprint
 *  3. Re-assemble with the authorisation entries returned by simulation
 *  4. Sign and submit
 *  5. Poll until final status, then return the result value
 *
 * Subclasses only need to call `this.invoke(method, args)` and handle
 * the typed return value — no RPC plumbing required.
 */
export interface InvokeOptions {
  /**
   * Optional idempotency key for transaction submission.
   * Duplicate keys replay the same in-flight/completed submission result.
   */
  idempotencyKey?: string;
}

/**
 * A fully built, simulated, and assembled transaction ready to sign — the
 * deterministic half of a contract invocation. Producing this involves no
 * signing and no broadcast, so it is safe to build (and, if desired, to
 * rebuild from scratch on failure) as many times as needed: it never risks
 * a duplicate submission.
 */
export interface PreparedInvocation {
  method: string;
  requestId: string;
  network: string;
  /** Unsigned transaction, already assembled with simulation's footprint/auth entries. */
  transaction: Transaction;
}

export abstract class BaseContractWrapper {
  protected readonly contract: Contract;
  /** In-memory dedup guard keyed by idempotency key for transaction submission. */
  private readonly submissionIdempotency =
    new IdempotencyRegistry<rpc.Api.SendTransactionResponse>();

  constructor(
    protected readonly server: rpc.Server,
    protected readonly contractId: string,
    /** Optional per-operation retry budgets (read/write/poll). */
    protected readonly retryBudgets?: RetryBudgetsConfig
  ) {
    this.contract = new Contract(contractId);
  }

  /**
   * Build a contract invocation's deterministic payload: load the account,
   * build the transaction, simulate it, and assemble the simulation's
   * footprint/authorisation entries — everything up to (but not including)
   * signing and broadcast.
   *
   * This half of `invoke()` is retry-safe on its own terms: it never signs
   * or submits anything, so calling it again after a failure (or to rebuild
   * with a fresh sequence number before a retried submission) carries none
   * of the double-submission risk that retrying `submitInvocation` would.
   *
   * @param method          - Name of the contract function to call
   * @param args            - XDR-encoded arguments (use `nativeToScVal` from stellar-sdk)
   * @param sourcePublicKey - Public key of the account paying for and authorizing the call
   * @param network         - Stellar network passphrase (defaults to testnet)
   * @param requestId       - Optional explicit request ID for correlation tracing
   * @throws                - `ContractExecutionError` (SIMULATION_FAILED) if simulation fails
   */
  protected async buildInvocation(
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string,
    network: string = Networks.TESTNET,
    requestId?: string
  ): Promise<PreparedInvocation> {
    const reqId = requestId ?? RunIdentifier.generateRequestId(method);

    try {
      // ── 1. Load the source account ─────────────────────────────────────
      const account = await withRetryBudget(() => this.server.getAccount(sourcePublicKey), {
        operationType: RetryOperationType.READ,
        budgets: this.retryBudgets,
      });

      // ── 2. Build the raw transaction ───────────────────────────────────
      const rawTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: network,
      })
        .addOperation(this.contract.call(method, ...args))
        .setTimeout(30)
        .build();

      // ── 3. Simulate to obtain resource footprint + auth entries ────────
      const simResult = await withRetryBudget(() => this.server.simulateTransaction(rawTx), {
        operationType: RetryOperationType.READ,
        budgets: this.retryBudgets,
      });

      if (rpc.Api.isSimulationError(simResult)) {
        throw new ContractExecutionError(
          `Simulation failed for "${method}": ${simResult.error}`,
          ContractErrorCode.SIMULATION_FAILED,
          { requestId: reqId }
        );
      }

      // ── 4. Assemble: attach footprint and authorisation from simulation ─
      const transaction = rpc.assembleTransaction(rawTx, simResult).build();

      return { method, requestId: reqId, network, transaction };
    } catch (err) {
      if (err instanceof ContractExecutionError) throw err;
      if (err instanceof RetryBudgetExhaustedError || err instanceof RetryCancelledError) throw err;
      throw mapRpcError(err, { requestId: reqId });
    }
  }

  /**
   * Sign and submit an already-built `PreparedInvocation`, then poll until
   * the transaction reaches a terminal state.
   *
   * Unsafe: this is the half of `invoke()` that broadcasts a signed
   * transaction. If it fails partway (e.g. the client times out waiting for
   * `sendTransaction`'s response), the server may already have accepted and
   * begun processing the submission — do not blindly retry a call to this
   * method with the same (or a freshly rebuilt) prepared invocation. See
   * docs/RETRY_POLICY.md. Callers that need to retry after a failure here
   * should call `buildInvocation` again for a fresh sequence number and
   * make an explicit, deliberate decision to resubmit.
   *
   * @param prepared - The output of `buildInvocation`
   * @param signer   - Signer that signs the transaction (Keypair or ISigner)
   * @returns        - The decoded XDR result value
   * @throws         - `ContractExecutionError` on submission failure, contract revert, or timeout
   */
  protected async submitInvocation(
    prepared: PreparedInvocation,
    signer: Keypair | ISigner,
    idempotencyKey?: string
  ): Promise<xdr.ScVal> {
    const { method, requestId: reqId, transaction } = prepared;
    const iSigner = toISigner(signer);

    try {
      await iSigner.sign(transaction);

      // Deliberately NOT wrapped in a retry budget -- see the unsafe-write
      // note in this method's doc comment above. Duplicate-operation
      // protection is still enforced: when an idempotency key is supplied,
      // concurrent submissions of the same key share a single in-flight
      // sendTransaction call, so a retry cannot double-submit the same
      // operation to the network.
      const sendResult = await this.submitTransaction(transaction, idempotencyKey);

      if (sendResult.status === "ERROR") {
        throw new ContractExecutionError(
          `Transaction submission failed for "${method}": ${JSON.stringify(
            sendResult.errorResult
          )}`,
          ContractErrorCode.TRANSACTION_SUBMISSION_FAILED,
          { requestId: reqId }
        );
      }

      return await this.pollForResult(sendResult.hash, method, reqId);
    } catch (err) {
      if (err instanceof ContractExecutionError) throw err;
      if (err instanceof RetryBudgetExhaustedError || err instanceof RetryCancelledError) throw err;
      throw mapRpcError(err, { requestId: reqId });
    }
  }

  /**
   * Invoke a contract method end-to-end: `buildInvocation` followed by
   * `submitInvocation`. Generates a deterministic request ID from the
   * method name when none is provided, enabling correlation across the
   * build, submission, and polling steps. Pass an explicit `requestId` or
   * `InvokeOptions` if you need to group operations.
   *
   * Prefer calling `buildInvocation`/`submitInvocation` directly when you
   * need retry-safe control over resubmission (e.g. a payroll batch runner
   * that must not risk double-paying a recipient) — see their doc comments.
   *
   * @param method     - Name of the contract function to call
   * @param args       - XDR-encoded arguments (use `nativeToScVal` from stellar-sdk)
   * @param signer     - Signer that signs the transaction (Keypair or ISigner)
   * @param network    - Stellar network passphrase (defaults to testnet)
   * @param options    - Optional request ID string or InvokeOptions object for correlation tracing.
   * @returns          - The decoded XDR result value
   * @throws           - `ContractExecutionError` on any RPC or contract failure
   */
  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: Keypair | ISigner,
    network: string = Networks.TESTNET,
    options?: string | InvokeOptions
  ): Promise<xdr.ScVal> {
    const requestId = typeof options === "string" ? options : undefined;
    const idempotencyKey = typeof options === "string" ? undefined : options?.idempotencyKey;
    const reqId = requestId ?? RunIdentifier.generateRequestId(method);
    const iSigner = toISigner(signer);

    let pubKey: string;
    try {
      pubKey = await iSigner.getPublicKey();
    } catch (err) {
      if (err instanceof ContractExecutionError) throw err;
      throw mapRpcError(err, { requestId: reqId });
    }

    const prepared = await this.buildInvocation(method, args, pubKey, network, reqId);
    return this.submitInvocation(prepared, iSigner, idempotencyKey);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Broadcast a signed transaction, deduplicating in-flight submissions that
   * share the same idempotency key. Without a key the request is sent as-is.
   */
  private submitTransaction(
    transaction: Transaction,
    idempotencyKey?: string
  ): Promise<rpc.Api.SendTransactionResponse> {
    if (!idempotencyKey?.trim()) {
      return this.server.sendTransaction(transaction);
    }
    return this.submissionIdempotency.execute(
      idempotencyKey,
      () => this.server.sendTransaction(transaction),
      { ttlMs: 0 }
    );
  }

  /**
   * Poll the RPC until the transaction reaches a terminal state.
   * Returns the XDR result value on success; throws on failure or timeout.
   */
  private async pollForResult(
    txHash: string,
    method: string,
    requestId: string
  ): Promise<xdr.ScVal> {
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const statusResult = await withRetryBudget(() => this.server.getTransaction(txHash), {
        operationType: RetryOperationType.POLL,
        budgets: this.retryBudgets,
      });

      if (statusResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        if (!statusResult.returnValue) {
          // Void return — return unit ScVal
          return xdr.ScVal.scvVoid();
        }
        return statusResult.returnValue;
      }

      if (statusResult.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new ContractExecutionError(
          `Contract reverted during "${method}": ${JSON.stringify(statusResult.resultMetaXdr)}`,
          ContractErrorCode.CONTRACT_REVERT,
          { requestId }
        );
      }

      // Status is NOT_FOUND or still pending — keep polling
    }

    throw new RpcTimeoutError(
      `Transaction timed out after ${MAX_POLLS} polls for "${method}" (hash: ${txHash})`,
      { requestId },
      undefined,
      ContractErrorCode.TRANSACTION_TIMEOUT
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
