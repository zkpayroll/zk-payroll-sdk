import {
  SUPPORTED_TOKEN_INTERFACES,
  TokenInterfaceErrorCode,
  checkTokenInterfaceSupport,
  isSupportedTokenInterface,
} from "../src/assets/tokenInterface";

describe("checkTokenInterfaceSupport (#777)", () => {
  it("accepts every canonical interface name", () => {
    for (const name of SUPPORTED_TOKEN_INTERFACES) {
      const r = checkTokenInterfaceSupport(name);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.interface).toBe(name);
    }
  });

  it("normalizes casing and surrounding whitespace", () => {
    const r = checkTokenInterfaceSupport("  SEP-41 ");
    expect(r).toEqual({ ok: true, interface: "sep-41" });
  });

  it("rejects an unsupported interface with a stable code", () => {
    const r = checkTokenInterfaceSupport("erc-20");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(TokenInterfaceErrorCode.INTERFACE_UNSUPPORTED);
      expect(r.message).toContain("erc-20");
      expect(r.message).toContain("sep-41");
    }
  });

  it("rejects a missing identifier distinctly", () => {
    const r = checkTokenInterfaceSupport(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TokenInterfaceErrorCode.INTERFACE_REQUIRED);
  });

  it("rejects an empty string as malformed", () => {
    const r = checkTokenInterfaceSupport("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TokenInterfaceErrorCode.INTERFACE_MALFORMED);
  });

  it("rejects non-string input as malformed", () => {
    const r = checkTokenInterfaceSupport(42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TokenInterfaceErrorCode.INTERFACE_MALFORMED);
  });

  it("honors a narrowed allowed list", () => {
    const r = checkTokenInterfaceSupport("native", { allowed: ["sep-41"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(TokenInterfaceErrorCode.INTERFACE_UNSUPPORTED);
  });

  it("truncates overlong input in the sanitized message", () => {
    const long = "x".repeat(200);
    const r = checkTokenInterfaceSupport(long);
    if (!r.ok) {
      expect(r.message.length).toBeLessThan(200);
      expect(r.message).toContain("…");
    } else {
      throw new Error("expected rejection");
    }
  });

  it("isSupportedTokenInterface mirrors the check result", () => {
    expect(isSupportedTokenInterface("sep-41")).toBe(true);
    expect(isSupportedTokenInterface("erc-20")).toBe(false);
    expect(isSupportedTokenInterface(null)).toBe(false);
  });
});
