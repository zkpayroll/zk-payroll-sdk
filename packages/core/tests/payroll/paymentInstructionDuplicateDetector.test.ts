import {
  detectDuplicatePayment,
  fingerprintPaymentInstruction,
  type PaymentInstructionLike,
} from "../../src/payroll/paymentInstructionDuplicateDetector";

const RECIPIENT = "GAJFUKFHCREUWXRQRQVKKHHBQRZ2COH64HLGYM3ZB6J5PPKNCREGQCCN";
const OTHER_RECIPIENT = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const instruction = (over: Partial<PaymentInstructionLike> = {}): PaymentInstructionLike => ({
  id: "ix-1",
  recipient: RECIPIENT,
  amount: "100",
  ...over,
});

describe("detectDuplicatePayment", () => {
  it("reports no duplicate for distinct instructions", () => {
    const result = detectDuplicatePayment([
      instruction({ id: "ix-1", recipient: RECIPIENT }),
      instruction({ id: "ix-2", recipient: OTHER_RECIPIENT }),
    ]);
    expect(result.duplicate).toBe(false);
    expect(result.matchedId).toBeUndefined();
  });

  it("detects a duplicate and reports the previously seen id", () => {
    const result = detectDuplicatePayment([
      instruction({ id: "first" }),
      instruction({ id: "second" }),
    ]);
    expect(result.duplicate).toBe(true);
    expect(result.matchedId).toBe("first");
    expect(result.reason).toContain("index 1");
  });

  it("reports an undefined matched id when the earlier instruction had no id", () => {
    const result = detectDuplicatePayment([
      { recipient: RECIPIENT, amount: "100" },
      instruction({ id: "second" }),
    ]);
    expect(result.duplicate).toBe(true);
    expect(result.matchedId).toBeUndefined();
  });

  it("treats a different amount as a distinct instruction", () => {
    const result = detectDuplicatePayment([
      instruction({ amount: "100" }),
      instruction({ amount: "101" }),
    ]);
    expect(result.duplicate).toBe(false);
  });

  it("reports only the first duplicate in a batch", () => {
    const result = detectDuplicatePayment([
      instruction({ id: "a" }),
      instruction({ id: "b" }),
      instruction({ id: "c" }),
    ]);
    expect(result.matchedId).toBe("a");
    expect(result.reason).toContain("index 1");
  });

  it("rejects a non-array argument", () => {
    expect(() => detectDuplicatePayment("nope" as unknown as PaymentInstructionLike[])).toThrow(
      TypeError,
    );
  });

  it("reports the offending index for an invalid instruction", () => {
    expect(() =>
      detectDuplicatePayment([instruction(), { recipient: "", amount: "1" }]),
    ).toThrow(/index 1/);
  });
});

describe("fingerprintPaymentInstruction", () => {
  it("ignores property ordering", () => {
    const a = fingerprintPaymentInstruction({
      id: "x",
      recipient: RECIPIENT,
      amount: "100",
      token: "USDC",
      memo: "march",
    });
    const b = fingerprintPaymentInstruction({
      memo: "march",
      token: "USDC",
      amount: "100",
      recipient: RECIPIENT,
      id: "x",
    });
    expect(a).toBe(b);
  });

  it("normalizes recipient and token case and surrounding whitespace", () => {
    const a = fingerprintPaymentInstruction({
      recipient: `  ${RECIPIENT.toLowerCase()}  `,
      amount: "100",
      token: " usdc ",
    });
    const b = fingerprintPaymentInstruction({
      recipient: RECIPIENT,
      amount: "100",
      token: "USDC",
    });
    expect(a).toBe(b);
  });

  it("excludes the instruction id from the fingerprint", () => {
    const a = fingerprintPaymentInstruction({ id: "one", recipient: RECIPIENT, amount: "100" });
    const b = fingerprintPaymentInstruction({ id: "two", recipient: RECIPIENT, amount: "100" });
    expect(a).toBe(b);
  });

  it("distinguishes instructions that differ only by memo", () => {
    const a = fingerprintPaymentInstruction(instruction({ memo: "march" }));
    const b = fingerprintPaymentInstruction(instruction({ memo: "april" }));
    expect(a).not.toBe(b);
  });

  it("rejects an instruction without a recipient", () => {
    expect(() =>
      fingerprintPaymentInstruction({ recipient: "", amount: "100" }),
    ).toThrow(TypeError);
  });

  it("rejects an instruction without an amount", () => {
    expect(() =>
      fingerprintPaymentInstruction({ recipient: RECIPIENT, amount: undefined as never }),
    ).toThrow(TypeError);
  });

  it("rejects a non-object instruction", () => {
    expect(() => fingerprintPaymentInstruction(null as never)).toThrow(TypeError);
  });
});
