/**
 * Typed settlement timeout responses.
 *
 * Normalizes contract, RPC, and polling timeout payloads without exposing
 * employee, salary, or recipient data.
 */

export const SettlementTimeoutErrorCode = {
  SETTLEMENT_TIMEOUT: "SETTLEMENT_TIMEOUT",
  CONFIRMATION_TIMEOUT: "CONFIRMATION_TIMEOUT",
  RPC_TIMEOUT: "RPC_TIMEOUT",
  BATCH_TIMEOUT: "BATCH_TIMEOUT",
  UNKNOWN_TIMEOUT: "UNKNOWN_TIMEOUT",
} as const;

export type SettlementTimeoutErrorCode =
  (typeof SettlementTimeoutErrorCode)[keyof typeof SettlementTimeoutErrorCode];

export interface SettlementTimeoutResponse {
  type: "settlement_timeout";
  code: SettlementTimeoutErrorCode;
  retryable: boolean;
  settlementId?: string;
  payrollId?: string;
  elapsedMs?: number;
  timeoutMs?: number;
  ledger?: number;
}

export type SettlementTimeoutParseResult =
  | { ok: true; value: SettlementTimeoutResponse }
  | { ok: false; code: "INVALID_TIMEOUT_RESPONSE"; message: string };

const CODE_ALIASES: Readonly<Record<string, SettlementTimeoutErrorCode>> = {
  SETTLEMENT_TIMEOUT: SettlementTimeoutErrorCode.SETTLEMENT_TIMEOUT,
  CONFIRMATION_TIMEOUT: SettlementTimeoutErrorCode.CONFIRMATION_TIMEOUT,
  RPC_TIMEOUT: SettlementTimeoutErrorCode.RPC_TIMEOUT,
  BATCH_TIMEOUT: SettlementTimeoutErrorCode.BATCH_TIMEOUT,
  TRANSACTION_TIMEOUT: SettlementTimeoutErrorCode.CONFIRMATION_TIMEOUT,
};

function normalizeCode(value: unknown): SettlementTimeoutErrorCode {
  if (typeof value !== "string") return SettlementTimeoutErrorCode.UNKNOWN_TIMEOUT;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return CODE_ALIASES[upper] ?? SettlementTimeoutErrorCode.UNKNOWN_TIMEOUT;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function parseSettlementTimeoutResponse(input: unknown): SettlementTimeoutParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      code: "INVALID_TIMEOUT_RESPONSE",
      message: "Settlement timeout response must be an object.",
    };
  }

  const candidate = input as Record<string, unknown>;
  const kind = typeof candidate.type === "string" ? candidate.type.toLowerCase() : "";
  const codeValue =
    candidate.code ?? candidate.errorCode ?? candidate.reasonCode ?? candidate.status;
  const codeText = typeof codeValue === "string" ? codeValue.toUpperCase() : "";
  const explicitlyTimeout =
    kind.includes("timeout") ||
    codeText.includes("TIMEOUT") ||
    candidate.timedOut === true ||
    candidate.timeout === true;

  if (!explicitlyTimeout) {
    return {
      ok: false,
      code: "INVALID_TIMEOUT_RESPONSE",
      message: "Response does not describe a settlement timeout.",
    };
  }

  const code = normalizeCode(codeValue);
  const settlementId =
    typeof candidate.settlementId === "string" && candidate.settlementId.trim()
      ? candidate.settlementId.trim()
      : undefined;
  const payrollId =
    typeof candidate.payrollId === "string" && candidate.payrollId.trim()
      ? candidate.payrollId.trim()
      : undefined;

  return {
    ok: true,
    value: {
      type: "settlement_timeout",
      code,
      retryable: code !== SettlementTimeoutErrorCode.UNKNOWN_TIMEOUT,
      ...(settlementId ? { settlementId } : {}),
      ...(payrollId ? { payrollId } : {}),
      ...(positiveNumber(candidate.elapsedMs) !== undefined
        ? { elapsedMs: positiveNumber(candidate.elapsedMs) }
        : {}),
      ...(positiveNumber(candidate.timeoutMs) !== undefined
        ? { timeoutMs: positiveNumber(candidate.timeoutMs) }
        : {}),
      ...(positiveNumber(candidate.ledger) !== undefined
        ? { ledger: positiveNumber(candidate.ledger) }
        : {}),
    },
  };
}

export function isSettlementTimeoutResponse(input: unknown): input is SettlementTimeoutResponse {
  return parseSettlementTimeoutResponse(input).ok;
}
