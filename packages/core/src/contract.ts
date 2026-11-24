import { ClientConfig } from "./config";

export class PayrollContract {
  constructor(private readonly config: ClientConfig) {}

  /**
   * Retrieves the payroll balance for a Stellar address.
   *
   * @param address Stellar account address
   * @returns Account balance in stroops or the contract's smallest unit
   */
  async getBalance(address: string): Promise<bigint> {
    this.validateAddress(address);

    // TODO: Implement Stellar contract/account balance query.
    // Use this.config to initialize the appropriate Stellar client.
    throw new Error("Payroll balance retrieval is not yet implemented.");
  }

  /**
   * Deposits funds into the payroll contract.
   *
   * @param amount Amount to deposit in the smallest supported unit
   * @returns Transaction hash
   */
  async deposit(amount: bigint): Promise<string> {
    this.validateAmount(amount);

    // TODO: Implement contract interaction.
    // Build, sign, submit, and verify the Stellar transaction.
    throw new Error("Payroll deposit is not yet implemented.");
  }

  private validateAddress(address: string): void {
    if (!address || typeof address !== "string" || !address.trim()) {
      throw new Error("A valid Stellar address is required.");
    }
  }

  private validateAmount(amount: bigint): void {
    if (typeof amount !== "bigint" || amount <= 0n) {
      throw new Error("Deposit amount must be a positive integer.");
    }
  }
}