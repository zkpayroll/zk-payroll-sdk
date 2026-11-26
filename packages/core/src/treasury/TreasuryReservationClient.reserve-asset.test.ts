import { describe, it, expect, vi } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { TreasuryReservationClient } from "./TreasuryReservationClient";
import { ValidationError } from "../core/errors";

const usdcContract = Keypair.random().publicKey();

const assets = [
  { symbol: "USDC", contractId: usdcContract, decimals: 7 },
  { symbol: "EURC", contractId: Keypair.random().publicKey(), enabled: false },
];

const base = {
  employer: Keypair.random().publicKey(),
  amount: 100n,
  expirationUnixSeconds: 2_000_000_000,
};

function setup() {
  const client = new TreasuryReservationClient(
    {} as any,
    StrKey.encodeContract(Buffer.alloc(32)),
    { supportedAssetsFetcher: async () => assets }
  );
  const invoke = vi
    .spyOn(client as any, "invoke")
    .mockResolvedValue({ str: () => "res_1" });
  return { client, invoke, signer: Keypair.random() };
}

describe("reserve: unknown asset rejection (#838)", () => {
  it("accepts a known, enabled asset (by contract address)", async () => {
    const { client, invoke, signer } = setup();
    const res = await client.reserve({ ...base, asset: usdcContract }, signer);
    expect(res.reservationId).toBe("res_1");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown asset before calling the treasury", async () => {
    const { client, invoke, signer } = setup();
    await expect(
      client.reserve({ ...base, asset: "FAKE" }, signer)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a disabled asset (boundary)", async () => {
    const { client, invoke, signer } = setup();
    await expect(
      client.reserve({ ...base, asset: "EURC" }, signer)
    ).rejects.toThrow(/disabled/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects an empty asset (boundary)", async () => {
    const { client, invoke, signer } = setup();
    await expect(
      client.reserve({ ...base, asset: "   " }, signer)
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not expose employer or amount in the error", async () => {
    const { client, signer } = setup();
    try {
      await client.reserve({ ...base, asset: "FAKE" }, signer);
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(base.employer);
      expect(msg).not.toContain("100");
    }
  });
});
