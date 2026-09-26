import { StrKey } from "@stellar/stellar-sdk";
export type PayoutDestinationErrorCode =
  "DESTINATION_REQUIRED" | "DESTINATION_WHITESPACE" | "DESTINATION_UNSUPPORTED";
export type PayoutDestinationValidation =
  | { ok: true; destination: string; kind: "account" | "muxed_account" }
  | { ok: false; code: PayoutDestinationErrorCode; message: string };

/** Validates an account destination without reflecting submitted data in errors. */
export function validatePayoutDestination(value: unknown): PayoutDestinationValidation {
  if (typeof value !== "string" || value === "")
    return { ok: false, code: "DESTINATION_REQUIRED", message: "Payout destination is required." };
  const destination = value.trim();
  if (destination !== value || destination === "")
    return {
      ok: false,
      code: "DESTINATION_WHITESPACE",
      message: "Payout destination must not contain surrounding whitespace.",
    };
  if (StrKey.isValidEd25519PublicKey(destination))
    return { ok: true, destination, kind: "account" };
  const isMuxed = (StrKey as unknown as { isValidMed25519PublicKey?: (input: string) => boolean })
    .isValidMed25519PublicKey;
  if (isMuxed?.(destination)) return { ok: true, destination, kind: "muxed_account" };
  return {
    ok: false,
    code: "DESTINATION_UNSUPPORTED",
    message: "Payout destination must be a valid Stellar account or muxed account.",
  };
}
