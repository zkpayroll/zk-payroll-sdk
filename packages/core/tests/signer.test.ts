import { Keypair, Networks, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { ISigner } from "../src/signer/types";
import { KeypairSigner, isISigner, toISigner } from "../src/signer/KeypairSigner";
import { WalletSigner } from "../src/signer/WalletSigner";

// ── Helpers ──────────────────────────────────────────────────────────────────

class InMemorySigner implements ISigner {
  constructor(private readonly publicKey: string) {}

  async getPublicKey(): Promise<string> {
    return this.publicKey;
  }

  async sign(tx: Transaction): Promise<Transaction> {
    return tx;
  }
}

// ── ISigner contract compliance ──────────────────────────────────────────────

describe("ISigner implementations", () => {
  describe("contract compliance", () => {
    it("KeypairSigner satisfies the ISigner interface", () => {
      const kp = Keypair.random();
      const signer = new KeypairSigner(kp);

      expect(signer).toHaveProperty("getPublicKey");
      expect(typeof signer.getPublicKey).toBe("function");
      expect(signer).toHaveProperty("sign");
      expect(typeof signer.sign).toBe("function");
    });

    it("WalletSigner satisfies the ISigner interface", () => {
      const signer = new WalletSigner(
        async () => "GABCDEF1234567890",
        async (_txXdr: string) => _txXdr
      );

      expect(signer).toHaveProperty("getPublicKey");
      expect(typeof signer.getPublicKey).toBe("function");
      expect(signer).toHaveProperty("sign");
      expect(typeof signer.sign).toBe("function");
    });

    it("custom implementer satisfies the ISigner interface", () => {
      const signer = new InMemorySigner("GABC123");

      expect(signer).toHaveProperty("getPublicKey");
      expect(typeof signer.getPublicKey).toBe("function");
      expect(signer).toHaveProperty("sign");
      expect(typeof signer.sign).toBe("function");
    });
  });

  describe("implementations are interchangeable", () => {
    it("accepts KeypairSigner where ISigner is expected", () => {
      const kp = Keypair.random();
      const signer: ISigner = new KeypairSigner(kp);
      expect(signer).toBeInstanceOf(KeypairSigner);
    });

    it("accepts WalletSigner where ISigner is expected", () => {
      const signer: ISigner = new WalletSigner(
        async () => "G...",
        async (_txXdr: string) => _txXdr
      );
      expect(signer).toBeInstanceOf(WalletSigner);
    });
  });

  describe("getPublicKey", () => {
    it("KeypairSigner returns the underlying public key", async () => {
      const kp = Keypair.random();
      const signer = new KeypairSigner(kp);

      const pk = await signer.getPublicKey();
      expect(pk).toBe(kp.publicKey());
    });

    it("WalletSigner delegates to the injected function", async () => {
      const signer = new WalletSigner(
        async () => "GABCWALLETKEY",
        async (_txXdr: string) => _txXdr
      );

      const pk = await signer.getPublicKey();
      expect(pk).toBe("GABCWALLETKEY");
    });

    it("InMemorySigner returns the configured key", async () => {
      const signer = new InMemorySigner("GCUSTOMKEY");
      expect(await signer.getPublicKey()).toBe("GCUSTOMKEY");
    });
  });
});

// ── KeypairSigner specific ───────────────────────────────────────────────────

describe("KeypairSigner", () => {
  it("signs a transaction via the wrapped Keypair", async () => {
    const kp = Keypair.random();
    const signer = new KeypairSigner(kp);

    const mockTx = {
      sign: jest.fn().mockReturnThis(),
    } as unknown as Transaction;

    const result = await signer.sign(mockTx);
    expect((mockTx as unknown as { sign: jest.Mock }).sign).toHaveBeenCalledWith(kp);
    expect(result).toBe(mockTx);
  });

  it("getPublicKey delegates to keypair.publicKey()", async () => {
    const kp = Keypair.random();
    const signer = new KeypairSigner(kp);

    expect(await signer.getPublicKey()).toBe(kp.publicKey());
  });
});

// ── WalletSigner specific ────────────────────────────────────────────────────

describe("WalletSigner", () => {
  it("delegates signing to the injected function", async () => {
    const mockSignedTx = {} as Transaction;
    const fromXDRSpy = jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue(mockSignedTx as unknown as Transaction);

    const signTx = jest.fn().mockResolvedValue("signed-xdr");
    const signer = new WalletSigner(async () => "G...", signTx, {
      networkPassphrase: Networks.TESTNET,
    });

    const mockTx = {
      toXDR: jest.fn().mockReturnValue("unsigned-xdr"),
    } as unknown as Transaction;

    const result = await signer.sign(mockTx);
    expect((mockTx as unknown as { toXDR: jest.Mock }).toXDR).toHaveBeenCalled();
    expect(signTx).toHaveBeenCalledWith("unsigned-xdr");
    expect(fromXDRSpy).toHaveBeenCalledWith("signed-xdr", Networks.TESTNET);
    expect(result).toBe(mockSignedTx);

    fromXDRSpy.mockRestore();
  });

  it("uses TESTNET network passphrase by default", () => {
    const signer = new WalletSigner(
      async () => "G...",
      async (_txXdr: string) => _txXdr
    );

    expect(signer).toBeDefined();
  });

  it("uses provided network passphrase option", () => {
    const signer = new WalletSigner(
      async () => "G...",
      async (_txXdr: string) => _txXdr,
      { networkPassphrase: Networks.PUBLIC }
    );

    expect(signer).toBeDefined();
  });
});

// ── isISigner / toISigner helpers ────────────────────────────────────────────

describe("isISigner", () => {
  it("returns true for KeypairSigner", () => {
    const signer = new KeypairSigner(Keypair.random());
    expect(isISigner(signer)).toBe(true);
  });

  it("returns true for WalletSigner", () => {
    const signer = new WalletSigner(
      async () => "G...",
      async (_txXdr: string) => _txXdr
    );
    expect(isISigner(signer)).toBe(true);
  });

  it("returns true for a plain object conforming to ISigner", () => {
    const signer: ISigner = {
      getPublicKey: async () => "G...",
      sign: async (_tx: Transaction) => _tx,
    };
    expect(isISigner(signer)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isISigner(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isISigner(undefined)).toBe(false);
  });

  it("returns false for a plain object without required methods", () => {
    expect(isISigner({})).toBe(false);
  });

  it("returns false for a Keypair (has publicKey but not getPublicKey)", () => {
    const kp = Keypair.random();
    expect(isISigner(kp)).toBe(false);
  });
});

describe("toISigner", () => {
  it("returns an ISigner unchanged", () => {
    const signer: ISigner = {
      getPublicKey: async () => "G...",
      sign: async (_tx: Transaction) => _tx,
    };
    expect(toISigner(signer)).toBe(signer);
  });

  it("wraps a Keypair in a KeypairSigner", () => {
    const kp = Keypair.random();
    const result = toISigner(kp);
    expect(result).toBeInstanceOf(KeypairSigner);
  });
});

// ── Backward compatibility ───────────────────────────────────────────────────

describe("backward compatibility", () => {
  it("accepts Keypair where Keypair | ISigner is expected", () => {
    const kp = Keypair.random();
    const fn = (_signer: Keypair | ISigner) => _signer;

    const result = fn(kp);
    expect(result).toBe(kp);
  });

  it("accepts KeypairSigner where Keypair | ISigner is expected", () => {
    const signer = new KeypairSigner(Keypair.random());
    const fn = (_signer: Keypair | ISigner) => _signer;

    const result = fn(signer);
    expect(result).toBe(signer);
  });

  it("toISigner handles both Keypair and ISigner", () => {
    const kp = Keypair.random();
    const signer: ISigner = {
      getPublicKey: async () => "G...",
      sign: async (_tx: Transaction) => _tx,
    };

    expect(toISigner(kp).getPublicKey).toBeDefined();
    expect(toISigner(signer).getPublicKey).toBeDefined();
  });
});
