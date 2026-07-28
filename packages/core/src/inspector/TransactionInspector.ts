import {
  Transaction,
  MemoNone,
  MemoText,
  MemoHash,
  MemoReturn,
  MemoID,
  Operation,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import type { TransactionSummary, OperationSummary } from "./types";

/**
 * Safely inspects a Stellar transaction envelope and returns a summary
 * of its operations, network, fees, and signers — without leaking
 * private contract-call arguments or other sensitive inputs.
 *
 * Use this helper before signing to let users review what a transaction
 * will do before they approve it in their wallet.
 *
 * @example
 * ```typescript
 * import { inspectTransaction } from "@zk-payroll/core";
 *
 * const summary = await inspectTransaction(tx);
 * console.log(summary.operations);
 * // → [{ type: "invokeHostFunction", functionName: "private_pay", … }]
 * ```
 *
 * @param tx - The Stellar Transaction envelope to inspect.
 * @returns A safe, serializable summary of the transaction's intent.
 */
export function inspectTransaction(tx: Transaction): TransactionSummary {
  const hashBuf = tx.hash();
  const ops = tx.operations.map(describeOperation);

  let hasSorobanAuth = false;
  let totalAuthCount = 0;

  for (const op of tx.operations) {
    if (op.type === "invokeHostFunction") {
      const invokeOp = op as Operation.InvokeHostFunction;
      const authCount = invokeOp.auth?.length ?? 0;
      if (authCount > 0) {
        hasSorobanAuth = true;
        totalAuthCount += authCount;
      }
    }
  }

  const sigHints = tx.signatures.map((sig) => Buffer.from(sig.hint()).toString("hex"));

  let memoValue: string | undefined;
  let memoType: string | undefined;

  if (tx.memo && tx.memo.type !== MemoNone) {
    memoType = tx.memo.type;
    if (tx.memo.value !== null && tx.memo.value !== undefined) {
      if (tx.memo.type === MemoText) {
        memoValue = tx.memo.value as string;
      } else if (tx.memo.type === MemoHash || tx.memo.type === MemoReturn) {
        memoValue = Buffer.from(tx.memo.value as Buffer).toString("hex");
      } else if (tx.memo.type === MemoID) {
        memoValue = String(tx.memo.value);
      }
    }
  }

  return {
    source: tx.source,
    fee: tx.fee,
    network: tx.networkPassphrase,
    sequence: tx.sequence,
    hash: hashBuf.toString("hex"),
    signatureCount: tx.signatures.length,
    signerHints: sigHints,
    operations: ops,
    memo: memoValue,
    memoType,
    hasSorobanAuth,
    sorobanAuthCount: hasSorobanAuth ? totalAuthCount : undefined,
    timeBounds: tx.timeBounds
      ? {
          minTime: tx.timeBounds.minTime,
          maxTime: tx.timeBounds.maxTime,
        }
      : undefined,
  };
}

/**
 * Describes a single high-level Operation safely.
 * Argument values are never included.
 */
function describeOperation(op: Operation): OperationSummary {
  const base: OperationSummary = {
    type: op.type,
    description: op.type,
  };

  switch (op.type) {
    case "invokeHostFunction": {
      const invokeOp = op as Operation.InvokeHostFunction;
      return describeHostFunction(invokeOp);
    }

    case "extendFootprintTtl": {
      const extOp = op as Operation.ExtendFootprintTTL;
      return {
        ...base,
        description: `Extend TTL by ${extOp.extendTo} ledgers`,
      };
    }

    case "restoreFootprint": {
      return {
        ...base,
        description: "Restore footprint (archival entries)",
      };
    }

    case "payment": {
      const payOp = op as Operation.Payment;
      return {
        ...base,
        description: `Send ${payOp.amount} ${payOp.asset.getCode()} to ${truncateAddress(payOp.destination)}`,
      };
    }

    case "createAccount": {
      const caOp = op as Operation.CreateAccount;
      return {
        ...base,
        description: `Create account ${truncateAddress(caOp.destination)} with ${caOp.startingBalance} XLM`,
      };
    }

    case "accountMerge": {
      const amOp = op as Operation.AccountMerge;
      return {
        ...base,
        description: `Merge account into ${truncateAddress(amOp.destination)}`,
      };
    }

    case "manageData": {
      const mdOp = op as Operation.ManageData;
      return {
        ...base,
        description: `Set data entry "${mdOp.name}"`,
      };
    }

    case "bumpSequence": {
      const bsOp = op as Operation.BumpSequence;
      return {
        ...base,
        description: `Bump sequence to ${bsOp.bumpTo}`,
      };
    }

    default: {
      return base;
    }
  }
}

/**
 * Describes a host-function operation (invoke, create, or upload).
 */
function describeHostFunction(op: Operation.InvokeHostFunction): OperationSummary {
  const func = op.func;
  const typeName = func.switch().name;
  const authCount = op.auth?.length ?? 0;

  switch (typeName) {
    case "hostFunctionTypeInvokeContract": {
      const args = func.invokeContract();
      const functionName = extractFunctionName(args.functionName());
      const contractId = extractContractId(args.contractAddress());
      const argCount = args.args().length;

      return {
        type: "invokeHostFunction",
        contractId,
        functionName,
        argumentCount: argCount,
        authCount,
        description: `Invoke ${functionName ?? "?"} on ${truncateAddress(contractId ?? "?")} (${argCount} arg${argCount !== 1 ? "s" : ""})`,
      };
    }

    case "hostFunctionTypeCreateContract":
    case "hostFunctionTypeCreateContractV2": {
      let description = "Create contract";
      if (typeName === "hostFunctionTypeCreateContractV2") {
        description = "Create contract v2";
      }
      return {
        type: "invokeHostFunction",
        authCount,
        description,
      };
    }

    case "hostFunctionTypeUploadContractWasm": {
      return {
        type: "invokeHostFunction",
        authCount,
        description: "Upload contract WASM",
      };
    }

    default: {
      return {
        type: "invokeHostFunction",
        description: `Invoke host function (${typeName})`,
      };
    }
  }
}

function extractFunctionName(raw: string | Buffer): string | undefined {
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (typeof raw === "object" && raw !== null) {
    try {
      const s = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      return s.length > 0 ? s : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractContractId(scAddress: xdr.ScAddress): string | undefined {
  try {
    if (scAddress.switch().name !== "scAddressTypeContract") {
      return undefined;
    }
    const contractId = scAddress.contractId();
    if (contractId === null || contractId === undefined) {
      return undefined;
    }
    const raw = Buffer.isBuffer(contractId)
      ? contractId
      : Buffer.from(contractId as unknown as Uint8Array);
    return StrKey.encodeContract(raw);
  } catch {
    return undefined;
  }
}

function truncateAddress(addr: string | undefined): string | undefined {
  if (!addr || addr.length < 12) {
    return addr;
  }
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
