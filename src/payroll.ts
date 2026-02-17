import { PayrollContract } from "./contract";
import { ZKProofGenerator } from "./crypto/proofs";

export class PayrollService {
  constructor(private contract: PayrollContract) {}

  async processPayment(recipient: string, amount: bigint) {
    const proof = await ZKProofGenerator.generateProof({ recipient, amount });
    return this.contract.deposit(amount);
  }

  filterTransactions(transactions: any[], criteria: any) {
    return transactions.filter((t) => t.amount > criteria.minAmount);
  }
}
