import { prepareMemo, generateMemoCommitment, isValidMemoCommitment, assertNoPlaintext, toContractArgs } from "../src/memos";
describe("memos (#340)", () => {
  it("prepares encrypted payload + commitment without plaintext", async () => {
    const out = await prepareMemo({ text: "March bonus", employeeId: "e1" });
    expect(out.encryptedPayload).toBeTruthy();
    expect(out.encryptedPayload).not.toContain("March bonus");
    expect(isValidMemoCommitment(out.commitment)).toBe(true);
    expect(out).not.toHaveProperty("text");
  });
  it("commitment is deterministic over encrypted payload", () => {
    expect(generateMemoCommitment("abc")).toBe(generateMemoCommitment("abc"));
  });
  it("rejects empty and oversized inputs early", async () => {
    await expect(prepareMemo({ text: "  " })).rejects.toThrow();
    await expect(prepareMemo({ text: "x".repeat(2000) })).rejects.toThrow();
  });
  it("rejects plaintext paths to contract helpers", async () => {
    const out = await prepareMemo({ text: "hi-note" });
    expect(() => toContractArgs(out)).not.toThrow();
    expect(() => assertNoPlaintext({ note: "hi-note" })).toThrow();
    expect(() => toContractArgs({ note: "hi-note" } as never)).toThrow();
    expect(() => toContractArgs({ encryptedPayload: "x", commitment: "bad" } as never)).toThrow();
  });
  it("supports custom encryptor", async () => {
    const out = await prepareMemo({ text: "secret" }, { encrypt: (s) => `enc:${s}`, algorithm: "custom" });
    expect(out.encryptedPayload).toBe("enc:secret");
    expect(out.algorithm).toBe("custom");
  });
});
