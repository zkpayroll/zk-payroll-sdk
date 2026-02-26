import {
  rpc,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  Keypair,
} from "@stellar/stellar-sdk";
import { ContractExecutionError, mapRpcError } from "../errors";

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
export abstract class BaseContractWrapper {
  protected readonly contract: Contract;

  constructor(
    protected readonly server: rpc.Server,
    protected readonly contractId: string
  ) {
    this.contract = new Contract(contractId);
  }

  /**
   * Invoke a contract method end-to-end.
   *
   * @param method   - Name of the contract function to call
   * @param args     - XDR-encoded arguments (use `nativeToScVal` from stellar-sdk)
   * @param signer   - Keypair that signs the transaction
   * @param network  - Stellar network passphrase (defaults to testnet)
   * @returns        - The decoded XDR result value
   * @throws         - `ContractExecutionError` on any RPC or contract failure
   */
  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: Keypair,
    network: string = Networks.TESTNET
  ): Promise<xdr.ScVal> {
    try {
      // ── 1. Load the source account ─────────────────────────────────────
      const account = await this.server.getAccount(signer.publicKey());

      // ── 2. Build the raw transaction ───────────────────────────────────
      const rawTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: network,
      })
        .addOperation(this.contract.call(method, ...args))
        .setTimeout(30)
        .build();

      // ── 3. Simulate to obtain resource footprint + auth entries ────────
      const simResult = await this.server.simulateTransaction(rawTx);

      if (rpc.Api.isSimulationError(simResult)) {
        throw new ContractExecutionError(
          `Simulation failed for "${method}": ${simResult.error}`,
          1001 // ContractErrorCode.SIMULATION_FAILED
        );
      }

      // ── 4. Assemble: attach footprint and authorisation from simulation ─
      const preparedTx = rpc.assembleTransaction(rawTx, simResult).build();

      preparedTx.sign(signer);

      // ── 5. Submit ──────────────────────────────────────────────────────
      const sendResult = await this.server.sendTransaction(preparedTx);

      if (sendResult.status === "ERROR") {
        throw new ContractExecutionError(
          `Transaction submission failed for "${method}": ${JSON.stringify(
            sendResult.errorResult
          )}`,
          1002 // ContractErrorCode.TRANSACTION_SUBMISSION_FAILED
        );
      }

      // ── 6. Poll for final status ───────────────────────────────────────
      return await this.pollForResult(sendResult.hash, method);
    } catch (err) {
      // Re-throw already-typed errors, map everything else
      if (err instanceof ContractExecutionError) throw err;
      throw mapRpcError(err);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Poll the RPC until the transaction reaches a terminal state.
   * Returns the XDR result value on success; throws on failure or timeout.
   */
  private async pollForResult(txHash: string, method: string): Promise<xdr.ScVal> {
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const statusResult = await this.server.getTransaction(txHash);

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
          1005 // ContractErrorCode.CONTRACT_REVERT
        );
      }

      // Status is NOT_FOUND or still pending — keep polling
    }

    throw new ContractExecutionError(
      `Transaction timed out after ${MAX_POLLS} polls for "${method}" (hash: ${txHash})`,
      1003 // ContractErrorCode.TRANSACTION_TIMEOUT
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
