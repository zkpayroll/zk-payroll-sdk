import {
  computeBatchFingerprint,
  computeEntriesCommitment,
  verifyBatchFingerprint,
  compareFingerprints,
  formatBatchFingerprintSummary,
  BatchFingerprintError,
  DEFAULT_FINGERPRINT_DOMAIN,
} from "../src/fingerprint";

describe("Payroll Batch Fingerprint (#273)", () => {
  const sampleInput = {
    employer: "GDEMOEMPLOYER1234567890",
    period: "2026-09",
    entries: [
      { recipient: "GACME1", amount: 10000000n },
      { recipient: "GACME2", amount: "5000000" },
      { recipient: "GACME3", amount: 2500000 },
    ],
    asset: "native",
    sequence: 1,
  };

  test("computes deterministic 64-character SHA-256 fingerprint", () => {
    const res1 = computeBatchFingerprint(sampleInput);
    const res2 = computeBatchFingerprint(sampleInput);

    expect(res1.fingerprint).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(res1.fingerprint)).toBe(true);
    expect(res1.fingerprint).toBe(res2.fingerprint);
    expect(res1.shortFingerprint).toBe(`fp_${res1.fingerprint.slice(0, 12)}`);
    expect(res1.entryCount).toBe(3);
    expect(res1.domain).toBe(DEFAULT_FINGERPRINT_DOMAIN);
  });

  test("order-invariant: reordered entries produce identical commitment and fingerprint", () => {
    const permutedInput = {
      ...sampleInput,
      entries: [
        { recipient: "GACME3", amount: 2500000 },
        { recipient: "GACME1", amount: 10000000n },
        { recipient: "GACME2", amount: "5000000" },
      ],
    };

    const res1 = computeBatchFingerprint(sampleInput);
    const res2 = computeBatchFingerprint(permutedInput);

    expect(res1.entriesCommitment).toBe(res2.entriesCommitment);
    expect(res1.fingerprint).toBe(res2.fingerprint);
  });

  test("sensitivity: modifying any parameter changes fingerprint", () => {
    const base = computeBatchFingerprint(sampleInput);

    const changedPeriod = computeBatchFingerprint({ ...sampleInput, period: "2026-10" });
    expect(changedPeriod.fingerprint).not.toBe(base.fingerprint);

    const changedEmployer = computeBatchFingerprint({ ...sampleInput, employer: "GOTHEREMPLOYER999" });
    expect(changedEmployer.fingerprint).not.toBe(base.fingerprint);

    const changedAmount = computeBatchFingerprint({
      ...sampleInput,
      entries: [
        { recipient: "GACME1", amount: 99999999n },
        { recipient: "GACME2", amount: "5000000" },
        { recipient: "GACME3", amount: 2500000 },
      ],
    });
    expect(changedAmount.fingerprint).not.toBe(base.fingerprint);

    const changedAsset = computeBatchFingerprint({ ...sampleInput, asset: "USDC" });
    expect(changedAsset.fingerprint).not.toBe(base.fingerprint);

    const changedSeq = computeBatchFingerprint({ ...sampleInput, sequence: 2 });
    expect(changedSeq.fingerprint).not.toBe(base.fingerprint);
  });

  test("supports custom options (domain, prefix, length)", () => {
    const res = computeBatchFingerprint(sampleInput, {
      domain: "custom:org:domain",
      shortPrefix: "batch_",
      shortLength: 16,
    });

    expect(res.domain).toBe("custom:org:domain");
    expect(res.shortFingerprint).toBe(`batch_${res.fingerprint.slice(0, 16)}`);
  });

  test("handles empty entries cleanly", () => {
    const emptyInput = {
      employer: "GEMPTYEMPLOYER",
      period: "2026-09",
      entries: [],
    };

    const res = computeBatchFingerprint(emptyInput);
    expect(res.entryCount).toBe(0);
    expect(res.entriesCommitment).toBe(computeEntriesCommitment([]));
    expect(res.fingerprint).toHaveLength(64);
  });

  test("throws BatchFingerprintError on invalid inputs", () => {
    expect(() => computeBatchFingerprint(null as any)).toThrow(BatchFingerprintError);
    expect(() => computeBatchFingerprint({ ...sampleInput, employer: "" })).toThrow(
      "Employer address is required"
    );
    expect(() => computeBatchFingerprint({ ...sampleInput, period: "   " })).toThrow(
      "Period identifier is required"
    );
    expect(() => computeBatchFingerprint({ ...sampleInput, entries: "invalid" as any })).toThrow(
      "Batch entries must be an array"
    );
  });

  test("verifyBatchFingerprint accurately validates matching and non-matching fingerprints", () => {
    const res = computeBatchFingerprint(sampleInput);

    expect(verifyBatchFingerprint(sampleInput, res.fingerprint)).toBe(true);
    expect(verifyBatchFingerprint(sampleInput, res.fingerprint.toUpperCase())).toBe(true);
    expect(verifyBatchFingerprint(sampleInput, "0".repeat(64))).toBe(false);
    expect(verifyBatchFingerprint(sampleInput, "")).toBe(false);
    expect(verifyBatchFingerprint(null as any, res.fingerprint)).toBe(false);
  });

  test("compareFingerprints performs case-insensitive constant-time comparison", () => {
    const hex1 = "a1b2c3d4e5f6";
    const hex2 = "A1B2C3D4E5F6";
    const hex3 = "a1b2c3d4e5f7";

    expect(compareFingerprints(hex1, hex2)).toBe(true);
    expect(compareFingerprints(hex1, hex3)).toBe(false);
    expect(compareFingerprints(hex1, "a1b2")).toBe(false);
    expect(compareFingerprints(null as any, hex1)).toBe(false);
  });

  test("formatBatchFingerprintSummary outputs structured diagnostic telemetry", () => {
    const res = computeBatchFingerprint(sampleInput);
    const summary = formatBatchFingerprintSummary(res);

    expect(summary).toContain(res.shortFingerprint);
    expect(summary).toContain(res.fingerprint);
    expect(summary).toContain("Entries: 3");
    expect(summary).toContain(res.domain);
  });
});
