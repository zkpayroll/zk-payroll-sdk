import {
  rpc,
  xdr,
  nativeToScVal,
  scValToNative,
  Address,
  Keypair,
  Networks,
} from "@stellar/stellar-sdk";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";

function toBytesScVal(value: string): xdr.ScVal {
  // Accept hex strings (with or without 0x) or plain utf8 strings.
  // Stellar SDK nativeToScVal with type "bytes" expects Buffer/Uint8Array.
  try {
    const trimmed = value.replace(/^0x/, "");
    const isHex = /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0;
    const buf = isHex ? Buffer.from(trimmed, "hex") : Buffer.from(value, "utf8");
    return nativeToScVal(buf, { type: "bytes" });
  } catch {
    return nativeToScVal(value, { type: "string" });
  }
}
import {
  ClientOptions,
  CommitmentEntry,
  CommitRequest,
  BatchCommitItem,
  ProofStruct,
} from "./types";

export class SalaryCommitmentClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  async commit(request: CommitRequest, signer: Keypair, network?: string): Promise<void> {
    const args: xdr.ScVal[] = [
      new Address(request.employer).toScVal(),
      new Address(request.employee).toScVal(),
      toBytesScVal(request.commitmentHash),
      nativeToScVal(request.cycleId, { type: "u64" }),
    ];

    await this.invoke("commit", args, signer, network ?? this.networkPassphrase);
  }

  async getCommitment(
    employer: string,
    employee: string,
    cycleId: bigint,
    signer: Keypair,
    network?: string
  ): Promise<CommitmentEntry> {
    const args: xdr.ScVal[] = [
      new Address(employer).toScVal(),
      new Address(employee).toScVal(),
      nativeToScVal(cycleId, { type: "u64" }),
    ];

    const result = await this.invoke(
      "get_commitment",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return this.decodeCommitmentEntry(result);
  }

  async batchCommit(
    employer: string,
    commitments: BatchCommitItem[],
    signer: Keypair,
    network?: string
  ): Promise<void> {
    const commitVec = xdr.ScVal.scvVec(
      commitments.map((item) =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal("employee", { type: "symbol" }),
            val: new Address(item.employee).toScVal(),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("commitment_hash", { type: "symbol" }),
            val: toBytesScVal(item.commitmentHash),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("cycle_id", { type: "symbol" }),
            val: nativeToScVal(item.cycleId, { type: "u64" }),
          }),
        ])
      )
    );

    const args: xdr.ScVal[] = [new Address(employer).toScVal(), commitVec];

    await this.invoke("batch_commit", args, signer, network ?? this.networkPassphrase);
  }

  async verifyCommitment(
    employer: string,
    employee: string,
    cycleId: bigint,
    proof: ProofStruct,
    signer: Keypair,
    network?: string
  ): Promise<boolean> {
    const args: xdr.ScVal[] = [
      new Address(employer).toScVal(),
      new Address(employee).toScVal(),
      nativeToScVal(cycleId, { type: "u64" }),
      this.encodeProofStruct(proof),
    ];

    const result = await this.invoke(
      "verify_commitment",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return result.b() === true;
  }

  async revealSalary(
    employer: string,
    employee: string,
    cycleId: bigint,
    actualAmount: bigint,
    signer: Keypair,
    network?: string
  ): Promise<void> {
    const args: xdr.ScVal[] = [
      new Address(employer).toScVal(),
      new Address(employee).toScVal(),
      nativeToScVal(cycleId, { type: "u64" }),
      nativeToScVal(actualAmount, { type: "i128" }),
    ];

    await this.invoke("reveal_salary", args, signer, network ?? this.networkPassphrase);
  }

  async getCommitmentCount(
    employer: string,
    employee: string,
    signer: Keypair,
    network?: string
  ): Promise<number> {
    const args: xdr.ScVal[] = [new Address(employer).toScVal(), new Address(employee).toScVal()];

    const result = await this.invoke(
      "get_commitment_count",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return Number(result.u32());
  }

  private decodeCommitmentEntry(scVal: xdr.ScVal): CommitmentEntry {
    const map = scVal.map();
    if (!map) {
      throw new Error("Expected scvMap for CommitmentEntry");
    }

    const entries: Record<string, xdr.ScVal> = {};
    for (const entry of map) {
      const key = entry.key().sym()?.toString() ?? "";
      entries[key] = entry.val();
    }

    return {
      employer: Address.fromScVal(entries.employer).toString(),
      employee: Address.fromScVal(entries.employee).toString(),
      commitmentHash: this.scValToHex(entries.commitment_hash),
      cycleId: this.scValToBigInt(entries.cycle_id),
      createdAt: Number(this.scValToBigInt(entries.created_at)),
      revealed: entries.revealed?.b() ?? false,
      actualAmount: this.scValToBigInt(entries.actual_amount),
    };
  }

  protected encodeProofStruct(proof: ProofStruct): xdr.ScVal {
    const piA = xdr.ScVal.scvVec(proof.pi_a.map((s) => nativeToScVal(s, { type: "string" })));
    const piB = xdr.ScVal.scvVec(
      proof.pi_b.map((pair) =>
        xdr.ScVal.scvVec(pair.map((s) => nativeToScVal(s, { type: "string" })))
      )
    );
    const piC = xdr.ScVal.scvVec(proof.pi_c.map((s) => nativeToScVal(s, { type: "string" })));
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

  private scValToHex(scVal: xdr.ScVal): string {
    const bytes = scVal.bytes();
    if (bytes) return Buffer.from(bytes).toString("hex");
    return "";
  }

  private scValToBigInt(scVal: xdr.ScVal): bigint {
    try {
      const native = scValToNative(scVal);
      if (typeof native === "bigint") return native;
      if (typeof native === "number") return BigInt(native);
      if (typeof native === "string") {
        try {
          return BigInt(native);
        } catch {
          return 0n;
        }
      }
    } catch {}
    try {
      const i128 = scVal.i128();
      if (i128) {
        const hi = BigInt((i128.hi() as unknown as { toString: () => string }).toString());
        const lo = BigInt((i128.lo() as unknown as { toString: () => string }).toString());
        return (hi << 64n) | lo;
      }
    } catch {}
    try {
      const u64 = scVal.u64();
      if (u64) {
        return BigInt((u64 as unknown as { toString: () => string }).toString());
      }
    } catch {}
    return 0n;
  }
}
