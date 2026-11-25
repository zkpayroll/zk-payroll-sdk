import { Keypair } from "@stellar/stellar-sdk";
import {
  assertReserveReductionAuthorized,
  ReserveReductionAuthorizationError,
  ReserveReductionAuthorizationErrorCode,
  MAX_RESERVE_AUTHORIZATION_ROLES,
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
describe("reserve reduction authorization input validation (#1001)", () => {
  const signer = Keypair.random();
  const base = { operatorAddress: signer.publicKey(), roles: ["treasury"] };
  const invalid = { code: ReserveReductionAuthorizationErrorCode.INVALID_CONTEXT };

  it.each([
    ["a null context", null],
    ["a non-object context", "treasury"],
    ["a blank operator address", { ...base, operatorAddress: "   " }],
    ["an empty roles list", { ...base, roles: [] }],
    ["a non-string role", { ...base, roles: ["treasury", 7] }],
    ["a blank role", { ...base, roles: ["treasury", " "] }],
    ["a non-array requiredRoles", { ...base, requiredRoles: "treasury" }],
    ["a non-string requiredRoles entry", { ...base, requiredRoles: [null] }],
    ["a blank requiredRoles entry", { ...base, requiredRoles: [""] }],
  ])("rejects %s as INVALID_CONTEXT", async (_label, context) => {
    await expect(assertReserveReductionAuthorized(signer, context as never)).rejects.toMatchObject(
      invalid
    );
  });

  it("accepts a role list at the size limit and rejects one past it", async () => {
    const atLimit = [...Array(MAX_RESERVE_AUTHORIZATION_ROLES - 1).fill("viewer"), "treasury"];
    await expect(
      assertReserveReductionAuthorized(signer, { ...base, roles: atLimit })
    ).resolves.toBeUndefined();
    await expect(
      assertReserveReductionAuthorized(signer, { ...base, roles: [...atLimit, "viewer"] })
    ).rejects.toMatchObject(invalid);
  });

  it("never echoes addresses or role values in the error message", async () => {
    const other = Keypair.random().publicKey();
    const error = await assertReserveReductionAuthorized(signer, {
      operatorAddress: other,
      roles: ["secret-role", 1 as never],
    }).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(other);
    expect((error as Error).message).not.toContain("secret-role");
  });
});
