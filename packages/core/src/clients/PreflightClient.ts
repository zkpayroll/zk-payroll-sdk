import { rpc, xdr, nativeToScVal, Address, Keypair, Networks } from "@stellar/stellar-sdk";
import { BaseContractWrapper, PreparedInvocation } from "../adapters/BaseContractWrapper";
import { ClientOptions, ExecutePaymentRequest, SchedulePaymentRequest } from "./types";

export interface PreflightFinding {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  field?: string;
}

export interface PreflightResult {
  canProceed: boolean;
  findings: PreflightFinding[];
  prepared?: PreparedInvocation;
}

export class PreflightClient extends BaseContractWrapper {
  private readonly networkPassphrase: string;

  constructor(server: rpc.Server, contractId: string, options?: ClientOptions) {
    super(server, contractId);
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
  }

  async preflightExecute(
    request: ExecutePaymentRequest,
    sourcePublicKey: string,
    network?: string
  ): Promise<PreflightResult> {
    try {
      const args: xdr.ScVal[] = [
        new Address(request.recipient).toScVal(),
        nativeToScVal(request.amount, { type: "i128" }),
        new Address(request.asset).toScVal(),
        nativeToScVal(request.memo ?? "", { type: "string" }),
      ];

      return this.runPreflight("execute", args, sourcePublicKey, network);
    } catch (err: any) {
      return {
        canProceed: false,
        findings: [
          {
            code: err.code || "INVALID_ARGUMENT",
            severity: "error",
            message: err.message || String(err),
          },
        ],
      };
    }
  }

  async preflightSchedule(
    request: SchedulePaymentRequest,
    sourcePublicKey: string,
    network?: string
  ): Promise<PreflightResult> {
    try {
      const args: xdr.ScVal[] = [
        new Address(request.recipient).toScVal(),
        nativeToScVal(request.amount, { type: "i128" }),
        new Address(request.asset).toScVal(),
        nativeToScVal(request.executeAt, { type: "u64" }),
        nativeToScVal(request.memo ?? "", { type: "string" }),
      ];

      return this.runPreflight("schedule", args, sourcePublicKey, network);
    } catch (err: any) {
      return {
        canProceed: false,
        findings: [
          {
            code: err.code || "INVALID_ARGUMENT",
            severity: "error",
            message: err.message || String(err),
          },
        ],
      };
    }
  }

  private async runPreflight(
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string,
    network?: string
  ): Promise<PreflightResult> {
    const findings: PreflightFinding[] = [];
    try {
      const prepared = await this.buildInvocation(
        method,
        args,
        sourcePublicKey,
        network ?? this.networkPassphrase
      );
      return { canProceed: true, findings, prepared };
    } catch (err: any) {
      findings.push({
        code: err.code || "PREFLIGHT_ERROR",
        severity: "error",
        message: err.message || String(err),
      });
      return { canProceed: false, findings };
    }
  }
}
