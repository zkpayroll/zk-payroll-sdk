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
import { ClientOptions, RegistryEntry, RegisterRequest, UpdateRegistryRequest } from "./types";

export class PayrollRegistryClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  async register(request: RegisterRequest, signer: Keypair, network?: string): Promise<void> {
    const args: xdr.ScVal[] = [
      new Address(request.employer).toScVal(),
      new Address(request.employee).toScVal(),
      nativeToScVal(request.salary, { type: "i128" }),
      new Address(request.token).toScVal(),
      nativeToScVal(request.metadata ?? "", { type: "string" }),
    ];

    await this.invoke("register", args, signer, network ?? this.networkPassphrase);
  }

  async getRegistry(
    employer: string,
    employee: string,
    signer: Keypair,
    network?: string
  ): Promise<RegistryEntry> {
    const args: xdr.ScVal[] = [new Address(employer).toScVal(), new Address(employee).toScVal()];

    const result = await this.invoke(
      "get_registry",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return this.decodeRegistryEntry(result);
  }

  async updateRegistry(
    request: UpdateRegistryRequest,
    signer: Keypair,
    network?: string
  ): Promise<void> {
    const args: xdr.ScVal[] = [
      new Address(request.employer).toScVal(),
      new Address(request.employee).toScVal(),
      nativeToScVal(request.salary, { type: "i128" }),
    ];

    await this.invoke("update_registry", args, signer, network ?? this.networkPassphrase);
  }

  async deactivateRegistry(
    employer: string,
    employee: string,
    signer: Keypair,
    network?: string
  ): Promise<void> {
    const args: xdr.ScVal[] = [new Address(employer).toScVal(), new Address(employee).toScVal()];

    await this.invoke("deactivate_registry", args, signer, network ?? this.networkPassphrase);
  }

  async getEmployeeCount(employer: string, signer: Keypair, network?: string): Promise<number> {
    const args: xdr.ScVal[] = [new Address(employer).toScVal()];
    const result = await this.invoke(
      "get_employee_count",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return Number(result.u32());
  }

  async getEmployees(
    employer: string,
    start: number,
    limit: number,
    signer: Keypair,
    network?: string
  ): Promise<string[]> {
    const args: xdr.ScVal[] = [
      new Address(employer).toScVal(),
      nativeToScVal(start, { type: "u32" }),
      nativeToScVal(limit, { type: "u32" }),
    ];

    const result = await this.invoke(
      "get_employees",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return this.decodeAddressVec(result);
  }

  async registryExists(
    employer: string,
    employee: string,
    signer: Keypair,
    network?: string
  ): Promise<boolean> {
    const args: xdr.ScVal[] = [new Address(employer).toScVal(), new Address(employee).toScVal()];

    const result = await this.invoke(
      "registry_exists",
      args,
      signer,
      network ?? this.networkPassphrase
    );
    return result.b() === true;
  }

  private decodeRegistryEntry(scVal: xdr.ScVal): RegistryEntry {
    const map = scVal.map();
    if (!map) {
      throw new Error("Expected scvMap for RegistryEntry");
    }

    const entries: Record<string, xdr.ScVal> = {};
    for (const entry of map) {
      const key = entry.key().sym()?.toString() ?? "";
      entries[key] = entry.val();
    }

    return {
      employer: Address.fromScVal(entries.employer).toString(),
      employee: Address.fromScVal(entries.employee).toString(),
      salary: this.scValToBigInt(entries.salary),
      token: Address.fromScVal(entries.token).toString(),
      metadata: entries.metadata?.str()?.toString() ?? "",
      active: entries.active?.b() ?? false,
      createdAt: Number(this.scValToBigInt(entries.created_at)),
      updatedAt: Number(this.scValToBigInt(entries.updated_at)),
    };
  }

  private decodeAddressVec(scVal: xdr.ScVal): string[] {
    const vec = scVal.vec();
    if (!vec) return [];
    return vec.map((v) => Address.fromScVal(v).toString());
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
