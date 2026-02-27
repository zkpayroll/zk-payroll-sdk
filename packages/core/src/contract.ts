// stellar-sdk imports will be used when contract interactions are implemented
import { ClientConfig } from "./config";

export class PayrollContract {
  constructor(private config: ClientConfig) {}

  async getBalance(_address: string): Promise<bigint> {
    // Implementation placeholder
    return 0n;
  }

  async deposit(_amount: bigint): Promise<string> {
    // Implementation placeholder
    return "tx_hash";
  }
}
