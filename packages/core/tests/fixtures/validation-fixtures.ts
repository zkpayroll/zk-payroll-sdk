/**
 * Deterministic fixtures for {@link PayrollValidation.validatePaymentParams}.
 *
 * Each scenario pairs a `PaymentParams` input with the exact
 * `ValidationResult` the validator must produce. Tests can iterate over
 * `SCENARIO_PAYMENT_VALIDATIONS` for table-driven assertions.
 */

import { PaymentParams } from "../../src/types";
import { ValidationResult } from "../../src/core/validation";

// ── Shared recipient addresses ─────────────────────────────────────────────

export const FIXTURE_PAYMENT_RECIPIENT_VALID = "GVALIDPAYMENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const FIXTURE_PAYMENT_RECIPIENT_EMPTY = "";

// ── Message constants (must mirror messages emitted by PayrollValidation) ──

const MSG_MISSING_RECIPIENT = "Recipient address is required";
const MSG_INVALID_AMOUNT = "Amount must be a positive value";
const MSG_MISSING_ASSET = "Asset identifier is required";

// ── Scenario interface ─────────────────────────────────────────────────────

export interface PaymentValidationScenario {
  readonly name: string;
  readonly input: PaymentParams;
  readonly expected: ValidationResult;
}

// ── Helper for empty-errors results ────────────────────────────────────────

const VALID_RESULT: ValidationResult = { isValid: true, errors: [] };

// ── Scenario: valid native payment ────────────────────────────────────────

export const SCENARIO_PAYMENT_VALID: PaymentValidationScenario = {
  name: "valid-native-payment",
  input: {
    recipient: FIXTURE_PAYMENT_RECIPIENT_VALID,
    amount: 1_000_000_000n, // 100 XLM
    asset: "native",
  },
  expected: VALID_RESULT,
};

// ── Scenario: valid USDC payment ─────────────────────────────────────────

export const SCENARIO_PAYMENT_VALID_USDC: PaymentValidationScenario = {
  name: "valid-usdc-payment",
  input: {
    recipient: FIXTURE_PAYMENT_RECIPIENT_VALID,
    amount: 100_000_000n,
    asset: "CUSDC000000000000000000000000000000000000000000",
  },
  expected: VALID_RESULT,
};

// ── Scenario: empty recipient ─────────────────────────────────────────────

export const SCENARIO_PAYMENT_MISSING_RECIPIENT: PaymentValidationScenario = {
  name: "missing-recipient",
  input: {
    recipient: FIXTURE_PAYMENT_RECIPIENT_EMPTY,
    amount: 1_000_000_000n,
    asset: "native",
  },
  expected: {
    isValid: false,
    errors: [{ field: "recipient", message: MSG_MISSING_RECIPIENT }],
  },
};

// ── Scenario: zero amount ─────────────────────────────────────────────────

export const SCENARIO_PAYMENT_ZERO_AMOUNT: PaymentValidationScenario = {
  name: "zero-amount",
  input: {
    recipient: FIXTURE_PAYMENT_RECIPIENT_VALID,
    amount: 0n,
    asset: "native",
  },
  expected: {
    isValid: false,
    errors: [{ field: "amount", message: MSG_INVALID_AMOUNT }],
  },
};

// ── Scenario: whitespace-only asset ───────────────────────────────────────

export const SCENARIO_PAYMENT_WHITESPACE_ASSET: PaymentValidationScenario = {
  name: "whitespace-asset",
  input: {
    recipient: FIXTURE_PAYMENT_RECIPIENT_VALID,
    amount: 1_000_000_000n,
    asset: "   ",
  },
  expected: {
    isValid: false,
    errors: [{ field: "asset", message: MSG_MISSING_ASSET }],
  },
};

// ── Scenario: all three errors at once ────────────────────────────────────

export const SCENARIO_PAYMENT_MULTIPLE_ERRORS: PaymentValidationScenario = {
  name: "multiple-errors",
  input: {
    recipient: "",
    amount: 0n,
    asset: "",
  },
  expected: {
    isValid: false,
    errors: [
      { field: "recipient", message: MSG_MISSING_RECIPIENT },
      { field: "amount", message: MSG_INVALID_AMOUNT },
      { field: "asset", message: MSG_MISSING_ASSET },
    ],
  },
};

// ── All payment-validation scenarios in one table ──────────────────────────

export const SCENARIO_PAYMENT_VALIDATIONS: readonly PaymentValidationScenario[] = [
  SCENARIO_PAYMENT_VALID,
  SCENARIO_PAYMENT_VALID_USDC,
  SCENARIO_PAYMENT_MISSING_RECIPIENT,
  SCENARIO_PAYMENT_ZERO_AMOUNT,
  SCENARIO_PAYMENT_WHITESPACE_ASSET,
  SCENARIO_PAYMENT_MULTIPLE_ERRORS,
];
