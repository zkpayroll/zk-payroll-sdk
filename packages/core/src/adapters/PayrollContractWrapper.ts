import { rpc, xdr, nativeToScVal, Address, Keypair, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper, InvokeOptions, PreparedInvocation } from "./BaseContractWrapper";
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
   * @param signer    - Signer or Keypair that signs the transaction
   * @param network   - Network passphrase (defaults to TESTNET)
   * @returns The decoded XDR result value from the contract
   */
  async privatePay(
    recipient: string,
    amount: bigint,
    asset: string,
    proof: ProofPayload,
    signer: Keypair | ISigner,
    network: string = Networks.TESTNET,
    options?: InvokeOptions
  ): Promise<xdr.ScVal> {
    const args = this.encodePrivatePayArgs(recipient, amount, asset, proof);
    return this.invoke("private_pay", args, toISigner(signer), network, options);
  }

  /**
   * Build (but do not sign or submit) a `private_pay` invocation: the
   * deterministic half of a payroll submission — loading the account,
   * building and simulating the transaction, and assembling it with the
   * simulation's authorisation entries. Producing this never touches
   * signing or broadcast, so it is safe to call again (e.g. to rebuild
   * with a fresh sequence number) without any duplicate-submission risk.
   *
   * Pair with `submitPrivatePayInvocation` to sign and broadcast when
   * you're ready, or to make an explicit, deliberate resubmission decision
   * after a submission failure rather than blindly retrying.
   *
   * @param recipient        - Stellar address of the payment recipient
   * @param amount           - Payment amount in stroops (i128)
   * @param asset            - Asset identifier ("native" for XLM or a Soroban token contract address)
   * @param proof            - ZK proof payload from IProofGenerator
   * @param sourcePublicKey  - Public key of the account paying for and authorizing the payment
   * @param network          - Network passphrase (defaults to TESTNET)
   * @param requestId        - Optional explicit request ID for correlation tracing
   */
  async buildPrivatePayInvocation(
    recipient: string,
    amount: bigint,
    asset: string,
    proof: ProofPayload,
    sourcePublicKey: string,
    network: string = Networks.TESTNET,
    requestId?: string
  ): Promise<PreparedInvocation> {
    const args = this.encodePrivatePayArgs(recipient, amount, asset, proof);
    return this.buildInvocation("private_pay", args, sourcePublicKey, network, requestId);
  }

  /**
   * Sign and submit a `private_pay` invocation previously built with
   * `buildPrivatePayInvocation`, then poll until it reaches a terminal
   * state.
   *
   * Unsafe: broadcasts a signed transaction. Do not blindly retry a failed
   * call to this method — see `buildPrivatePayInvocation`'s doc comment and
   * docs/RETRY_POLICY.md.
   *
   * @param prepared - The output of `buildPrivatePayInvocation`
   * @param signer   - Signer or Keypair that signs the transaction
   * @returns        - The decoded XDR result value from the contract
   */
  async submitPrivatePayInvocation(
    prepared: PreparedInvocation,
    signer: Keypair | ISigner
  ): Promise<xdr.ScVal> {
    return this.submitInvocation(prepared, toISigner(signer));
  }

  /**
   * Query the contract's `get_balance` method.
   *
   * @param address - Stellar address to query
   * @param signer  - Signer or Keypair that signs the query transaction
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns The XDR-encoded balance value
   */
  async getBalance(
    address: string,
    signer: Keypair | ISigner,
    network: string = Networks.TESTNET
  ): Promise<xdr.ScVal> {
    const args: xdr.ScVal[] = [new Address(address).toScVal()];
    return this.invoke("get_balance", args, toISigner(signer), network);
  }

  /**
   * Encode `private_pay`'s argument list (shared by `privatePay` and
   * `buildPrivatePayInvocation` so both stay in sync).
   */
  private encodePrivatePayArgs(
    recipient: string,
    amount: bigint,
    asset: string,
    proof: ProofPayload
  ): xdr.ScVal[] {
    return [
      new Address(recipient).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
      nativeToScVal(asset, { type: "symbol" }),
      this.encodeProof(proof),
    ];
  }

  /**
   * Encode a ProofPayload into an XDR ScVal map for the contract verifier.
   */
  protected encodeProof(proof: ProofPayload): xdr.ScVal {
    const piA = xdr.ScVal.scvVec(proof.proof.pi_a.map((s) => nativeToScVal(s, { type: "string" })));
    const piB = xdr.ScVal.scvVec(
      proof.proof.pi_b.map((pair) =>
        xdr.ScVal.scvVec(pair.map((s) => nativeToScVal(s, { type: "string" })))
      )
    );
    const piC = xdr.ScVal.scvVec(proof.proof.pi_c.map((s) => nativeToScVal(s, { type: "string" })));
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
