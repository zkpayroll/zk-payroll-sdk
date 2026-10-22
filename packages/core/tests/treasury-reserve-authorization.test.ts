import { Keypair } from "@stellar/stellar-sdk";
import {
  assertReserveReductionAuthorized,
  ReserveReductionAuthorizationError,
  ReserveReductionAuthorizationErrorCode,
} from "../src/treasury/authorization";

describe("reserve reduction authorization context", () => {
  const signer = Keypair.random();

  it("accepts an authorized context bound to the signer", async () => {
    await expect(
      assertReserveReductionAuthorized(signer, {
        operatorAddress: signer.publicKey(),
        roles: ["treasury"],
      })
    ).resolves.toBeUndefined();
  });

  it("rejects a context for a different signer without leaking its address", async () => {
    await expect(
      assertReserveReductionAuthorized(signer, {
        operatorAddress: Keypair.random().publicKey(),
        roles: ["treasury"],
      })
    ).rejects.toMatchObject({
      name: "ReserveReductionAuthorizationError",
      code: ReserveReductionAuthorizationErrorCode.SIGNER_MISMATCH,
    });
  });

  it("rejects an unprivileged role context", async () => {
    await expect(
      assertReserveReductionAuthorized(signer, {
        operatorAddress: signer.publicKey(),
        roles: ["viewer"],
      })
    ).rejects.toBeInstanceOf(ReserveReductionAuthorizationError);
    await expect(
      assertReserveReductionAuthorized(signer, {
        operatorAddress: signer.publicKey(),
        roles: ["viewer"],
      })
    ).rejects.toMatchObject({ code: ReserveReductionAuthorizationErrorCode.UNAUTHORIZED });
  });

  it("uses the default allowed role policy when no additional roles are configured", async () => {
    await expect(
      assertReserveReductionAuthorized(signer, {
        operatorAddress: signer.publicKey(),
        roles: ["treasury"],
        requiredRoles: [],
      })
    ).resolves.toBeUndefined();
  });
});