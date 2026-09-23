import { rpc, xdr, nativeToScVal, Keypair, Networks } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import {
  ArchiveStatus,
  ArchiveRecord,
  ArchiveOptions,
  ArchiveEligibilityResult,
  PayrollRunItem,
} from "./types";

export class ArchiveClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: { networkPassphrase?: string }) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  /**
   * Check if a payroll run is eligible for archiving.
   * Disputed or held runs are strictly ineligible.
   */
  checkEligibility(run: PayrollRunItem): ArchiveEligibilityResult {
    if (run.isDisputed === true || String(run.status).toLowerCase() === "disputed") {
      return {
        eligible: false,
        reason: "Disputed runs cannot be archived until dispute resolution",
      };
    }

    if (run.isHeld === true || String(run.status).toLowerCase() === "held") {
      return {
        eligible: false,
        reason: "Held runs cannot be archived while on hold",
      };
    }

    const statusStr = String(run.status).toLowerCase();
    if (statusStr !== "finalized" && statusStr !== "completed") {
      return {
        eligible: false,
        reason: `Payroll run status '${run.status}' is not eligible for archiving. Run must be finalized or completed.`,
      };
    }

    return { eligible: true };
  }

  /**
   * Mark a payroll run as archived on-chain.
   * Throws an Error if the run is ineligible (e.g. disputed or held).
   */
  async archivePayrollRun(
    runId: string,
    signer: Keypair | ISigner,
    options?: ArchiveOptions,
    network?: string
  ): Promise<ArchiveRecord> {
    const signerObj = toISigner(signer);
    const pubKey = await signerObj.getPublicKey();

    const args: xdr.ScVal[] = [
      nativeToScVal(runId, { type: "string" }),
      nativeToScVal(options?.reason ?? "", { type: "string" }),
    ];

    const result = await this.invoke(
      "archive_run",
      args,
      signerObj,
      network ?? this.networkPassphrase
    );

    return this.decodeArchiveRecord(result, runId, pubKey, options);
  }

  /**
   * Fetch the current archive status of a payroll run from the contract.
   */
  async getArchiveStatus(
    runId: string,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<ArchiveStatus> {
    const args: xdr.ScVal[] = [nativeToScVal(runId, { type: "string" })];
    const result = await this.invoke(
      "get_archive_status",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    return this.decodeArchiveStatus(result);
  }

  /**
   * Fetch full archive record of a payroll run.
   */
  async getArchiveRecord(
    runId: string,
    signer: Keypair | ISigner,
    network?: string
  ): Promise<ArchiveRecord> {
    const args: xdr.ScVal[] = [nativeToScVal(runId, { type: "string" })];
    const result = await this.invoke(
      "get_archive_record",
      args,
      toISigner(signer),
      network ?? this.networkPassphrase
    );

    return this.decodeArchiveRecord(result, runId);
  }

  private decodeArchiveStatus(scVal: xdr.ScVal): ArchiveStatus {
    const str = scVal.str()?.toString().toLowerCase() || scVal.sym()?.toString().toLowerCase();
    if (str === "archived") return "archived";
    if (str === "disputed") return "disputed";
    if (str === "held") return "held";
    if (str === "finalized") return "finalized";
    return "active";
  }

  private decodeArchiveRecord(
    scVal: xdr.ScVal,
    defaultRunId: string,
    archivedByFallback?: string,
    optionsFallback?: ArchiveOptions
  ): ArchiveRecord {
    if (!scVal || scVal.switch().name !== "scvMap") {
      // Fallback object when contract returns simple string/void response
      const statusStr =
        scVal?.switch().name === "scvString" ? scVal.str().toString().toLowerCase() : "archived";
      const status: ArchiveStatus =
        statusStr === "disputed"
          ? "disputed"
          : statusStr === "held"
            ? "held"
            : statusStr === "finalized"
              ? "finalized"
              : statusStr === "active"
                ? "active"
                : "archived";

      return {
        runId: defaultRunId,
        status,
        archivedAt: Date.now(),
        archivedBy: archivedByFallback,
        reason: optionsFallback?.reason,
        isDisputed: status === "disputed",
        isHeld: status === "held",
        metadata: optionsFallback?.metadata,
      };
    }

    const map = scVal.map();
    const entries: Record<string, xdr.ScVal> = {};
    if (map) {
      for (const entry of map) {
        const key = entry.key().sym()?.toString() ?? entry.key().str()?.toString() ?? "";
        entries[key] = entry.val();
      }
    }

    const statusRaw =
      entries.status?.str()?.toString().toLowerCase() ||
      entries.status?.sym()?.toString().toLowerCase() ||
      "archived";

    const status: ArchiveStatus =
      statusRaw === "disputed"
        ? "disputed"
        : statusRaw === "held"
          ? "held"
          : statusRaw === "finalized"
            ? "finalized"
            : statusRaw === "active"
              ? "active"
              : "archived";

    return {
      runId: entries.run_id?.str()?.toString() ?? defaultRunId,
      status,
      archivedAt: Number(entries.archived_at?.u64() ?? Date.now()),
      archivedBy: entries.archived_by?.str()?.toString() ?? archivedByFallback,
      reason: entries.reason?.str()?.toString() ?? optionsFallback?.reason,
      isDisputed: entries.is_disputed?.b() ?? false,
      isHeld: entries.is_held?.b() ?? false,
      metadata: optionsFallback?.metadata,
    };
  }
}
