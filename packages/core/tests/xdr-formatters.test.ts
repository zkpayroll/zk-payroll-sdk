import { Address, xdr } from "@stellar/stellar-sdk";
import { addressToScAddress, addressToScVal, numberToI128Xdr, stringToScVal } from "../src/utils/xdr-formatters";

const ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("XDR formatters", () => {
  it("formats safe and large signed i128 values without Number precision loss", () => {
    expect(numberToI128Xdr(42).toXDR("hex")).toBe(
      numberToI128Xdr("42").toXDR("hex"),
    );
    expect(numberToI128Xdr("90071992547409931234567890").toXDR("hex")).toBe(
      "0000000a00000000004a817c800000029da1e6d2",
    );
    expect(numberToI128Xdr(-123n).toXDR("hex")).toBe(
      numberToI128Xdr("-123").toXDR("hex"),
    );
  });

  it("rejects unsafe numeric input and values outside i128", () => {
    expect(() => numberToI128Xdr(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
    expect(() => numberToI128Xdr(1n << 127n)).toThrow(RangeError);
    expect(() => numberToI128Xdr("not-a-number")).toThrow(TypeError);
  });

  it("formats strings and validates Stellar addresses", () => {
    expect(stringToScVal("payroll").str()).toBe("payroll");
    expect(addressToScAddress(ACCOUNT)).toEqual(new Address(ACCOUNT).toScAddress());
    expect(addressToScVal(ACCOUNT).address()).toBeDefined();
    expect(() => addressToScAddress("not-an-address")).toThrow();
  });

  it("returns native ScVal instances", () => {
    expect(numberToI128Xdr("7")).toBeInstanceOf(xdr.ScVal);
    expect(stringToScVal("ok")).toBeInstanceOf(xdr.ScVal);
  });
});
