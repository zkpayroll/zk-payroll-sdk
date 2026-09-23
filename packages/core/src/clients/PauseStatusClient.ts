import { rpc, xdr, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import type { ClientOptions } from "./types";
import {
  normalizePauseStatus,
  type PauseStatus,
  type RawPauseStatusResponse,
} from "../pause/status";
import type { Keypair } from "@stellar/stellar-sdk";

export class PauseStatusClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  /**
   * Fetch the contract's current pause status and normalize it for UI use.
   * See `normalizePauseStatus` for how missing/unknown categories are handled.
   */
  async getPauseStatus(signer: Keypair | ISigner, network?: string): Promise<PauseStatus> {
    const result = await this.invoke(
      "get_pause_status",
      [],
      toISigner(signer),
      network ?? this.networkPassphrase
    );
    return normalizePauseStatus(this.decodePauseStatusMap(result));
  }

  private decodePauseStatusMap(scVal: xdr.ScVal): RawPauseStatusResponse {
    const map = scVal.map();
    if (!map) return {};

    const entries: RawPauseStatusResponse = {};
    for (const entry of map) {
      const key = entry.key().sym()?.toString();
      if (!key) continue;
      entries[key] = entry.val()?.b() ?? false;
    }
    return entries;
  }
}
