import { buildNoteHash, isValidNoteHash, attachNoteHash } from "../src/privacy";
import { ValidationError } from "../src/core/errors";

describe("note hash", () => {
  it("generates a hash from note text", async () => {
    const ref = await buildNoteHash({ note: "March bonus" });
    expect(ref.source).toBe("generated");
    expect(isValidNoteHash(ref.noteHash)).toBe(true);
  });

  it("validates an existing hash string", async () => {
    const generated = await buildNoteHash({ note: "March bonus" });
    const ref = await buildNoteHash({ noteHash: generated.noteHash });
    expect(ref).toEqual({ noteHash: generated.noteHash, source: "provided" });
  });

  it("rejects an invalid note hash", async () => {
    await expect(buildNoteHash({ noteHash: "not-a-hash" })).rejects.toThrow(ValidationError);
  });

  it("rejects empty note text", async () => {
    await expect(buildNoteHash({ note: "  " })).rejects.toThrow(ValidationError);
  });

  it("attaches a note hash and strips raw note text from the payload", async () => {
    const ref = await buildNoteHash({ note: "March bonus" });
    const payload = attachNoteHash({ recipient: "GABC", amount: 1000n, note: "March bonus" }, ref);
    expect(payload).not.toHaveProperty("note");
    expect(payload.noteHash).toBe(ref.noteHash);
  });
});
