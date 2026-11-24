import { TokenInterfaceErrorCode } from "../../src/assets/tokenInterface";
import {
  UnsupportedTokenInterfaceError,
  assertSupportedTokenInterface,
  guardSettlementTokenInterface,
} from "../../src/payroll/settlementTokenInterfaceGuard";

describe("guardSettlementTokenInterface (#777)", () => {
  it("accepts sep-41 as the canonical settlement interface", () => {
    expect(guardSettlementTokenInterface("sep-41")).toEqual({
      ok: true,
      interface: "sep-41",
    });
  });

  it("rejects an unsupported interface with the tokenInterface field", () => {
    const r = guardSettlementTokenInterface("erc-20");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(TokenInterfaceErrorCode.INTERFACE_UNSUPPORTED);
      expect(r.field).toBe("tokenInterface");
    }
  });

  it("rejects at the boundary when allowed is narrowed", () => {
    const r = guardSettlementTokenInterface("native", { allowed: ["sep-41"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TokenInterfaceErrorCode.INTERFACE_UNSUPPORTED);
  });

  it("never echoes private payroll fields back on rejection", () => {
    const r = guardSettlementTokenInterface("erc-20");
    if (!r.ok) {
      expect(r.message).not.toMatch(/recipient|amount|salary/i);
    }
  });
});

describe("assertSupportedTokenInterface (#777)", () => {
  it("returns the normalized interface on success", () => {
    expect(assertSupportedTokenInterface(" SEP-41 ")).toBe("sep-41");
  });

  it("throws UnsupportedTokenInterfaceError for unsupported input", () => {
    expect.assertions(3);
    try {
      assertSupportedTokenInterface("erc-20");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedTokenInterfaceError);
      if (err instanceof UnsupportedTokenInterfaceError) {
        expect(err.code).toBe(TokenInterfaceErrorCode.INTERFACE_UNSUPPORTED);
        expect(err.message).toContain("sep-41");
      }
    }
  });

  it("throws INTERFACE_REQUIRED when nothing is passed", () => {
    expect.assertions(1);
    try {
      assertSupportedTokenInterface(undefined);
    } catch (err) {
      if (err instanceof UnsupportedTokenInterfaceError) {
        expect(err.code).toBe(TokenInterfaceErrorCode.INTERFACE_REQUIRED);
      }
    }
  });
});
