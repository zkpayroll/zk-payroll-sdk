import {
  rpc,
  xdr,
  nativeToScVal,
  Address,
  Keypair,
  Networks,
} from "@stellar/stellar-sdk";
import { BaseContractWrapper } from "./BaseContractWrapper";
import { ProofPayload } from "../crypto/IProofGenerator";

/**
 * PayrollContractWrapper — Concrete adapter for the ZK Payroll Soroban contract.
 *
 * Translates typed payroll method calls into XDR-encoded contract invocations
 * via the BaseContractWrapper.invoke() pipeline.
 */
export class PayrollContractWrapper extends BaseContractWrapper {
  constructor(server: rpc.Server, contractId: string) {
    super(server, contractId);
  }

  /**
   * Invoke the contract's `private_pay` method with a ZK proof and payment details.
   *
   * @param recipient - Stellar address of the payment recipient
   * @param amount    - Payment amount in stroops (i128)
   * @param asset     - Asset identifier ("native" for XLM or a Soroban token contract address)
   * @param proof     - ZK proof payload from IProofGenerator
   * @param signer    - Keypair that signs the transaction
   * @param network   - Network passphrase (defaults to TESTNET)
   * @returns The decoded XDR result value from the contract
   */
  async privatePay(
    recipient: string,
    amount: bigint,
    asset: string,
    proof: ProofPayload,
    signer: Keypair,
    network: string = Networks.TESTNET
  ): Promise<xdr.ScVal> {
    const args: xdr.ScVal[] = [
      new Address(recipient).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
      nativeToScVal(asset, { type: "symbol" }),
      this.encodeProof(proof),
    ];

    return this.invoke("private_pay", args, signer, network);
  }

  /**
   * Query the contract's `get_balance` method.
   *
   * @param address - Stellar address to query
   * @param signer  - Keypair that signs the query transaction
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns The XDR-encoded balance value
   */
  async getBalance(
    address: string,
    signer: Keypair,
    network: string = Networks.TESTNET
  ): Promise<xdr.ScVal> {
    const args: xdr.ScVal[] = [new Address(address).toScVal()];
    return this.invoke("get_balance", args, signer, network);
  }

  /**
   * Encode a ProofPayload into an XDR ScVal map for the contract verifier.
   */
  private encodeProof(proof: ProofPayload): xdr.ScVal {
    const piA = xdr.ScVal.scvVec(
      proof.proof.pi_a.map((s) => nativeToScVal(s, { type: "string" }))
    );
    const piB = xdr.ScVal.scvVec(
      proof.proof.pi_b.map((pair) =>
        xdr.ScVal.scvVec(
          pair.map((s) => nativeToScVal(s, { type: "string" }))
        )
      )
    );
    const piC = xdr.ScVal.scvVec(
      proof.proof.pi_c.map((s) => nativeToScVal(s, { type: "string" }))
    );
    const publicSignals = xdr.ScVal.scvVec(
      proof.publicSignals.map((s) => nativeToScVal(s, { type: "string" }))
    );

    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: nativeToScVal("pi_a", { type: "symbol" }),
        val: piA,
      }),
      new xdr.ScMapEntry({
        key: nativeToScVal("pi_b", { type: "symbol" }),
        val: piB,
      }),
      new xdr.ScMapEntry({
        key: nativeToScVal("pi_c", { type: "symbol" }),
        val: piC,
      }),
      new xdr.ScMapEntry({
        key: nativeToScVal("public_signals", { type: "symbol" }),
        val: publicSignals,
      }),
    ]);
  }
}
