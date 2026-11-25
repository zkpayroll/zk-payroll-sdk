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

/** Default time-to-live for the cached pause state, in milliseconds. */
export const DEFAULT_PAUSE_STATE_TTL_MS = 30_000;

/**
 * Error thrown when the pause status cannot be fetched. The message is
 * intentionally generic so that raw RPC responses (which may contain
 * payroll or employee data) are never surfaced to callers.
 */
export class PauseStatusError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "PauseStatusError";
    if (options && "cause" in options) {
      // Preserve the cause for local debugging without exposing it in `message`.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

interface PauseStateCacheEntry {
  status: PauseStatus;
  fetchedAt: number;
}

export class PauseStatusClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;
  private readonly pauseStateTtlMs: number;
  private pauseStateCache?: PauseStateCacheEntry;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
    const ttl = options?.pauseStateTtlMs;
    this.pauseStateTtlMs =
      typeof ttl === "number" && Number.isFinite(ttl) && ttl >= 0
        ? ttl
        : DEFAULT_PAUSE_STATE_TTL_MS;
  }

  /**
   * Fetch the contract's current pause status and normalize it for UI use.
   * See `normalizePauseStatus` for how missing/unknown categories are handled.
   *
   * The result is cached for `pauseStateTtlMs`. Long-lived audit sessions
   * should call {@link refreshPauseState} (or {@link getPauseStatusFresh}) to
   * force a re-fetch when the cached value may be stale.
   */
  async getPauseStatus(signer: Keypair | ISigner, network?: string): Promise<PauseStatus> {
    const cached = this.pauseStateCache;
    if (cached && Date.now() - cached.fetchedAt < this.pauseStateTtlMs) {
      return cached.status;
    }
    return this.refreshPauseState(signer, network);
  }

  /**
   * Always re-fetch the pause status from the contract and update the cache.
   * Use this in long-lived audit sessions to guarantee fresh state.
   */
  async refreshPauseState(
    signer: Keypair | ISigner,
    network?: string
  ): Promise<PauseStatus> {
    let result: xdr.ScVal;
    try {
      result = await this.invoke(
        "get_pause_status",
        [],
        toISigner(signer),
        network ?? this.networkPassphrase
      );
    } catch (err) {
      throw new PauseStatusError(
        "Unable to fetch pause status from the contract. Please retry; if the problem persists, contact support.",
        { cause: err }
      );
    }

    let status: PauseStatus;
    try {
      status = normalizePauseStatus(this.decodePauseStatusMap(result));
    } catch (err) {
      throw new PauseStatusError(
        "Received an unexpected pause status response from the contract.",
        { cause: err }
      );
    }

    this.pauseStateCache = { status, fetchedAt: Date.now() };
    return status;
  }

  /**
   * Bypass the cache and always fetch a fresh pause status.
   * Alias for {@link refreshPauseState}.
   */
  async getPauseStatusFresh(
    signer: Keypair | ISigner,
    network?: string
  ): Promise<PauseStatus> {
    return this.refreshPauseState(signer, network);
  }

  /**
   * Clear the cached pause state so the next `getPauseStatus` call re-fetches.
   */
  invalidatePauseState(): void {
    this.pauseStateCache = undefined;
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
