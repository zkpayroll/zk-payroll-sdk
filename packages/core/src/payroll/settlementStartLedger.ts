export type SettlementStartLedgerValue = number | bigint | string;

export interface SettlementStartLedger {
  readonly ledgerSequence: SettlementStartLedgerValue;
}

export interface SettlementStartLedgerValidationResult {
  readonly ok: boolean;
  readonly code:
    | "SETTLEMENT_START_LEDGER_VALID"
    | "SETTLEMENT_START_LEDGER_REQUIRED"
    | "SETTLEMENT_START_LEDGER_INVALID";
  readonly message: string;
  readonly ledgerSequence?: bigint;
}

export interface SettlementStartLedgerRequestInput {
  readonly settlementStartLedger?: SettlementStartLedgerValue | SettlementStartLedger | null;
  readonly startLedger?: SettlementStartLedgerValue | null;
}

function normalizeLedger(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value >= 0n ? value : undefined;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return undefined;
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) return undefined;
    return BigInt(trimmed);
  }
  return undefined;
}

export function validateSettlementStartLedger(
  input: SettlementStartLedgerRequestInput
): SettlementStartLedgerValidationResult {
  const candidate =
    input.settlementStartLedger instanceof Object &&
    "ledgerSequence" in input.settlementStartLedger
      ? (input.settlementStartLedger as SettlementStartLedger).ledgerSequence
      : input.settlementStartLedger ?? input.startLedger;

  if (candidate === undefined || candidate === null) {
    return {
      ok: false,
      code: "SETTLEMENT_START_LEDGER_REQUIRED",
      message: "A settlement start ledger is required before a payroll request can be created.",
    };
  }

  const ledgerSequence = normalizeLedger(candidate);
  if (ledgerSequence === undefined) {
    return {
      ok: false,
      code: "SETTLEMENT_START_LEDGER_INVALID",
      message: "The settlement start ledger must be a non-negative integer.",
    };
  }
  return {
    ok: true,
    code: "SETTLEMENT_START_LEDGER_VALID",
    message: "The settlement start ledger is valid.",
    ledgerSequence,
  };
}

export function assertValidSettlementStartLedger(
  input: SettlementStartLedgerRequestInput
): bigint {
  const result = validateSettlementStartLedger(input);
  if (!result.ok) throw new Error(result.message);
  return result.ledgerSequence as bigint;
}
