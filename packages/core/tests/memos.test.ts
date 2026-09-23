import { ValidationError } from "../src/core/errors";
import { computeMemoCommitment, isMemoCommitment } from "../src/crypto/memoCommitment";
import {
  prepareEncryptedMemo,
  validateMemoInput,
  MEMO_PLAINTEXT_MAX_LENGTH,
  MEMO_METADATA_FIELD_MAX_LENGTH,
} from "../src/memos";
import type { EncryptionProvider } from "../src/draft/EncryptionProvider";
import type { MemoMetadata, PreparedMemo } from "../src/memos";
import { assertPreparedMemo, buildMemoRegistrationRequest } from "../src/contracts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Asserts that fn throws a ValidationError carrying the expected code. */
function expectValidationError(fn: () => unknown, code: string): ValidationError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  const validationError = caught as ValidationError;
  expect(validationError.code).toBe(code);
  return validationError;
}

class RecordingEncryptionProvider implements EncryptionProvider {
  readonly encrypted: string[] = [];

  async encrypt(data: string): Promise<string> {
    this.encrypted.push(data);
    return `enc:${Buffer.from(data, "utf8").toString("base64")}`;
  }

  async decrypt(encrypted: string): Promise<string> {
    return Buffer.from(encrypted.replace(/^enc:/, ""), "base64").toString("utf8");
  }

  canEncrypt(): boolean {
    return true;
  }
}

class UnavailableEncryptionProvider implements EncryptionProvider {
  async encrypt(): Promise<string> {
    throw new Error("encrypt must never be called");
  }

  async decrypt(): Promise<string> {
    throw new Error("decrypt must never be called");
  }

  canEncrypt(): boolean {
    return false;
  }
}

const PLAINTEXT = "August bonus — thank you";
const VALID_INPUT = {
  plaintext: PLAINTEXT,
  recipientId: "GMEMOEMPLOYEE000000000000000000000000000000",
  asset: "native",
  periodId: "2026-08",
};

// ── computeMemoCommitment ────────────────────────────────────────────────────

describe("computeMemoCommitment", () => {
  it("is deterministic for identical inputs", async () => {
    const a = await computeMemoCommitment({ encryptedPayload: "enc:abc" });
    const b = await computeMemoCommitment({ encryptedPayload: "enc:abc" });
    expect(a).toBe(b);
  });

  it("produces the memo:<64 hex> commitment format", async () => {
    const commitment = await computeMemoCommitment({ encryptedPayload: "enc:abc" });
    expect(isMemoCommitment(commitment)).toBe(true);
  });

  it("changes when the encrypted payload changes", async () => {
    const a = await computeMemoCommitment({ encryptedPayload: "enc:abc" });
    const b = await computeMemoCommitment({ encryptedPayload: "enc:abd" });
    expect(a).not.toBe(b);
  });

  it("changes when any context field changes", async () => {
    const base = { encryptedPayload: "enc:abc", recipientId: "R1", asset: "native", periodId: "P1" };
    const baseline = await computeMemoCommitment(base);
    const variants = [
      { ...base, recipientId: "R2" },
      { ...base, asset: "USDC" },
      { ...base, periodId: "P2" },
      { encryptedPayload: "enc:abc" },
    ];
    for (const variant of variants) {
      expect(await computeMemoCommitment(variant)).not.toBe(baseline);
    }
  });

  it("rejects an empty encrypted payload", async () => {
    await expect(computeMemoCommitment({ encryptedPayload: "" })).rejects.toThrow(ValidationError);
  });

  it("isMemoCommitment rejects malformed commitments", () => {
    expect(isMemoCommitment("memo:abc")).toBe(false);
    expect(isMemoCommitment("abc".repeat(32))).toBe(false);
    expect(isMemoCommitment("hash:abc")).toBe(false);
    expect(isMemoCommitment(123)).toBe(false);
    expect(isMemoCommitment(undefined)).toBe(false);
  });
});

// ── validateMemoInput ────────────────────────────────────────────────────────

describe("validateMemoInput", () => {
  it("accepts a valid memo input", () => {
    expect(() => validateMemoInput(VALID_INPUT)).not.toThrow();
  });

  it("accepts a memo with no optional metadata", () => {
    expect(() => validateMemoInput({ plaintext: "hello" })).not.toThrow();
  });

  it("rejects null and non-object inputs", () => {
    expectValidationError(() => validateMemoInput(null as never), "MEMO_INPUT_INVALID");
    expectValidationError(() => validateMemoInput("memo" as never), "MEMO_INPUT_INVALID");
  });

  it("rejects a missing or non-string plaintext", () => {
    expectValidationError(() => validateMemoInput({} as never), "MEMO_PLAINTEXT_REQUIRED");
    expectValidationError(
      () => validateMemoInput({ plaintext: 42 } as never),
      "MEMO_PLAINTEXT_REQUIRED"
    );
  });

  it("rejects an empty plaintext", () => {
    expectValidationError(() => validateMemoInput({ plaintext: "" }), "MEMO_PLAINTEXT_EMPTY");
  });

  it("rejects a plaintext longer than MEMO_PLAINTEXT_MAX_LENGTH", () => {
    expectValidationError(
      () => validateMemoInput({ plaintext: "x".repeat(MEMO_PLAINTEXT_MAX_LENGTH + 1) }),
      "MEMO_PLAINTEXT_TOO_LONG"
    );
  });

  it("accepts a plaintext at exactly MEMO_PLAINTEXT_MAX_LENGTH", () => {
    expect(() => validateMemoInput({ plaintext: "x".repeat(MEMO_PLAINTEXT_MAX_LENGTH) })).not.toThrow();
  });

  it("rejects non-string and over-long metadata fields", () => {
    expectValidationError(
      () => validateMemoInput({ plaintext: "hi", recipientId: 1 as never }),
      "MEMO_METADATA_INVALID"
    );
    expectValidationError(
      () => validateMemoInput({ plaintext: "hi", asset: "a".repeat(MEMO_METADATA_FIELD_MAX_LENGTH + 1) }),
      "MEMO_METADATA_TOO_LONG"
    );
    expect(() =>
      validateMemoInput({ plaintext: "hi", asset: "a".repeat(MEMO_METADATA_FIELD_MAX_LENGTH) })
    ).not.toThrow();
  });

  it("never echoes the plaintext in error messages", () => {
    const secret = "super-secret-salary-note";
    const error = expectValidationError(
      () => validateMemoInput({ plaintext: secret + "x".repeat(MEMO_PLAINTEXT_MAX_LENGTH) }),
      "MEMO_PLAINTEXT_TOO_LONG"
    );
    expect(error.message).not.toContain(secret);
  });
});

// ── prepareEncryptedMemo ─────────────────────────────────────────────────────

describe("prepareEncryptedMemo", () => {
  it("returns encrypted payload, commitment, and metadata", async () => {
    const provider = new RecordingEncryptionProvider();
    const prepared = await prepareEncryptedMemo(VALID_INPUT, provider);

    expect(prepared.encryptedPayload).toBe(
      `enc:${Buffer.from(PLAINTEXT, "utf8").toString("base64")}`
    );
    expect(isMemoCommitment(prepared.commitment)).toBe(true);
    expect(prepared.metadata).toEqual({
      recipientId: VALID_INPUT.recipientId,
      asset: VALID_INPUT.asset,
      periodId: VALID_INPUT.periodId,
    });
  });

  it("actually encrypts: ciphertext differs from the plaintext and round-trips", async () => {
    const provider = new RecordingEncryptionProvider();
    const prepared = await prepareEncryptedMemo(VALID_INPUT, provider);

    expect(prepared.encryptedPayload).not.toContain(PLAINTEXT);
    expect(provider.encrypted).toEqual([PLAINTEXT]);
    await expect(provider.decrypt(prepared.encryptedPayload)).resolves.toBe(PLAINTEXT);
  });

  it("never includes the plaintext anywhere in the prepared output", async () => {
    const provider = new RecordingEncryptionProvider();
    const prepared = await prepareEncryptedMemo(VALID_INPUT, provider);
    expect(JSON.stringify(prepared)).not.toContain(PLAINTEXT);
  });

  it("derives the commitment from the encrypted payload, not the plaintext", async () => {
    const provider = new RecordingEncryptionProvider();
    const prepared = await prepareEncryptedMemo(VALID_INPUT, provider);
    const expected = await computeMemoCommitment({
      encryptedPayload: prepared.encryptedPayload,
      recipientId: VALID_INPUT.recipientId,
      asset: VALID_INPUT.asset,
      periodId: VALID_INPUT.periodId,
    });
    expect(prepared.commitment).toBe(expected);
  });

  it("is deterministic given a deterministic provider", async () => {
    const a = await prepareEncryptedMemo(VALID_INPUT, new RecordingEncryptionProvider());
    const b = await prepareEncryptedMemo(VALID_INPUT, new RecordingEncryptionProvider());
    expect(a).toEqual(b);
  });

  it("omits metadata fields that were not provided", async () => {
    const prepared = await prepareEncryptedMemo(
      { plaintext: "hello" },
      new RecordingEncryptionProvider()
    );
    expect(prepared.metadata).toEqual({});
  });

  it("fails early before touching the provider on invalid input", async () => {
    const provider = new RecordingEncryptionProvider();
    await expect(
      prepareEncryptedMemo({ plaintext: "" }, provider)
    ).rejects.toThrow(ValidationError);
    expect(provider.encrypted).toHaveLength(0);
  });

  it("rejects a missing provider — no plaintext fallback path", async () => {
    await expect(
      prepareEncryptedMemo(VALID_INPUT, undefined as never)
    ).rejects.toThrow(ValidationError);
    await expect(
      prepareEncryptedMemo(VALID_INPUT, null as never)
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a provider that cannot encrypt", async () => {
    await expect(
      prepareEncryptedMemo(VALID_INPUT, new UnavailableEncryptionProvider())
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an empty payload returned by a broken provider", async () => {
    const broken: EncryptionProvider = {
      encrypt: async () => "",
      decrypt: async () => "",
      canEncrypt: () => true,
    };
    await expect(prepareEncryptedMemo(VALID_INPUT, broken)).rejects.toThrow(ValidationError);
  });
});

// ── Contract registration guards (#340: reject raw plaintext paths) ─────────

describe("assertPreparedMemo", () => {
  async function makePrepared(): Promise<PreparedMemo> {
    return prepareEncryptedMemo(VALID_INPUT, new RecordingEncryptionProvider());
  }

  it("accepts a genuine prepared memo", async () => {
    const memo = await makePrepared();
    expect(() => assertPreparedMemo(memo)).not.toThrow();
  });

  it("rejects raw string/number/null submissions", () => {
    for (const raw of ["raw memo text", 42, null, undefined, ["memo"]]) {
      expect(() => assertPreparedMemo(raw)).toThrow(ValidationError);
    }
  });

  it("rejects raw plaintext-shaped objects even with valid-looking fields", () => {
    const raws = [
      { plaintext: "raw memo" },
      { content: "raw memo" },
      { memoText: "raw memo" },
      { note: "raw memo" },
      { amount: "1000" },
      { salary: "1000" },
      { plaintext: "raw", encryptedPayload: "enc:abc", commitment: "memo:" + "a".repeat(64) },
    ];
    for (const raw of raws) {
      try {
        assertPreparedMemo(raw);
        throw new Error(`expected rejection for ${JSON.stringify(raw)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).code).toBe("MEMO_RAW_SUBMISSION_REJECTED");
      }
    }
  });

  it("rejects objects missing an encryptedPayload", async () => {
    const memo = await makePrepared();
    expect(() =>
      assertPreparedMemo({ ...memo, encryptedPayload: undefined })
    ).toThrow(ValidationError);
    expect(() => assertPreparedMemo({ commitment: memo.commitment })).toThrow(ValidationError);
  });

  it("rejects objects with a missing or malformed commitment", async () => {
    const memo = await makePrepared();
    expect(() => assertPreparedMemo({ ...memo, commitment: undefined })).toThrow(ValidationError);
    expect(() => assertPreparedMemo({ ...memo, commitment: "hash:deadbeef" })).toThrow(ValidationError);
    expect(() => assertPreparedMemo({ ...memo, commitment: "memo:not-hex" })).toThrow(ValidationError);
  });
});

describe("buildMemoRegistrationRequest", () => {
  it("projects exactly the whitelisted fields for contract calls", async () => {
    const prepared = await prepareEncryptedMemo(VALID_INPUT, new RecordingEncryptionProvider());
    const request = buildMemoRegistrationRequest(prepared);

    expect(Object.keys(request).sort()).toEqual(["commitment", "encryptedPayload", "metadata"]);
    expect(request.encryptedPayload).toBe(prepared.encryptedPayload);
    expect(request.commitment).toBe(prepared.commitment);
    expect(request.metadata).toEqual(prepared.metadata);
    // The plaintext must not appear anywhere in the serialized request.
    expect(JSON.stringify(request)).not.toContain(PLAINTEXT);
  });

  it("drops unknown metadata keys and over-long values", async () => {
    const prepared = await prepareEncryptedMemo(VALID_INPUT, new RecordingEncryptionProvider());
    const padded = {
      ...prepared,
      metadata: {
        ...prepared.metadata,
        department: "Engineering",
        asset: "a".repeat(MEMO_METADATA_FIELD_MAX_LENGTH + 1),
      } as MemoMetadata,
    };
    const request = buildMemoRegistrationRequest(padded);
    expect(request.metadata).not.toHaveProperty("department");
    expect(request.metadata).not.toHaveProperty("asset");
    expect(request.metadata.recipientId).toBe(VALID_INPUT.recipientId);
    expect(request.metadata.periodId).toBe(VALID_INPUT.periodId);
  });

  it("refuses raw plaintext objects (the unsafe path is blocked, not discouraged)", () => {
    expect(() => buildMemoRegistrationRequest({ plaintext: "send me raw" } as never)).toThrow(
      ValidationError
    );
    expect(() => buildMemoRegistrationRequest("raw memo" as never)).toThrow(ValidationError);
  });

  it("produces a request whose commitment verifies against the payload", async () => {
    const prepared = await prepareEncryptedMemo(VALID_INPUT, new RecordingEncryptionProvider());
    const request = buildMemoRegistrationRequest(prepared);
    const recomputed = await computeMemoCommitment({
      encryptedPayload: request.encryptedPayload,
      recipientId: request.metadata.recipientId,
      asset: request.metadata.asset,
      periodId: request.metadata.periodId,
    });
    expect(request.commitment).toBe(recomputed);
  });
});