import { Address, Keypair, StrKey, scValToNative } from "@stellar/stellar-sdk";
import { addressToScAddress, numberToI128Xdr, stringToScVal } from "../src/utils/xdr-formatters";

const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);

describe("xdr-formatters", () => {
  describe("numberToI128Xdr", () => {
    it("encodes zero from number", () => {
      const scv = numberToI128Xdr(0);
      expect(scv.switch().name).toBe("scvI128");
      expect(scValToNative(scv)).toBe(0n);
    });

    it("encodes safe integers from number", () => {
      expect(scValToNative(numberToI128Xdr(Number.MAX_SAFE_INTEGER))).toBe(
        BigInt(Number.MAX_SAFE_INTEGER)
      );
      expect(scValToNative(numberToI128Xdr(Number.MIN_SAFE_INTEGER))).toBe(
        BigInt(Number.MIN_SAFE_INTEGER)
      );
    });

    it("encodes values larger than Number.MAX_SAFE_INTEGER via bigint", () => {
      const v = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
      const scv = numberToI128Xdr(v);
      expect(scValToNative(scv)).toBe(v);
    });

    it("encodes large magnitudes via decimal string", () => {
      const v = "9007199254740993"; // MAX_SAFE_INTEGER + 1
      expect(scValToNative(numberToI128Xdr(v))).toBe(9007199254740993n);
    });

    it("accepts bigint at i128 boundaries", () => {
      expect(scValToNative(numberToI128Xdr(I128_MAX))).toBe(I128_MAX);
      expect(scValToNative(numberToI128Xdr(I128_MIN))).toBe(I128_MIN);
    });

    it("trims string input", () => {
      expect(scValToNative(numberToI128Xdr("  42 \n"))).toBe(42n);
    });

    it("rejects non-integer numbers", () => {
      expect(() => numberToI128Xdr(1.5)).toThrow("i128 value must be an integer");
    });

    it("rejects unsafe JS numbers", () => {
      expect(() => numberToI128Xdr(Number.MAX_SAFE_INTEGER + 1)).toThrow("not a safe integer");
    });

    it("rejects out-of-range i128", () => {
      expect(() => numberToI128Xdr(I128_MAX + 1n)).toThrow(RangeError);
      expect(() => numberToI128Xdr(I128_MIN - 1n)).toThrow(RangeError);
    });

    it("rejects invalid string integers", () => {
      expect(() => numberToI128Xdr("")).toThrow(SyntaxError);
      expect(() => numberToI128Xdr("   ")).toThrow(SyntaxError);
      expect(() => numberToI128Xdr("-")).toThrow(SyntaxError);
      expect(() => numberToI128Xdr("not-a-number")).toThrow(SyntaxError);
    });
  });

  describe("stringToScVal", () => {
    it("defaults to scvString", () => {
      const scv = stringToScVal("hello 世界");
      expect(scv.switch().name).toBe("scvString");
      expect(scValToNative(scv)).toBe("hello 世界");
    });

    it("encodes Soroban symbols", () => {
      const scv = stringToScVal("native", "symbol");
      expect(scv.switch().name).toBe("scvSymbol");
      expect(scValToNative(scv)).toBe("native");
    });
  });

  describe("addressToScAddress", () => {
    it("round-trips a G-account strkey", () => {
      const g = Keypair.random().publicKey();
      const sc = addressToScAddress(g);
      expect(Address.fromScAddress(sc).toString()).toBe(g);
    });

    it("round-trips a C-contract strkey", () => {
      const c = StrKey.encodeContract(Buffer.alloc(32, 7));
      const sc = addressToScAddress(c);
      expect(Address.fromScAddress(sc).toString()).toBe(c);
    });

    it("throws on invalid address string", () => {
      expect(() => addressToScAddress("not-valid")).toThrow();
    });
  });
});
