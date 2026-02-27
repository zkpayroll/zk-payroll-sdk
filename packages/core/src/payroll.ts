import { Keypair, Networks } from "@stellar/stellar-sdk";
import { PayrollContractWrapper } from "./adapters/PayrollContractWrapper";
import { IProofGenerator, ProofPayload } from "./crypto/IProofGenerator";
import { PayrollError, PayrollServiceErrorCode } from "./errors";
import { PaymentParams, PaymentResult } from "./types";

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
 */
export class PayrollService {
  constructor(
    private readonly contractWrapper: PayrollContractWrapper,
    private readonly proofGenerator: IProofGenerator,
    private readonly signer: Keypair,
    private readonly network: string = Networks.TESTNET
  ) {}

  /**
   * Process a private payment by generating a ZK proof and submitting
   * the transaction to the Soroban contract.
   *
   * Orchestration flow:
   *   1. Validate input parameters
   *   2. Generate ZK proof for the payment witness
   *   3. Invoke the contract's private_pay method via the wrapper
   *   4. Return the transaction result
   *
   * @param params - Payment parameters { recipient, amount, asset }
   * @returns Promise resolving to the payment result
   */
  async processPayment(params: PaymentParams): Promise<PaymentResult> {
    const { recipient, amount, asset } = params;

    // 1. Validate inputs
    this.validatePaymentParams(params);

    // 2. Generate ZK proof
    const witness: Record<string, unknown> = {
      recipient,
      amount: amount.toString(),
      asset,
    };

    let proof: ProofPayload;
    try {
      proof = await this.proofGenerator.generateProof(witness);
    } catch (error) {
      if (error instanceof PayrollError) throw error;
      throw new PayrollError(
        `Proof generation failed: ${error instanceof Error ? error.message : String(error)}`,
        PayrollServiceErrorCode.PROOF_GENERATION_FAILED
      );
    }

    // 3. Invoke contract
    const resultXdr = await this.contractWrapper.privatePay(
      recipient,
      amount,
      asset,
      proof,
      this.signer,
      this.network
    );

    // 4. Return structured result
    return {
      txHash: resultXdr.toXDR("hex"),
      publicSignals: proof.publicSignals,
    };
  }

  /**
   * Filter transactions by criteria (preserved from existing API).
   */
  filterTransactions(
    transactions: Transaction[],
    criteria: FilterCriteria
  ): Transaction[] {
    return transactions.filter((t) => t.amount > criteria.minAmount);
  }

  private validatePaymentParams(params: PaymentParams): void {
    if (!params.recipient || params.recipient.trim() === "") {
      throw new PayrollError(
        "Recipient address is required",
        PayrollServiceErrorCode.INVALID_RECIPIENT
      );
    }
    if (params.amount <= 0n) {
      throw new PayrollError(
        "Amount must be a positive value",
        PayrollServiceErrorCode.INVALID_AMOUNT
      );
    }
    if (!params.asset || params.asset.trim() === "") {
      throw new PayrollError(
        "Asset identifier is required",
        PayrollServiceErrorCode.INVALID_ASSET
      );
    }
  }
}
