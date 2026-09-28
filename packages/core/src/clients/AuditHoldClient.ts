import { rpc, xdr, nativeToScVal, Keypair, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import { ClientOptions } from "./types";
import { ContractExecutionError, ContractErrorCode } from "../errors";
import {
  assertValidReleaseAuthorization,
  buildReleaseHoldRequest,
  parseHoldStatus,
  explainHold,
  type ComplianceHold,
  type ReleaseHoldRequest,
} from "../compliance";

/** Response for a successful hold release. */
export interface ReleaseAuditHoldResponse {
  /** Id of the hold that was released. */
  holdId: string;
  /** State reported by the contract after the release (note stripped for safe rendering). */
  hold: ComplianceHold;
  /** Dashboards-safe explanation of the post-release state (no notes, no amounts). */
  explanation: string;
}

/**
 * Typed client for the audit / compliance hold contract methods.
 *
 * Assumes the contract exposes:
 * - `get_audit_hold_status(hold_id)` → hold status struct
 * - `release_audit_hold(hold_id, released_by, authorization_token, release_reason?)` → updated hold struct
 *
 * Release authorization is validated locally (via the #320 compliance
 * helpers) before any network call is made, so malformed releases fail
 * fast without broadcasting a transaction. The raw `authorizationToken`
 * is never included in thrown errors or returned objects.
 */
export class AuditHoldClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  /**
   * Fetches and parses the current status of a hold.
   *
   * Malformed or incomplete contract responses are parsed to
   * `state: "unknown"` by {@link parseHoldStatus} (never `active` or
   * `released`), so callers fail closed rather than paying out under an
   * indeterminate hold.
   *
   * @param holdId   - Id of the hold to query.
   * @param signer   - Keypair or ISigner to sign the contract query.
   * @param network  - Optional network passphrase override.
   * @returns A normalized {@link ComplianceHold}.
   * @throws {ContractExecutionError} When the query fails or the response
   *   cannot be decoded.
   */
  async getAuditHoldStatus(
    holdId: string,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<ComplianceHold> {
    if (typeof holdId !== "string" || holdId.trim() === "") {
      throw new ContractExecutionError(
        "holdId is required to query an audit hold status.",
        ContractErrorCode.INVALID_RESPONSE,
        {}
      );
    }

    const args: xdr.ScVal[] = [nativeToScVal(holdId, { type: "string" })];
    const result = await this.invoke(
      "get_audit_hold_status",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    return this.decodeHold(result);
  }

  /**
   * Releases an audit hold after validating the release authorization.
   *
   * Validation runs locally before any network call: a missing/malformed
   * `holdId`, `releasedBy`, or `authorizationToken` throws a
   * {@link HoldReleaseAuthorizationError} without broadcasting a
   * transaction and without ever echoing the token value into the error
   * context.
   *
   * @param request  - Release request (hold id, releasing party, authorization token).
   * @param signer   - Keypair or ISigner to sign the release transaction.
   * @param network  - Optional network passphrase override.
   * @returns The released hold's id, normalized post-release state (with the
   *   free-text `note` stripped), and a dashboards-safe explanation.
   * @throws {HoldReleaseAuthorizationError} When release authorization inputs are invalid.
   * @throws {ContractExecutionError} When the contract call fails.
   */
  async releaseAuditHold(
    request: ReleaseHoldRequest,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<ReleaseAuditHoldResponse> {
    // Local, pre-flight authorization validation. Fails fast and never
    // surfaces the raw authorization token in the thrown error.
    assertValidReleaseAuthorization(request);
    const normalized = buildReleaseHoldRequest(request);

    const args: xdr.ScVal[] = [
      nativeToScVal(normalized.holdId, { type: "string" }),
      nativeToScVal(normalized.releasedBy, { type: "string" }),
      nativeToScVal(normalized.authorizationToken, { type: "string" }),
    ];

    if (normalized.releaseReason !== undefined) {
      args.push(nativeToScVal(normalized.releaseReason, { type: "string" }));
    }

    const result = await this.invoke(
      "release_audit_hold",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    const hold = this.decodeHold(result);

    // Release confirmations are safe to serialize and render: strip the
    // free-text note, which may carry case-specific detail and is never
    // needed to confirm a release. (explainHold already excludes it.)
    const holdSafe: ComplianceHold = { ...hold };
    delete holdSafe.note;

    return {
      holdId: normalized.holdId,
      hold: holdSafe,
      explanation: explainHold(hold),
    };
  }

  private decodeHold(scVal: xdr.ScVal): ComplianceHold {
    // js-xdr unions throw (rather than return null) when reading the arm
    // for a type that isn't set, so guard the decode explicitly.
    let map;
    try {
      map = scVal.map();
    } catch {
      map = null;
    }
    if (!map) {
      throw new ContractExecutionError(
        "Failed to decode audit hold response: expected a struct (ScMap). The contract may have returned an unexpected shape or the RPC node is out of sync.",
        ContractErrorCode.INVALID_RESPONSE,
        {}
      );
    }

    const entries: Record<string, unknown> = {};
    for (const entry of map) {
      const key = entry.key().sym()?.toString() ?? "";
      if (!key) continue;
      // Hand the raw ScVal back through the shared, never-throwing parser
      // from the compliance module so status normalization stays consistent
      // with the rest of the SDK's hold handling (#320).
      entries[key] = this.scValToPlain(entry.val());
    }

    return parseHoldStatus(entries);
  }

  /** Converts a decoded ScVal into a plain JSON-safe value for parseHoldStatus. */
  private scValToPlain(scVal: xdr.ScVal): unknown {
    // Only access the union arm matching the switch type: js-xdr unions
    // throw when reading the getter for any arm other than the one set.
    try {
      switch (scVal.switch().name) {
        case "scvBool":
          return scVal.b();
        case "scvString":
          return scVal.str()?.toString() ?? "";
        case "scvSymbol":
          return scVal.sym()?.toString() ?? "";
        case "scvU32":
          return scVal.u32();
        case "scvI32":
          return scVal.i32();
        case "scvU64": {
          const n = Number(scVal.u64().toString());
          return Number.isFinite(n) ? n : undefined;
        }
        case "scvI64": {
          const n = Number(scVal.i64().toString());
          return Number.isFinite(n) ? n : undefined;
        }
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }
}
