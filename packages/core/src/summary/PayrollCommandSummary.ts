import type { PaymentParams } from "../types";

export interface PayrollCommandInput {
  /** Type of command being summarized (e.g. "single_payment", "batch_payment", "private_pay") */
  type?:
    | "single_payment"
    | "batch_payment"
    | "private_pay"
    | "contract_invocation"
    | string;
  /** Primary or destination recipient Stellar address */
  recipient?: string;
  /** Payment amount in stroops */
  amount?: bigint;
  /** Asset identifier (e.g. "native" or Soroban token contract address) */
  asset?: string;
  /** List of payment entries for batch commands */
  payments?: Array<{ recipient: string; amount: bigint; asset?: string }>;
  /** Source account authorizing or initiating the command */
  sourceAccount?: string;
  /** Network passphrase */
  network?: string;
  /** Human-readable memo or description */
  memo?: string;
  /** Idempotency key for execution tracking */
  idempotencyKey?: string;
}

export interface PayrollCommandSummary {
  /** Standardized command classification string */
  commandType: string;
  /** Single-line plain language summary text */
  summaryText: string;
  /** Total sum of amounts across all payment targets */
  totalAmount: bigint;
  /** Asset identifier */
  asset: string;
  /** Number of recipients receiving funds */
  recipientCount: number;
  /** Array of recipient addresses */
  recipients: string[];
  /** Detailed plain-language bullet points */
  plainLanguageDetails: string[];
  /** Flag indicating sensitive or ZK-proof operation */
  isSensitive: boolean;
  /** Safety warnings (e.g., zero amount, missing recipient) */
  warnings: string[];
}

/**
 * Formats a Stellar public key address into a readable truncated form.
 */
function truncateAddress(address: string): string {
  if (!address || address.length <= 12) return address || "Unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Formats stroop amounts into human-readable representation.
 */
function formatAmount(amount: bigint, asset: string): string {
  const assetName =
    asset === "native"
      ? "XLM"
      : asset.length > 12
        ? truncateAddress(asset)
        : asset;
  return `${amount.toString()} (base units) ${assetName}`;
}

/**
 * Helper function that summarizes payroll commands in plain language before execution.
 * Accepts a structured command, single payment params, or an array of payment params.
 *
 * @param input - The command, payment params, or batch payment params to summarize.
 * @returns Structured summary containing plain language explanations and warnings.
 */
export function summarizePayrollCommand(
  input: PayrollCommandInput | PaymentParams | PaymentParams[],
): PayrollCommandSummary {
  const warnings: string[] = [];
  const details: string[] = [];

  // Normalize input into unified list of payment entries and metadata
  let payments: Array<{ recipient: string; amount: bigint; asset?: string }> =
    [];
  let explicitType: string | undefined;
  let sourceAccount: string | undefined;
  let network: string | undefined;
  let memo: string | undefined;
  let idempotencyKey: string | undefined;

  if (Array.isArray(input)) {
    payments = input;
    explicitType = "batch_payment";
  } else if ("payments" in input && Array.isArray(input.payments)) {
    payments = input.payments;
    explicitType = input.type || "batch_payment";
    sourceAccount = input.sourceAccount;
    network = input.network;
    memo = input.memo;
    idempotencyKey = input.idempotencyKey;
  } else {
    const single = input as PaymentParams & PayrollCommandInput;
    if (single.recipient !== undefined || single.amount !== undefined) {
      payments = [
        {
          recipient: single.recipient ?? "",
          amount: single.amount ?? 0n,
          asset: single.asset,
        },
      ];
    }
    explicitType = single.type || "single_payment";
    sourceAccount = single.sourceAccount;
    network = single.network;
    memo = single.memo;
    idempotencyKey = single.idempotencyKey;
  }

  const recipientCount = payments.length;
  const recipients = payments.map((p) => p.recipient).filter(Boolean);
  let totalAmount = 0n;

  for (const p of payments) {
    totalAmount += p.amount ?? 0n;
    if (!p.recipient) {
      warnings.push(
        "One or more payment targets are missing a recipient address.",
      );
    } else if (p.amount <= 0n) {
      warnings.push(
        `Payment to ${truncateAddress(p.recipient)} has a zero or negative amount.`,
      );
    }
  }

  const primaryAsset = payments[0]?.asset || "native";
  const commandType =
    recipientCount > 1
      ? "Batch Payroll Payment"
      : explicitType === "contract_invocation"
        ? "Contract Invocation"
        : "Single Private Payment";

  const isSensitive = true; // Payroll transactions deal with financial disbursements & privacy

  // Build plain language bullet details
  details.push(`Command: ${commandType}`);
  details.push(
    `Recipients: ${recipientCount} address${recipientCount !== 1 ? "es" : ""}`,
  );
  details.push(
    `Total Disbursement: ${formatAmount(totalAmount, primaryAsset)}`,
  );

  if (sourceAccount) {
    details.push(`Source Account: ${truncateAddress(sourceAccount)}`);
  }
  if (network) {
    details.push(`Target Network: ${network}`);
  }
  if (memo) {
    details.push(`Memo: "${memo}"`);
  }
  if (idempotencyKey) {
    details.push(`Idempotency Key: ${idempotencyKey}`);
  }

  if (recipientCount === 0) {
    warnings.push("No payment targets provided in command.");
  }

  const recipientSummaryStr =
    recipientCount === 1 && recipients[0]
      ? `to ${truncateAddress(recipients[0])}`
      : `across ${recipientCount} recipients`;

  const summaryText = `${commandType}: ${formatAmount(totalAmount, primaryAsset)} ${recipientSummaryStr}`;

  return {
    commandType,
    summaryText,
    totalAmount,
    asset: primaryAsset,
    recipientCount,
    recipients,
    plainLanguageDetails: details,
    isSensitive,
    warnings,
  };
}

/**
 * Formats a PayrollCommandSummary into a multi-line plain text prompt for display to end users.
 *
 * @param summary - Output of summarizePayrollCommand
 * @returns Human-readable plain text block
 */
export function formatPayrollCommandPrompt(
  summary: PayrollCommandSummary,
): string {
  const lines: string[] = [];
  lines.push(`=== ${summary.commandType} Summary ===`);
  lines.push(summary.summaryText);
  lines.push("");
  lines.push("Details:");
  for (const detail of summary.plainLanguageDetails) {
    lines.push(`  * ${detail}`);
  }

  if (summary.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of summary.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  return lines.join("\n");
}
