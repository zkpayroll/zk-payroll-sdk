import {
  isReservationNotFoundError,
  isReservationExpiredError,
  isReservationReleasedError,
  isReservationFinalizedError,
  getReservationErrorMessage,
  mapReservationError,
  ReservationErrorCode,
  RESERVATION_ERROR_MESSAGES,
} from "../src/errors/contractErrors";
import { ContractExecutionError } from "../src/core/errors";

describe("isReservationNotFoundError", () => {
  it("returns true for 'reservation not found' pattern", () => {
    expect(isReservationNotFoundError(new Error("reservation not found"))).toBe(true);
  });

  it("returns true for 'RESERVATION_NOT_FOUND' pattern", () => {
    expect(isReservationNotFoundError(new Error("HostError: RESERVATION_NOT_FOUND"))).toBe(true);
  });

  it("returns true for 'reservation does not exist' pattern", () => {
    expect(isReservationNotFoundError(new Error("reservation does not exist"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isReservationNotFoundError(new Error("network timeout"))).toBe(false);
    expect(isReservationNotFoundError(new Error("insufficient funds"))).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isReservationNotFoundError(null)).toBe(false);
    expect(isReservationNotFoundError(undefined)).toBe(false);
    expect(isReservationNotFoundError("")).toBe(false);
  });
});

describe("isReservationExpiredError", () => {
  it("returns true for 'reservation expired' pattern", () => {
    expect(isReservationExpiredError(new Error("reservation expired"))).toBe(true);
  });

  it("returns true for 'RESERVATION_EXPIRED'", () => {
    expect(isReservationExpiredError(new Error("RESERVATION_EXPIRED"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isReservationExpiredError(new Error("not found"))).toBe(false);
  });
});

describe("isReservationReleasedError", () => {
  it("returns true for 'reservation released' pattern", () => {
    expect(isReservationReleasedError(new Error("reservation already released"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isReservationReleasedError(new Error("timeout"))).toBe(false);
  });
});

describe("isReservationFinalizedError", () => {
  it("returns true for 'reservation already finalized' pattern", () => {
    expect(isReservationFinalizedError(new Error("reservation already finalized"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isReservationFinalizedError(new Error("unknown"))).toBe(false);
  });
});

describe("getReservationErrorMessage", () => {
  it("returns user-friendly message for not-found error", () => {
    const msg = getReservationErrorMessage(new Error("reservation not found"));
    expect(msg).toBe(RESERVATION_ERROR_MESSAGES[ReservationErrorCode.RESERVATION_NOT_FOUND]);
    expect(msg).not.toMatch(/raw|contract/i);
    expect(msg).toMatch(/verify the reservation ID/i);
  });

  it("returns user-friendly message for expired error", () => {
    const msg = getReservationErrorMessage(new Error("reservation expired"));
    expect(msg).toBe(RESERVATION_ERROR_MESSAGES[ReservationErrorCode.RESERVATION_EXPIRED]);
    expect(msg).toMatch(/create a new reservation/i);
  });

  it("returns user-friendly message for released error", () => {
    const msg = getReservationErrorMessage(new Error("reservation released"));
    expect(msg).toBe(RESERVATION_ERROR_MESSAGES[ReservationErrorCode.RESERVATION_RELEASED]);
  });

  it("returns user-friendly message for finalized error", () => {
    const msg = getReservationErrorMessage(new Error("reservation already finalized"));
    expect(msg).toBe(RESERVATION_ERROR_MESSAGES[ReservationErrorCode.RESERVATION_ALREADY_FINALIZED]);
  });

  it("returns generic message for unrecognized errors", () => {
    const msg = getReservationErrorMessage(new Error("something else"));
    expect(msg).toMatch(/unexpected error/);
  });

  it("supports custom overrides", () => {
    const msg = getReservationErrorMessage(new Error("reservation not found"), {
      [ReservationErrorCode.RESERVATION_NOT_FOUND]: "Custom not found message",
    });
    expect(msg).toBe("Custom not found message");
  });
});

describe("mapReservationError", () => {
  it("maps not-found error to ContractExecutionError with friendly message", () => {
    const mapped = mapReservationError(new Error("reservation not found"));
    expect(mapped).toBeInstanceOf(ContractExecutionError);
    expect(mapped.message).toMatch(/verify the reservation ID/i);
    expect(mapped.context).toEqual({});
  });

  it("maps expired error to ContractExecutionError", () => {
    const mapped = mapReservationError(new Error("reservation expired"));
    expect(mapped).toBeInstanceOf(ContractExecutionError);
    expect(mapped.message).toMatch(/create a new reservation/i);
  });

  it("maps released error to ContractExecutionError", () => {
    const mapped = mapReservationError(new Error("reservation released"));
    expect(mapped).toBeInstanceOf(ContractExecutionError);
    expect(mapped.message).toMatch(/no longer reserved/i);
  });

  it("maps finalized error to ContractExecutionError", () => {
    const mapped = mapReservationError(new Error("reservation already finalized"));
    expect(mapped).toBeInstanceOf(ContractExecutionError);
    expect(mapped.message).toMatch(/already been finalized/i);
  });

  it("wraps unrecognized errors as ContractExecutionError", () => {
    const mapped = mapReservationError(new Error("unknown failure"));
    expect(mapped).toBeInstanceOf(ContractExecutionError);
    expect(mapped.message).toBe("unknown failure");
  });

  it("preserves context metadata", () => {
    const mapped = mapReservationError(new Error("reservation not found"), {
      reservationId: "res_123",
      contractId: "CABC",
    });
    expect(mapped.context.reservationId).toBe("res_123");
    expect(mapped.context.contractId).toBe("CABC");
  });

  it("never exposes private payroll values in user-facing messages", () => {
    const err = new Error("reservation not found for employer GSECRET123 amount 5000000");
    const mapped = mapReservationError(err);
    expect(mapped.message).not.toMatch(/GSECRET123/);
    expect(mapped.message).not.toMatch(/5000000/);
  });
});
