import { rpc, xdr, nativeToScVal, Address, Keypair, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import {
  ClientOptions,
  CommitmentEntry,
  CommitRequest,
  BatchCommitItem,
  ProofStruct,
} from "./types";

import { BatchValidationFailedError, BatchValidationError } from "../batch/BatchPayloadBuilder";

export class SalaryCommitmentClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  async commit(request: CommitRequest, signer: Keypair, network?: string): Promise<void> {
    const hash = request.commitmentHash;
    const isHex = typeof hash === "string" && /^[0-9a-fA-F]+$/.test(hash) && hash.length % 2 === 0;
    const commitmentHashBuf = isHex
      ? Buffer.from(hash as string, "hex")
      : typeof hash === "string"
        ? Buffer.from(hash, "utf-8")
        : hash;

    const args: xdr.ScVal[] = [
      new Address(request.employer).toScVal(),
      new Address(request.employee).toScVal(),
      nativeToScVal(new Uint8Array(commitmentHashBuf), { type: "bytes" }),
      nativeToScVal(request.cycleId, { type: "u64" }),
    ];

    await this.invoke("commit", args, toISigner(signer), network ?? this.networkPassphrase);
  }

  async getCommitment(
    employer: string,
    employee: string,
    cycleId: bigint,
    signer: Keypair | ISigner,
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
      toISigner(signer),
      network ?? this.networkPassphrase
    );
    return this.decodeCommitmentEntry(result);
  }

  async batchCommit(
    employer: string,
    commitments: BatchCommitItem[],
    signer: Keypair | ISigner,
    network?: string
  ): Promise<void> {
    const errors: BatchValidationError[] = [];
    if (!commitments || commitments.length === 0) {
      errors.push({
        code: "EMPTY_BATCH",
        message: "Batch commitments array cannot be empty",
        field: "commitments",
      });
      throw new BatchValidationFailedError(errors);
    }

    const seenEmployees = new Map<string, number>();
    for (let i = 0; i < commitments.length; i++) {
      const item = commitments[i];
      if (!item.employee || item.employee.trim() === "") {
        errors.push({
          code: "INVALID_RECIPIENT",
          message: "Employee address is required",
          field: "employee",
          index: i,
        });
      } else {
        const prevIdx = seenEmployees.get(item.employee);
        if (prevIdx !== undefined) {
          errors.push({
            code: "DUPLICATE_RECIPIENT",
            message: `Duplicate employee recipient at indices ${prevIdx} and ${i}`,
            field: "employee",
            index: i,
          });
        } else {
          seenEmployees.set(item.employee, i);
        }
      }
    }

    if (errors.length > 0) {
      throw new BatchValidationFailedError(errors);
    }
    const commitVec = xdr.ScVal.scvVec(
      commitments.map((item) => {
        const hash = item.commitmentHash;
        const isHex =
          typeof hash === "string" && /^[0-9a-fA-F]+$/.test(hash) && hash.length % 2 === 0;
        const commitmentHashBuf = isHex
          ? Buffer.from(hash as string, "hex")
          : typeof hash === "string"
            ? Buffer.from(hash, "utf-8")
            : hash;

        return xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal("employee", { type: "symbol" }),
            val: new Address(item.employee).toScVal(),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("commitment_hash", { type: "symbol" }),
            val: nativeToScVal(new Uint8Array(commitmentHashBuf), { type: "bytes" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("cycle_id", { type: "symbol" }),
            val: nativeToScVal(item.cycleId, { type: "u64" }),
          }),
        ]);
      })
    );

    const args: xdr.ScVal[] = [new Address(employer).toScVal(), commitVec];

    await this.invoke("batch_commit", args, toISigner(signer), network ?? this.networkPassphrase);
  }

  async verifyCommitment(
    employer: string,
    employee: string,
    cycleId: bigint,
    proof: ProofStruct,
    signer: Keypair | ISigner,
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
      toISigner(signer),
      network ?? this.networkPassphrase
    );
    return result.b() === true;
  }

  async revealSalary(
    employer: string,
    employee: string,
    cycleId: bigint,
    actualAmount: bigint,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<void> {
    const args: xdr.ScVal[] = [
      new Address(employer).toScVal(),
      new Address(employee).toScVal(),
      nativeToScVal(cycleId, { type: "u64" }),
      nativeToScVal(actualAmount, { type: "i128" }),
    ];

    await this.invoke("reveal_salary", args, toISigner(signer), network ?? this.networkPassphrase);
  }

  async getCommitmentCount(
    employer: string,
    employee: string,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<number> {
    const args: xdr.ScVal[] = [new Address(employer).toScVal(), new Address(employee).toScVal()];

    const result = await this.invoke(
      "get_commitment_count",
      args,
      toISigner(signer),
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
    const swName = scVal.switch().name;
    if (swName === "scvI128") {
      const i128 = scVal.i128();
      const hi = BigInt(i128.hi().toString());
      const lo = BigInt(i128.lo().toString());
      return (hi << 64n) | lo;
    }
    if (swName === "scvU64") {
      const u64 = scVal.u64();
      return BigInt(u64.toString());
    }
    return 0n;
  }
}
